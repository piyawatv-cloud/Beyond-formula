'use strict';
// Local, synthetic-only experiment. Not an authentication system or production outbox.
// State is durable across sequential restarts; uncertain sends are never retried automatically.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script=source.match(/<script id="model">([\s\S]*?)<\/script>/);if(!script)throw Error('preview model missing');
const ctx={module:{exports:{}},Date};vm.runInNewContext(script[1],ctx);const m=ctx.module.exports;
function createDurableLab(filename){
 const root=path.resolve(os.tmpdir()),target=path.resolve(filename);
 if(!target.startsWith(root+path.sep))throw Error('synthetic SQLite fixture must be under OS temporary directory');
 const db=new DatabaseSync(target);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS fixture_state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS fixture_devices(id TEXT PRIMARY KEY, role TEXT NOT NULL, active INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS fixture_events(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, job_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS fixture_deliveries(event_id TEXT NOT NULL, device_id TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(event_id,device_id));`);
 db.prepare('INSERT OR IGNORE INTO fixture_state(id,data) VALUES(1,?)').run(JSON.stringify(m.initialState()));
 // A prior interrupted send may have reached the provider. Avoid an automatic duplicate.
 db.prepare("UPDATE fixture_deliveries SET status='uncertain' WHERE status='sending'").run();
 const getState=()=>JSON.parse(db.prepare('SELECT data FROM fixture_state WHERE id=1').get().data);
 function register(d){if(!d?.id||!m.can(d.user,'chat'))throw Error('invalid test identity');db.prepare('INSERT INTO fixture_devices(id,role,active) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET role=excluded.role,active=1').run(d.id,d.user)}
 function revoke(id){db.prepare('UPDATE fixture_devices SET active=0 WHERE id=?').run(id)}
 function submit(e){
  if(!e||typeof e.id!=='string'||!e.id||typeof e.actor!=='string'||typeof e.jobId!=='string'||!['chat','update'].includes(e.kind)||typeof e.text!=='string'||!e.text.trim())throw Error('invalid fixture event');
  const fingerprint=JSON.stringify([e.actor,e.jobId,e.kind,e.text]);db.exec('BEGIN IMMEDIATE');
  try{
   const old=db.prepare('SELECT fingerprint FROM fixture_events WHERE id=?').get(e.id);
   if(old){if(old.fingerprint!==fingerprint)throw Error('event ID conflict');db.exec('COMMIT');return {created:false}}
   const state=getState();if(e.kind==='chat')m.send(state,e.actor,e.jobId,e.text);else m.edit(state,e.actor,e.jobId,{notes:e.text});
   db.prepare('UPDATE fixture_state SET data=? WHERE id=1').run(JSON.stringify(state));db.prepare('INSERT INTO fixture_events VALUES(?,?,?,?,?)').run(e.id,fingerprint,e.jobId,e.actor,e.kind);
   const devices=db.prepare('SELECT id,role FROM fixture_devices WHERE active=1').all();
   for(const d of devices)if(d.role!==e.actor&&m.visible(state,d.role).some(j=>j.id===e.jobId))db.prepare("INSERT INTO fixture_deliveries VALUES(?,?,'pending')").run(e.id,d.id);
   db.exec('COMMIT');return {created:true};
  }catch(err){db.exec('ROLLBACK');throw err}
 }
 async function dispatch(send){
  const rows=db.prepare("SELECT l.event_id,l.device_id,e.job_id,e.actor,e.kind,d.role,d.active FROM fixture_deliveries l JOIN fixture_events e ON e.id=l.event_id JOIN fixture_devices d ON d.id=l.device_id WHERE l.status='pending' ORDER BY l.rowid").all();
  let result={attempted:0,delivered:0,uncertain:0};
  for(const row of rows){
   const state=getState(),device=db.prepare('SELECT role,active FROM fixture_devices WHERE id=?').get(row.device_id);if(!device?.active||device.role===row.actor||!m.can(device.role,'chat')||!m.visible(state,device.role).some(j=>j.id===row.job_id)){db.prepare("UPDATE fixture_deliveries SET status='denied' WHERE event_id=? AND device_id=? AND status='pending'").run(row.event_id,row.device_id);continue}
   const claimed=db.prepare("UPDATE fixture_deliveries SET status='sending' WHERE event_id=? AND device_id=? AND status='pending'").run(row.event_id,row.device_id);if(!claimed.changes)continue;
   result.attempted++;try{await send({kind:row.kind},row.device_id);db.prepare("UPDATE fixture_deliveries SET status='sent' WHERE event_id=? AND device_id=? AND status='sending'").run(row.event_id,row.device_id);result.delivered++}
   catch{db.prepare("UPDATE fixture_deliveries SET status='uncertain' WHERE event_id=? AND device_id=? AND status='sending'").run(row.event_id,row.device_id);result.uncertain++}
  }
  return result;
 }
 return {register,revoke,submit,dispatch,fixtureDevice:id=>db.prepare('SELECT role,active FROM fixture_devices WHERE id=?').get(id),count:status=>Number(db.prepare('SELECT COUNT(*) AS n FROM fixture_deliveries WHERE status=?').get(status).n),close:()=>db.close()};
}
module.exports={createDurableLab};
