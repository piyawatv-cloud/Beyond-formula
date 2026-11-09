import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const sealed = await readFile(new URL('releases/cf7ab7813cbe/index.html', root), 'utf8');
const gate = await readFile(new URL('runtime/assets/fs-admin-activity-log.js', root), 'utf8');
const admin = { authenticated: true, role: 'admin', name: 'Synthetic Admin', email: 'admin@example.test', centralUserId: 'synthetic-admin', expiresAt: new Date(1_700_000_060_000).toISOString() };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness({ missing, session = admin, status = 200, compatible = true } = {}) {
  const nodes = new Map();
  function node(id) {
    const classes = new Set(id === 'actView' ? ['view'] : []), attrs = new Map();
    return { id, style: { display: id === 'sideActivities' ? 'none' : '' }, textContent: '',
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle: (value, on) => on ? classes.add(value) : classes.delete(value) },
      setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key), removeAttribute: key => attrs.delete(key) };
  }
  for (const id of ['sideActivities', 'actView', 'actContent', 'dashView']) if (id !== missing) nodes.set(id, node(id));
  const body = { appendChild(child) { nodes.set(child.id, child); } };
  const html = node('html'), events = new Map(), documentEvents = new Map(), timers = new Map(), requests = [], storageWrites = [];
  let now = 1_700_000_000_000, timerId = 0, response = session, responseStatus = status, pending;
  const activities = [{ uid: 'synthetic-pending-activity', action: 'Pending local activity' }];
  const context = { console, Promise, Date: class extends Date { static now() { return now; } },
    currentUser: 'Synthetic Admin', impersonator: '', activities,
    __fsAdminActivityLogCompatible: compatible,
    document: { body, createElement: () => node(''), documentElement: html, visibilityState: 'visible', getElementById: id => nodes.get(id) || null, addEventListener: (name, fn) => documentEvents.set(name, fn) },
    localStorage: { setItem: (...args) => storageWrites.push(args), removeItem: (...args) => storageWrites.push(args) },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => events.set(name, fn),
    fetch: (url, options) => {
      requests.push({ url, options });
      if (pending) return pending;
      return Promise.resolve({ status: responseStatus, json: async () => response });
    },
    renderActivities: () => { if (nodes.has('actContent')) nodes.get('actContent').textContent = 'Synthetic rendered activity row'; },
    renderUserUI: () => { if (nodes.has('sideActivities')) nodes.get('sideActivities').style.display = 'flex'; },
    switchView: view => { nodes.get('actView')?.classList.toggle('on', view === 'act'); nodes.get('dashView').classList.toggle('on', view === 'dash'); if (view === 'act') context.renderActivities(); },
    afterUserChange: () => context.renderUserUI(), logoutUser: () => { context.currentUser = ''; context.afterUserChange(); },
  };
  context.window = context;
  vm.runInNewContext(gate, context, { filename: 'fs-admin-activity-log.js' });
  const visible = () => html.getAttribute('data-fs-admin-activity-log') === 'ready' && nodes.get('sideActivities')?.style.display === 'flex';
  return { context, nodes, activities, storageWrites, requests, visible, events,
    respond: (value, code = 200) => { response = value; responseStatus = code; pending = null; },
    hold: () => { let resolve; pending = new Promise(done => { resolve = done; }); return value => resolve({ status: 200, json: async () => value }); },
    advance: async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await settle(); },
  };
}

test('sealed Activities anchors pin the runtime contract and legacy permission comes from the client', () => {
  assert.equal(sealed.split('<button class="side-item" id="sideActivities" style="display:none" onclick="switchView(\'act\')">').length, 2);
  assert.equal(sealed.split('<div id="actView" class="view">\n  <div id="actContent"></div>\n</div>').length, 2);
  const navigation = sealed.match(/function switchView\(v\) \{([\s\S]*?)\n\}/)?.[0];
  assert.ok(navigation);
  let alerts = 0;
  vm.runInNewContext(`${navigation}; switchView('act');`, { can: () => false, alert: () => alerts++ });
  assert.equal(alerts, 1, 'the sealed navigation consults local can(), so it needs the trusted runtime gate');
});

test('Activities starts hidden until a fresh server response confirms admin', async () => {
  const h = harness();
  assert.equal(h.visible(), false);
  h.context.renderActivities();
  assert.equal(h.nodes.get('actContent').textContent, '', 'pending session must suppress rendered activity rows');
  await settle();
  assert.equal(h.visible(), true);
  assert.equal(h.requests[0].url, '/sb/session');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
  assert.equal(h.requests[0].options.cache, 'no-store');
  h.context.switchView('act'); await settle();
  assert.equal(h.nodes.get('actView').classList.contains('on'), true);
  assert.equal(h.nodes.get('actContent').textContent, 'Synthetic rendered activity row');
});

for (const [name, session, status] of [
  ['non-admin', { ...admin, role: 'sales' }, 200],
  ['missing', { authenticated: false }, 401],
  ['unavailable', { authenticated: false }, 503],
  ['malformed authentication', { ...admin, authenticated: 'true' }, 200],
  ['expired', { ...admin, expiresAt: new Date(1_699_999_999_999).toISOString() }, 200],
]) test(`${name} session cannot expose Activities even when the local UI claims admin`, async () => {
  const h = harness({ session, status }); await settle();
  h.context.renderUserUI(); h.context.switchView('act'); h.context.renderActivities(); await settle();
  assert.equal(h.visible(), false);
  assert.equal(h.nodes.get('actView').classList.contains('on'), false);
  assert.equal(h.nodes.get('actContent').textContent, '');
  assert.equal(h.activities.length, 1); assert.deepEqual(h.storageWrites, []);
});

test('a changed session immediately hides and clears rendered rows while preserving pending local data', async () => {
  const h = harness(); await settle(); h.context.switchView('act'); await settle();
  h.respond({ ...admin, name: 'Synthetic Sales', role: 'sales' });
  h.context.currentUser = 'Synthetic Sales'; h.context.afterUserChange();
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent').textContent, '');
  assert.equal(h.nodes.get('dashView').classList.contains('on'), true, 'revoking an open log must leave a usable view');
  await settle();
  assert.equal(h.nodes.get('actView').classList.contains('on'), false);
  assert.equal(h.activities[0].uid, 'synthetic-pending-activity'); assert.deepEqual(h.storageWrites, []);
});

test('logout invalidates an outstanding admin response and cannot reopen the log', async () => {
  const h = harness(); await settle();
  const release = h.hold(); h.context.switchView('act');
  h.context.logoutUser(); release(admin); await settle();
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent').textContent, '');
  assert.equal(h.nodes.get('actView').classList.contains('on'), false);
});

test('session expiry clears an open log even if a later session request never settles', async () => {
  const h = harness({ session: { ...admin, expiresAt: new Date(1_700_000_001_000).toISOString() } });
  await settle(); h.context.switchView('act'); await settle(); h.hold();
  await h.advance(1001);
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent').textContent, '');
  assert.equal(h.nodes.get('actView').classList.contains('on'), false);
  assert.equal(h.activities.length, 1);
});

test('returning to the tab revalidates session and a denial clears previously rendered rows', async () => {
  const h = harness(); await settle(); h.context.switchView('act'); await settle();
  h.respond({ authenticated: false }, 401); h.events.get('focus')?.(); await settle();
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent').textContent, '');
  assert.equal(h.nodes.get('actView').classList.contains('on'), false);
});

for (const missing of ['sideActivities', 'actView', 'actContent']) test(`missing ${missing} fails closed`, async () => {
  const h = harness({ missing }); await settle(); h.context.renderUserUI(); h.context.renderActivities();
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent')?.textContent || '', '');
});

test('failed server compatibility never grants Activities', async () => {
  const h = harness({ compatible: false }); await settle(); h.context.renderActivities();
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent').textContent, '');
});

test('an older admin response cannot override a newer non-admin session check', async () => {
  const h = harness(); await settle();
  const release = h.hold(); h.context.switchView('act');
  h.respond({ ...admin, role: 'sales' }); h.context.afterUserChange(); await settle();
  release(admin); await settle();
  assert.equal(h.visible(), false); assert.equal(h.nodes.get('actContent').textContent, '');
  assert.equal(h.nodes.get('actView').classList.contains('on'), false);
});

 test('non-admin sees a safe activity status outside the hidden log payload', async () => {
  const h=harness({session:{...admin,role:'sales'}}); await settle();
  const status=h.nodes.get('fsActivityLogStatus');
  assert.ok(status,'the safe status is rendered');
  assert.equal(status.textContent,'ไม่มีสิทธิ์ดูบันทึกกิจกรรม');
  assert.equal(status.hidden,false);
  assert.equal(status.getAttribute('role'),'status');
  assert.equal(h.nodes.get('actContent').textContent,'');
  h.respond(admin); h.events.get('focus')(); await settle();
  assert.equal(status.hidden,true,'an authorized admin no longer sees a denial');
});

test('routine legacy UI repaint preserves the non-admin safe status',async()=>{
 const h=harness({session:{...admin,role:'sales'}});await settle();
 h.context.renderUserUI();h.context.renderActivities();
 assert.equal(h.nodes.get('fsActivityLogStatus').hidden,false);
 assert.equal(h.nodes.get('actContent').textContent,'');
});
