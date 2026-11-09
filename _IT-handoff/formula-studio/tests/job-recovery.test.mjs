// Only synthetic data and a disposable UNIX-only PostgreSQL cluster.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../', import.meta.url).pathname);
const scratch = mkdtempSync('/tmp/formula-recovery-synthetic-');
const socket = join(scratch, 'socket');
const username = 'formula_recovery_synthetic';
const port = '65437';
let started = false, serial = 0;
const execute = (bin, args, input) => spawnSync(bin, args, {input, encoding:'utf8',maxBuffer:4e6,env:{...process.env,LC_ALL:'C',LANG:'C'}});
const run = (bin,args,input) => { const r=execute(bin,args,input); assert.equal(r.error,undefined); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
const sqlArgs = () => ['-X','-h',socket,'-p',port,'-U',username,'-d','postgres','-v','ON_ERROR_STOP=1','-Atq'];
const sql = text => run('psql',sqlArgs(),text);
const literal = v => "'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const job = () => ({id:'A09001',createdBy:'Synthetic owner',createdAt:1,customer:'Synthetic',rows:[{name:'Synthetic',w:10}],notes:"quote ' slash \\ $$ $job_restore$"});
const room = () => ({jobId:'A09001',createdBy:'Synthetic owner',createdAt:2,parts:[{user:'Synthetic owner'}],messages:[{uid:'synthetic-one',ts:3,type:'msg',user:'Synthetic owner',text:'Synthetic message'}],approvals:{}});
function prepare(rec=job(), chat=room(), extra, overrides={}) {
  const dir=join(scratch,'case-'+(++serial));mkdirSync(dir);
  const paths={records:join(dir,'records.json'),chats:join(dir,'chats.json'),output:join(dir,'bundle')};
  writeFileSync(paths.records,overrides.rawRecords??JSON.stringify(overrides.records??[rec]));writeFileSync(paths.chats,JSON.stringify(overrides.chats??[chat]));
  const args=[join(root,'scripts/prepare-job-recovery.py'),'--records',paths.records,'--chats',paths.chats,'--job-id','A09001','--output',paths.output];
  if(extra!==undefined){const p=join(dir,'extra.json');writeFileSync(p,JSON.stringify(extra));args.push('--extra',p);}
  const result=execute('python3',args);
  return {result,report:JSON.parse(result.stdout),output:paths.output,sql:result.status===0?readFileSync(join(paths.output,'restore.sql'),'utf8'):null};
}
const apply = bundle => execute('psql',[...sqlArgs(),'-v','operator_confirmed=yes'],bundle.sql);
const count = table => sql('select count(*) from '+table+';');

before(() => {
  mkdirSync(socket);
  run('initdb',['-D',join(scratch,'data'),'-A','trust','-U',username,'--no-locale']);
  const start=execute('pg_ctl',['-D',join(scratch,'data'),'-l',join(scratch,'postgres.log'),'-o',`-F -p ${port} -k ${socket} -c listen_addresses=''`,'-w','start']);
  assert.equal(start.status,0,start.stderr+' '+readFileSync(join(scratch,'postgres.log'),'utf8'));started=true;
  sql('create role anon; create role authenticated;');
  for(const f of ['docs/upstream-schema.sql','runtime/data-grants.sql','runtime/data-policy.sql','runtime/job-sync.sql']) sql(readFileSync(join(root,f),'utf8'));
});
after(() => { if(started)run('pg_ctl',['-D',join(scratch,'data'),'-m','fast','-w','stop']);rmSync(scratch,{recursive:true,force:true}); });
beforeEach(() => sql('truncate fs_records, fs_chats, fs_messages, fs_approvals, fs_archive;'));

test('one-job extraction preserves bytes as JSON values, limits scope, and protects files',()=>{
  const r=job(),c=room(),b=prepare(r,c,{'A09002':[{ts:1,why:'Synthetic',data:job()}]}, {records:[{...r,id:'A09002'},r],chats:[c,{...c,jobId:'A09002'}]});
  assert.equal(b.result.status,0);assert.equal(b.report.extraFileType,'VERSION_HISTORY');assert.equal(b.report.historyVersions,0);
  assert.deepEqual(JSON.parse(readFileSync(join(b.output,'record.json'))),r);
  assert.equal(statSync(b.output).mode&0o777,0o700);assert.equal(statSync(join(b.output,'restore.sql')).mode&0o777,0o600);
  assert.equal(b.result.stdout.includes('Synthetic owner'),false);assert.equal(b.sql.includes('A09002'),false);
});
test('duplicate target, missing target, creator mismatch and lost message UID stop preparation',()=>{
  for(const b of [prepare(job(),room(),undefined,{records:[job(),job()]}),prepare(job(),room(),undefined,{records:[]}),prepare(job(),{...room(),createdBy:'Other synthetic'}),prepare(job(),{...room(),messages:[{ts:3}]})])assert.equal(b.result.status,1);
});
test('conflicting duplicate UID and unrecognized purported outbox fail closed',()=>{
  const c=room();c.messages.push({...c.messages[0],text:'Conflicting synthetic'});
  assert.equal(prepare(job(),c).report.reason,'DUPLICATE_MESSAGE_CONFLICT');assert.equal(prepare(job(),room(),[]).report.reason,'EXTRA_NOT_VERSION_HISTORY');
});
test('duplicate JSON fields stop before choosing any ambiguous business value',()=>{
  const raw='[{"id":"A09001","createdBy":"Synthetic owner","customer":"Synthetic","rows":[],"notes":"First private synthetic","notes":"Second private synthetic"}]';
  const b=prepare(job(),room(),undefined,{rawRecords:raw});assert.equal(b.result.status,1);assert.equal(b.report.reason,'DUPLICATE_JSON_KEY');assert.equal(b.result.stdout.includes('private synthetic'),false);
});
test('actual SQL restores parent chat and exact messages without inventing approvals',()=>{
  const b=prepare();const r=apply(b);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")),job());
  assert.deepEqual(JSON.parse(sql("select data from fs_messages where uid='synthetic-one';")),room().messages[0]);
  assert.equal(count('fs_chats'),'1');assert.equal(count('fs_approvals'),'0');assert.equal(count('fs_activities'),'0');
});
test('retry is idempotent and does not touch existing parent update timestamps',()=>{
  const b=prepare();assert.equal(apply(b).status,0);const ts=sql("select updated_at::text from fs_records where id='A09001';");
  assert.equal(apply(b).status,0);assert.equal(count('fs_messages'),'1');assert.equal(sql("select updated_at::text from fs_records where id='A09001';"),ts);
});
test('different existing parent cannot be overwritten',()=>{
  const existing={...job(),notes:'Existing newer synthetic'};sql(`insert into fs_records(id,data) values ('A09001',${literal(existing)});`);
  const result=apply(prepare());assert.notEqual(result.status,0);assert.match(result.stderr,/PARENT_SAVE_NOT_ACKNOWLEDGED/);
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")),existing);assert.equal(count('fs_chats'),'0');
});
test('message UID collision rolls back newly restored parent and chat',()=>{
  sql(`insert into fs_records(id,data) values ('A09002',${literal({...job(),id:'A09002'})});insert into fs_messages(uid,job_id,ts,data) values ('synthetic-one','A09002',3,${literal({...room().messages[0],text:'Other synthetic'})});`);
  const result=apply(prepare());assert.notEqual(result.status,0);assert.match(result.stderr,/MESSAGE_CONFLICT/);
  assert.equal(sql("select count(*) from fs_records where id='A09001';"),'0');assert.equal(count('fs_chats'),'0');assert.equal(count('fs_messages'),'1');
});
test('extra embedded legacy messages are preserved and require reconciliation',()=>{
  const c=room();c.messages.push({uid:'synthetic-extra',ts:4,text:'Other synthetic'});
  // Fixture represents a historic orphan from before the saved-parent guard,
  // not a legitimately deleted parent. Only this disposable cluster's fixture
  // setup bypasses the child trigger; it is restored before exercising recovery.
  sql(`begin; alter table fs_chats disable trigger fs_chats_saved_record; insert into fs_chats(job_id,data) values ('A09001',${literal(c)}); alter table fs_chats enable trigger fs_chats_saved_record; commit;`);
  const result=apply(prepare());assert.notEqual(result.status,0);assert.match(result.stderr,/EXISTING_LEGACY_MESSAGES/);
  assert.equal(count('fs_records'),'0');assert.deepEqual(JSON.parse(sql("select data from fs_chats where job_id='A09001';")),c);
});
test('normalized extra messages and participant metadata remain intact',()=>{
  const r=job(),c={...room(),parts:[{user:'Other synthetic'}],messages:[]};
  sql(`insert into fs_records(id,data) values ('A09001',${literal(r)});insert into fs_chats(job_id,data) values ('A09001',${literal(c)});insert into fs_messages(uid,job_id,ts,data) values ('synthetic-extra','A09001',4,${literal({uid:'synthetic-extra',ts:4,text:'Existing synthetic'})});`);
  const result=apply(prepare());assert.equal(result.status,0,result.stderr);assert.equal(count('fs_messages'),'2');assert.deepEqual(JSON.parse(sql("select data from fs_chats where job_id='A09001';")),c);
});
test('approval conflict rolls back and preserves the committed approval',()=>{
  const c=room();c.approvals={sales:{by:'Synthetic owner',at:5}};
  sql(`insert into fs_records(id,data) values ('A09001',${literal(job())});insert into fs_approvals(job_id,part,data) values ('A09001','sales',${literal({by:'Other synthetic',at:6})});`);
  const result=apply(prepare(job(),c));assert.notEqual(result.status,0);assert.match(result.stderr,/APPROVAL_CONFLICT/);assert.equal(count('fs_chats'),'0');assert.equal(count('fs_messages'),'0');
});
test('different legacy embedded approval prevents normalization and rolls back parent',()=>{
  const existing={...room(),approvals:{sales:{by:'Existing synthetic',at:6}}},source={...room(),approvals:{sales:{by:'Synthetic owner',at:5}}};
  sql(`begin; alter table fs_chats disable trigger fs_chats_saved_record; insert into fs_chats(job_id,data) values ('A09001',${literal(existing)}); alter table fs_chats enable trigger fs_chats_saved_record; commit;`);
  const r=apply(prepare(job(),source));assert.notEqual(r.status,0);assert.match(r.stderr,/EXISTING_LEGACY_APPROVALS_REQUIRE_RECONCILIATION/);assert.equal(count('fs_records'),'0');assert.equal(count('fs_messages'),'0');assert.equal(count('fs_approvals'),'0');assert.deepEqual(JSON.parse(sql("select data from fs_chats where job_id='A09001';")),existing);
});
test('legacy approval missing from backup is not hidden by a partial restore',()=>{
  const existing={...room(),approvals:{sales:{by:'Existing synthetic',at:6}}};
  sql(`begin; alter table fs_chats disable trigger fs_chats_saved_record; insert into fs_chats(job_id,data) values ('A09001',${literal(existing)}); alter table fs_chats enable trigger fs_chats_saved_record; commit;`);
  const r=apply(prepare());assert.notEqual(r.status,0);assert.match(r.stderr,/EXISTING_LEGACY_APPROVALS_REQUIRE_RECONCILIATION/);assert.equal(count('fs_records'),'0');assert.equal(count('fs_approvals'),'0');
});
test('missing approved CAS installation stops before any data repair',()=>{
  sql('alter function fs_save_record(text,jsonb,jsonb) rename to fs_save_record_synthetic_hidden;');
  try{const result=apply(prepare());assert.notEqual(result.status,0);assert.match(result.stderr,/APPROVED_JOB_SYNC_INSTALLATION_REQUIRED/);assert.equal(count('fs_records'),'0');}
  finally{sql('alter function fs_save_record_synthetic_hidden(text,jsonb,jsonb) rename to fs_save_record;');}
});
test('operator confirmation required and browser database role rejected',()=>{
  const b=prepare();const missing=execute('psql',sqlArgs(),b.sql);assert.equal(missing.status,3);assert.equal(count('fs_records'),'0');
  const anon=execute('psql',[...sqlArgs(),'-v','operator_confirmed=yes'],'set role anon;\n'+b.sql);assert.notEqual(anon.status,0);assert.match(anon.stderr,/OPERATOR_DATABASE_ROLE_REQUIRED/);assert.equal(count('fs_records'),'0');
});
test('silently filtered child insert cannot commit a partial recovery',()=>{
  sql("create function synthetic_skip_message() returns trigger language plpgsql as $$ begin return null; end $$; create trigger synthetic_skip_message before insert on fs_messages for each row execute function synthetic_skip_message();");
  try { const r=apply(prepare());assert.notEqual(r.status,0);assert.match(r.stderr,/MESSAGE_CONFLICT_OR_UNACKNOWLEDGED_WRITE/);assert.equal(count('fs_records'),'0');assert.equal(count('fs_chats'),'0'); }
  finally { sql('drop trigger synthetic_skip_message on fs_messages;drop function synthetic_skip_message();'); }
});
