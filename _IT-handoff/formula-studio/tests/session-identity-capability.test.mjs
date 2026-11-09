import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Run the real session bridge against a stubbed /sb/session reply and check
// what it publishes for the page: the verified email and the IAM FORMULA_EDIT
// decision (never anything the page could forge).
const bridge = readFileSync(new URL('../runtime/assets/fs-session-bridge.js', import.meta.url), 'utf8');

function boot(reply, { users, status = 200, unavailable = false, timers } = {}) {
  const calls = [];
  const el = () => ({ addEventListener() {}, style: {}, textContent: '', value: '', classList: { add() {}, remove() {}, contains() { return false; } }, querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null, appendChild() {}, remove() {}, focus() {} });
  const window = {
    fetch: (url, opt) => { calls.push({ url, opt }); return unavailable ? Promise.reject(new Error('synthetic unavailable session')) : Promise.resolve({ status, json: () => Promise.resolve(reply) }); },
    setTimeout: timers ? (callback, ms) => { const timer={callback,ms}; timers.push(timer); return timer; } : setTimeout,
    clearTimeout: timers ? timer => { const index=timers.indexOf(timer); if(index>=0)timers.splice(index,1); } : clearTimeout, alert() {}, localStorage: { setItem() {}, getItem: () => null },
    afterUserChange() { window.afterUserChangeCalls = (window.afterUserChangeCalls || 0) + 1; }, switchView() {}, renderLoginView() {},
    addEventListener() {}, location: { href: '' },
  };
  window.window = window;
  const context = vm.createContext(Object.assign(window, {
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el() },
    userList: users || [{ name: reply.name || 'x', role: reply.role || 'sales' }], currentUser: '', impersonator: '', console,
  }));
  vm.runInContext(bridge, context);
  // Objects born inside the vm realm are not reference-equal to ours (rule 6.4): read them back as plain data.
  const identity = () => JSON.parse(JSON.stringify(context.window.__fsSessionIdentity));
  return { context, calls, identity, settled: () => new Promise(resolve => setTimeout(resolve, 450)) };
}

test('a granted account is published with canFormulaEdit=true, an ungranted one with false', async () => {
  const granted = boot({ authenticated: true, name: 'แยม', role: 'sales', email: 'Yam@Example.test', centralUserId: 'iam-yam', canEdit: true, canFormulaEdit: true });
  await granted.settled();
  assert.deepEqual(granted.identity(), { email: 'yam@example.test', canFormulaEdit: true });
  assert.equal(granted.context.currentUser, 'แยม');
  const plain = boot({ authenticated: true, name: 'ฝน', role: 'sales', email: 'fon@example.test', centralUserId: 'iam-fon', canEdit: true, canFormulaEdit: false });
  await plain.settled();
  assert.deepEqual(plain.identity(), { email: 'fon@example.test', canFormulaEdit: false });
  const absent = boot({ authenticated: true, name: 'ไท', role: 'oversea', email: 'tai@example.test', centralUserId: 'iam-tai', canEdit: true });
  await absent.settled();
  assert.equal(absent.identity().canFormulaEdit, false, 'a missing decision never grants');
  const forged = boot({ authenticated: true, name: 'ไท', role: 'oversea', email: 'tai@example.test', centralUserId: 'iam-tai', canEdit: true, canFormulaEdit: 'true' });
  await forged.settled();
  assert.equal(forged.identity().canFormulaEdit, false, 'only a real boolean counts');
});

test('a signed-out reply publishes an empty identity', async () => {
  const out = boot({ authenticated: false });
  await out.settled();
  assert.deepEqual(out.identity(), { email: '' });
});


const turn = () => new Promise(resolve => setImmediate(resolve));

test('actor scheduling waits for real bridge installation after users arrive, while handshake stays independent', async () => {
  const timers = [], reply = {authenticated:true,name:'Synthetic Sales',role:'sales',centralUserId:'synthetic'};
  const h = boot(reply, {users:[],timers});
  await turn();
  assert.equal((await h.context.__fsSessionHandshake).authenticated,true);
  assert.ok(h.context.__fsSessionActorReady?.then,'bridge publishes a scheduling promise');
  let settled = false; h.context.__fsSessionActorReady.then(()=>{settled=true;});
  await turn();
  assert.equal(settled,false,'handshake alone must not imply installed actor');
  assert.equal(h.context.currentUser,'');
  h.context.userList.push({name:reply.name,role:reply.role});
  timers.shift().callback(); await turn();
  assert.equal(await h.context.__fsSessionActorReady,true,'completion is boolean only');
  assert.equal(h.context.currentUser,reply.name);
  assert.equal(h.context.afterUserChangeCalls,1);
});

test('anonymous, expired and unavailable sessions cannot publish actor completion', async () => {
  for (const options of [{reply:{authenticated:false}}, {reply:{authenticated:true,name:'Synthetic Sales'},status:401}, {reply:{authenticated:true,name:'Synthetic Sales'},unavailable:true}]) {
    const h = boot(options.reply, options);
    // Runtime consumes the separate transport promise with its own rejection handler.
    h.context.__fsSessionHandshake.catch(()=>{}); await turn();
    assert.equal(await h.context.__fsSessionActorReady,false);
    assert.equal(h.context.currentUser,'');
  }
});

test('an absent matching profile never installs an actor and empty-user timeout settles closed', async () => {
  const reply={authenticated:true,name:'Synthetic Sales',role:'sales',centralUserId:'synthetic'};
  const foreign=boot(reply,{users:[{name:'Someone else',role:'sales'}]}); await turn();
  assert.equal(await foreign.context.__fsSessionActorReady,false);
  assert.equal(foreign.context.currentUser,'');
  const timers=[], empty=boot(reply,{users:[],timers}); await turn();
  for(let count=0;timers.length&&count<110;count++) { timers.shift().callback(); await turn(); }
  assert.equal(await empty.context.__fsSessionActorReady,false);
  assert.equal(empty.context.currentUser,'');
});
