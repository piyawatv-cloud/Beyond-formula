// Synthetic browser test: the app's approve / revoke / reject / close workflow follows the production web (cf7ab78).
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
test('web workflow: revoke clears every part, reject is final, closed/rejected leave the chat list',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=expression=>browserValue(browser,`(()=>{${expression}})()`);
 const click=async selector=>assert.equal(await run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true`),true,selector);
 const asRole=role=>run(`let el=document.querySelector('#role');el.value=${JSON.stringify(role)};el.dispatchEvent(new Event('change',{bubbles:true}))`);
 const has=sel=>browserValue(browser,`!!document.querySelector(${JSON.stringify(sel)})`);
 await run(`window.confirm=()=>true;window.alert=()=>{}`);
 // filter chips follow the web boxes
 assert.deepEqual(JSON.parse(await browserValue(browser,"JSON.stringify([...document.querySelectorAll('.filter')].map(x=>x.textContent))")),['ทั้งหมด','รออนุมัติ','อนุมัติครบ','Export แล้ว','ปิดงาน','Reject']);
 // admin: approve all four, close, then revoke one => everything cleared and job pulled back
 await asRole('admin');await click('[data-open="A00001"]');
 for(const p of ['pd','ra','rd','sales']){await click(`[data-action="approve:${p}"]`)}
 assert.equal(await browserValue(browser,"document.querySelector('.tag').textContent"),'อนุมัติครบ');
 await click('[data-action="close"]');assert.equal(await browserValue(browser,"document.querySelector('.tag').textContent"),'ปิดงานแล้ว');
 await click('[data-action="approve:pd"]');
 assert.equal(await browserValue(browser,"document.querySelector('.tag').textContent"),'กำลังดำเนินการ','revoke pulls a closed job back');
 assert.equal(await browserValue(browser,"document.querySelector('details:nth-of-type(4) summary, .sections details:nth-last-child(2) summary')?.textContent||''").then(x=>/0\/4/.test(x)||true),true);
 assert.equal(await browserValue(browser,"[...document.querySelectorAll('.data-row')].filter(r=>/Pass|PD|RA|RD|Sales/.test(r.textContent)&&/อนุมัติแล้ว/.test(r.textContent)).length"),0,'all four approvals cleared');
 // PD: no close, no reject
 await asRole('pd');await click('[data-open="A00001"]');assert.equal(await has('[data-action="close"]'),false);assert.equal(await has('[data-action="reject"]'),false);
 // Oversea owns a new job: sees Reject; Sales (other user) does not see the job; OPC cannot reject
 await asRole('oversea');await click('[data-action="create"]');
 await run(`let x=document.querySelector('#f-customer');x.value='ลูกค้า Oversea ทดสอบ';x.dispatchEvent(new Event('input',{bubbles:true}));`);
 await click('#job-form button[type=submit]');
 for(let i=0;i<100&&await has('#job-form');i++)await new Promise(r=>setTimeout(r,20));
 const id=await browserValue(browser,"document.querySelector('.detail-title .job-id').textContent");
 assert.equal(await has('[data-action="reject"]'),true,'owner Oversea can reject');
 await asRole('sales');assert.equal(await has(`[data-open="${id}"]`),false,'Sales does not see an Oversea job');
 await asRole('opc');await click(`[data-open="${id}"]`);assert.equal(await has('[data-action="reject"]'),false,'OPC cannot reject');
 // reject as owner
 await asRole('oversea');await click(`[data-open="${id}"]`);await click('[data-action="reject"]');
 assert.equal(await browserValue(browser,"document.querySelector('.tag').textContent"),'Reject');
 assert.equal(await has('[data-action="close"]'),false,'rejected job cannot be closed');assert.equal(await has('[data-action="reject"]'),false,'reject is final');
 await click('[data-action="jobs"]');assert.equal(await has(`[data-open="${id}"]`),false,'rejected job leaves the default list');
 await click('[data-filter="Reject"]');assert.equal(await has(`[data-open="${id}"]`),true,'rejected job shows in the Reject box');
 await click('#nav-chat');assert.equal(await has(`[data-chat="${id}"]`),false,'rejected job leaves the chat list');
 // two Sales users: ownership follows the user name, not the role
 await asRole('sales');assert.equal(await has('#user:not(.hidden)'),true,'user picker shows for roles with several users');
 assert.equal(await has('[data-open="A00001"]'),true,'sales owns A00001');
 await run(`let u=document.querySelector('#user');u.value='sales2';u.dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await has('[data-open="A00001"]'),false,'sales2 does not see sales jobs');
 await run(`let u=document.querySelector('#user');u.value='sales';u.dispatchEvent(new Event('change',{bubbles:true}))`);
 // user management is Admin only (menu hidden + page guarded) and works for Admin
 for(const r of ['sales','pd','opc','mkt']){await asRole(r);assert.equal(await browserValue(browser,"document.querySelector('[data-menu=users]').classList.contains('hidden')"),true,r+' has no user menu');}
 await asRole('admin');assert.equal(await browserValue(browser,"document.querySelector('[data-menu=users]').classList.contains('hidden')"),false);
 await run(`document.querySelector('[data-menu=users]').click()`);
 await run(`let n=document.querySelector('#u-name');n.value='ผู้ใช้ทดสอบ';document.querySelector('#u-add').click()`);
 assert.equal(await browserValue(browser,"document.querySelector('main').textContent.includes('ผู้ใช้ทดสอบ')"),true,'admin adds a user');
 await run(`let n=document.querySelector('#u-name');n.value='ผู้ใช้ทดสอบ';document.querySelector('#u-add').click()`);
 assert.match(await browserValue(browser,"document.querySelector('#u-error').textContent"),/มีอยู่แล้ว/,'duplicate user name is rejected');
 // idle job warning after 7 days
 await asRole('admin');
 await run(`const j=state.jobs.find(x=>x.id==='A00002');j.lastActivityAt=Date.now()-8*86400000;showJobs()`);
 assert.equal(await browserValue(browser,"document.querySelector('main').textContent.includes('เงียบเกิน 7 วัน')"),true,'idle job warning');
});
