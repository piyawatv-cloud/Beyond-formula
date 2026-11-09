// End-to-end screen exercise with synthetic data, not user acceptance or authorization testing.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('synthetic job moves through eight simulated roles',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=async expression=>browserValue(browser,`(()=>{${expression}})()`);
 const click=async selector=>assert.equal(await run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true`),true,selector);
 await click('[data-action="create"]');
 await run(`let x=document.querySelector('#f-customer');x.value='ลูกค้าทดสอบแปดบทบาท';x.dispatchEvent(new Event('input',{bubbles:true}));`);
 await click('#job-form button[type=submit]');
 for(let i=0;i<100&&await browserValue(browser,"!!document.querySelector('#job-form')");i++)await pause(20);
 const id=await browserValue(browser,"document.querySelector('.detail-title .job-id')?.textContent");assert.match(id,/^A\d{5}$/);
 for(const role of ['pd','sales','ra','rd','opc','mkt','purchasing','admin']){
  await run(`let el=document.querySelector('#role');el.value=${JSON.stringify(role)};el.dispatchEvent(new Event('change',{bubbles:true}));`);
  await click(`[data-open="${id}"]`);
  if(role==='pd'){
   await click('[data-action="formula"]');
   await run(`let el=document.querySelector('#new-ing');el.value='สารทดสอบ';el.dispatchEvent(new Event('input',{bubbles:true}));`);
   await click('#formula-form button[type=submit]');
   for(let i=0;i<100&&await browserValue(browser,"!!document.querySelector('#formula-form')");i++)await pause(20);
   assert.equal(await browserValue(browser,"document.querySelector('main').textContent.includes('สารทดสอบ')"),true,'PD ingredient saved in demo');
  }
  await click('[data-action="open-chat"]');
  const allowed=role==='admin'?['pd','ra','rd','sales']:role==='mkt'?['pd','sales']:['pd','ra','rd','sales'].filter(x=>x===role);
  assert.deepEqual(await browserValue(browser,"[...document.querySelectorAll('[data-action^=approve]')].map(x=>x.dataset.action.split(':')[1])"),allowed,role+' approval controls');
  await run(`let el=document.querySelector('#message');el.value=${JSON.stringify('ข้อความจำลอง '+role)};el.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('#chat-form button[type=submit]');
  assert.equal(await browserValue(browser,`document.querySelector('.messages').textContent.includes(${JSON.stringify('ข้อความจำลอง '+role)})`),true,role+' message');
  if(['sales','pd','ra','rd'].includes(role)){await click(`[data-action="approve:${role}"]`);assert.equal(await browserValue(browser,`document.querySelector('[data-action="approve:${role}"]')?.textContent.includes('ยกเลิกอนุมัติ')`),true,role+' approval');}
 }
 assert.equal(await browserValue(browser,"document.querySelector('.chat-heading + details summary').textContent.includes('4/4')"),true);
 assert.equal(await browserValue(browser,"!!document.querySelector('[data-action=export-chat-xlsx]')"),true,'admin sees post-approval export');
 await click('[data-action="back-detail"]');
 // confirm() is overridden only within this disposable synthetic browser page.
 await run('window.confirm=()=>true');await click('[data-action="close"]');
 assert.match(await browserValue(browser,"document.querySelector('.detail-title .tag').textContent"),/ปิด/);
 await click('[data-action="close"]');assert.doesNotMatch(await browserValue(browser,"document.querySelector('.detail-title .tag').textContent"),/ปิด/);
});
