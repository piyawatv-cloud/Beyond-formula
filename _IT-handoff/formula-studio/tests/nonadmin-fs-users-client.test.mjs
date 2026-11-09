import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './helpers/job-sync-client.mjs';

function client(options={}) {
  return harness({...options,beforeAsset:'window.fetch=window.__fsSessionFetch;'});
}

function dirtyUserAndActivity(h) {
  h.run(`userList=[{name:'Synthetic Profile',role:'sales',email:'private@example.test'}];
    activities=[{uid:'synthetic-activity',ts:1,user:'Synthetic Actor',role:'sales',cat:'test',action:'synthetic',detail:'private-value'}];`);
}

for (const role of ['sales','rd','pd','ra','oversea','admin']) {
  test(`server session ${role} controls fs_users while independent activities sync`, async () => {
    // Browser role deliberately disagrees with the server for both directions.
    const owner=role==='admin'?'sales':'admin';
    const h=client({owner,trustedSession:{authenticated:true,name:owner,role,centralUserId:'synthetic-id'}});
    dirtyUserAndActivity(h);
    await h.run('sbPush()');
    assert.equal(h.calls.filter(c=>c.path==='fs_users').length,role==='admin'?1:0,
      'only server-confirmed admin may send fs_users');
    assert.equal(h.calls.filter(c=>c.path==='fs_activities').length,1,
      'suppressing fs_users must not abort the legacy sync cycle');
    assert.ok(h.calls.some(c=>c.path==='/sb/session'),'decision requires the server session');
    if(role!=='admin') {
      const diagnostic=h.calls.find(c=>c.path==='/__formula/client-diagnostic');
      assert.ok(diagnostic,'suppression retains a safe audit signal');
      const body=JSON.parse(diagnostic.opt.body);
      assert.equal(body.stage,'user-sync');
      assert.equal(body.reason,'non-admin');
      assert.equal(body.detail,'fs_users role='+role);
      assert.ok(!JSON.stringify(body).includes('private'),'no user fields or values in the signal');
      await h.run('sbPush()');
      assert.equal(h.calls.filter(c=>c.path==='fs_users').length,0);
      assert.equal(h.calls.filter(c=>c.path==='/__formula/client-diagnostic').length,1,'signal is deduplicated');
    }
  });
}

test('unavailable trusted session suppresses only fs_users and leaves independent activity sync intact',async()=>{
  const h=client({owner:'admin'});
  h.run(`window.__fsSessionFetch=async()=>{throw Error('synthetic offline');}`);
  dirtyUserAndActivity(h);
  await h.run('sbPush()');
  assert.equal(h.calls.filter(c=>c.path==='fs_users').length,0);
  assert.equal(h.calls.filter(c=>c.path==='fs_activities').length,1);
  const diagnostic=h.calls.find(c=>c.path==='/__formula/client-diagnostic');
  assert.equal(JSON.parse(diagnostic.opt.body).reason,'session-unavailable');
});

for(const invalid of [
  {authenticated:false,name:'admin',role:'admin',centralUserId:'synthetic-id'},
  {authenticated:true,name:'Other Synthetic Actor',role:'admin',centralUserId:'synthetic-id'},
  {authenticated:true,name:'admin',role:'admin',centralUserId:''}
]) {
  test('unconfirmed admin identity never sends fs_users',async()=>{
    const h=client({owner:'admin',trustedSession:invalid});
    dirtyUserAndActivity(h);
    await h.run('sbPush()');
    assert.equal(h.calls.filter(c=>c.path==='fs_users').length,0);
    assert.equal(h.calls.filter(c=>c.path==='fs_activities').length,1);
  });
}

test('a later fs_users upsert rechecks the server session after admin is revoked',async()=>{
  const h=client({owner:'admin'});
  await h.run("sbUpsert('fs_users',[{name:'Synthetic Profile',data:{role:'sales'}}])");
  h.setTrustedSession({authenticated:true,name:'admin',role:'sales',centralUserId:'test-admin'});
  await h.run("sbUpsert('fs_users',[{name:'Synthetic Profile',data:{role:'rd'}}])");
  assert.equal(h.calls.filter(c=>c.path==='fs_users').length,1);
  assert.equal(h.calls.filter(c=>c.path==='/sb/session').length,2,'permission is not cached across writes');
});

test('empty fs_users upsert keeps the existing zero-request no-op',async()=>{
  const h=client({owner:'admin'});
  await h.run("sbUpsert('fs_users',[])");
  assert.equal(h.calls.length,0);
});

test('an unavailable session retains an admin user edit across full pull and retries once after recovery',async()=>{
  const h=client({owner:'admin'});
  h.run(`sbApply({full:true,partial:false,rec:[],cht:[],usr:[{name:'Synthetic Profile',data:{name:'Synthetic Profile',role:'sales',email:'old@example.test'}}],act:[],msg:[],apv:[]});
    userList[0].email='edited@example.test';
    activities=[{uid:'synthetic-activity',ts:1,user:'Synthetic Actor',role:'admin',cat:'test',action:'synthetic'}];
    window.savedSessionFetch=window.__fsSessionFetch;
    window.__fsSessionFetch=async()=>{throw Error('synthetic transient outage');};`);
  await h.run('sbPush()');
  assert.equal(h.calls.filter(c=>c.path==='fs_users').length,0);
  assert.equal(h.calls.filter(c=>c.path==='fs_activities').length,1);
  h.run(`sbApply({full:true,partial:false,rec:[],cht:[],usr:[{name:'Synthetic Profile',data:{name:'Synthetic Profile',role:'sales',email:'old@example.test'}}],act:[{uid:'synthetic-activity',ts:1,data:activities[0]}],msg:[],apv:[]});
    window.__fsSessionFetch=window.savedSessionFetch;`);
  assert.equal(h.read('userList[0].email'),'edited@example.test','full pull must retain the unacknowledged local edit');
  await h.run('sbPush()');
  await h.run('sbPush()');
  const writes=h.calls.filter(c=>c.path==='fs_users');
  assert.equal(writes.length,1,'recovered admin retries the unsent user edit exactly once');
  assert.equal(writes[0].opt.body[0].data.email,'edited@example.test');
  assert.equal(h.calls.filter(c=>c.path==='fs_activities').length,1,'independent Activities are not duplicated');
});

test('deferred user edits do not survive a switch to another actor',async()=>{
  const h=client({owner:'admin'});
  dirtyUserAndActivity(h);
  h.run(`window.__fsSessionFetch=async()=>{throw Error('synthetic outage');}`);
  await h.run('sbPush()');
  h.run(`currentUser='sales'; sbApply({full:true,partial:false,rec:[],cht:[],usr:[{name:'Synthetic Profile',data:{name:'Synthetic Profile',role:'sales',email:'server@example.test'}}],act:[],msg:[],apv:[]});`);
  assert.equal(h.read('userList[0].email'),'server@example.test','another actor does not inherit the deferred edit');
});
