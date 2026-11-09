// Synthetic preview: activity log, dashboard counts and per-job edit history.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);

test('actions are logged, filtered for admin, counted on the dashboard and shown per job',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';
 const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=expression=>browserValue(browser,`(()=>{${expression}})()`);
 const setRole=value=>run(`let r=document.querySelector('#role');r.value='${value}';r.dispatchEvent(new Event('change',{bubbles:true}))`);
 await run(`window.confirm=()=>true;window.alert=()=>{}`);
 // Sales closes then reopens its own job -> two 'close' entries
 assert.equal(await browserValue(browser,'state.activities.length'),0,'fresh state has no activity');
 await run(`detail('A00001')`);
 await run(`document.querySelector('[data-action="close"]').click()`);
 assert.equal(await browserValue(browser,"state.activities.filter(e=>e.cat==='close').length"),1);
 await run(`document.querySelector('[data-action="close"]').click()`);
 assert.equal(await browserValue(browser,"state.activities.filter(e=>e.cat==='close').length"),2);
 const entry=JSON.parse(await browserValue(browser,'JSON.stringify(state.activities[0])'));
 for(const key of ['ts','at','user','role','cat','action','detail','job','via'])assert.ok(key in entry,'activity keeps the web schema field '+key);
 // Dashboard matches the pure counter and renders on screen
 await run(`extras('dash')`);
 assert.match(await browserValue(browser,"document.querySelector('main').textContent"),/ทั้งหมด \(กำลังดำเนินการ\)/);
 const stats=JSON.parse(await browserValue(browser,'JSON.stringify(dashStats(state,"admin"))'));
 assert.equal(stats.total+stats.closed,await browserValue(browser,'state.jobs.length'),'every job is counted once');
 // Activity log is admin only, filterable by category
 await run(`extras('activity')`);
 assert.equal(await browserValue(browser,"!!document.querySelector('#act-cat')"),false,'non-admin cannot open the activity log');
 await setRole('admin');
 await run(`extras('activity')`);
 assert.equal(await browserValue(browser,"document.querySelectorAll('main .job').length"),2);
 await run(`let s=document.querySelector('#act-cat');s.value='chat';s.dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await browserValue(browser,"document.querySelectorAll('main .job').length"),0,'filter hides other categories');
 // Per-job edit history lists only job/formula entries
 await run(`detail('A00001')`);
 assert.match(await browserValue(browser,"document.querySelector('main').textContent"),/ประวัติการแก้ไขงาน \(0\)/,'close/reopen are not edit-log entries');
});
