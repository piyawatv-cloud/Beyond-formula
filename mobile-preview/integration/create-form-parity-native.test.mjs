// Synthetic preview: the create-brief form accepts the same inputs as the web form.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);

test('create form: concept chips, sales owner, auto-fill and totals match the web form',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';
 const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=expression=>browserValue(browser,`(()=>{${expression}})()`);
 // admin picks the Sales owner from a list
 await run(`let role=document.querySelector('#role');role.value='admin';role.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-menu=create]').click()`);
 assert.equal(await browserValue(browser,"document.querySelector('#f-salesOwner').tagName"),'SELECT');
 assert.equal(await browserValue(browser,"document.querySelectorAll('[data-concept]').length"),8,'8 concept chips like the web');
 await run(`document.querySelector('#f-customer').value='ลูกค้าทดสอบ';document.querySelector('#f-brand').value='แบรนด์ทดสอบ';document.querySelector('[data-concept^="ผิวขาว"]').click();document.querySelector('[data-concept^="ลดสิว"]').click();let c=document.querySelector('#f-conceptStr');c.value=c.value+' + Beauty Sleep';c.dispatchEvent(new Event('input',{bubbles:true}))`);
 assert.equal(await browserValue(browser,"document.querySelector('#f-conceptStr').value"),'ผิวขาว / Whitening + ลดสิว / Anti-Acne + Beauty Sleep');
 assert.equal(await browserValue(browser,"document.querySelector('[data-concept^=\"ผิวขาว\"]').getAttribute('aria-pressed')"),'true');
 // auto-fill ingredients and totals
 await run(`document.querySelector('[data-template=whitening]').click()`);
 assert.equal(await browserValue(browser,"document.querySelectorAll('[id^=brief-name-]').length"),7);
 assert.match(await browserValue(browser,"document.querySelector('#brief-total').textContent"),/รวมทั้งหมด 1150\.00 mg/);
 assert.match(await browserValue(browser,"document.querySelector('#brief-fda-0').textContent"),/สถานะ อย\./,'per-ingredient อย. status shown');
 await run(`document.querySelector('#job-form button[type=submit]').click()`);
 assert.equal(await browserValue(browser,"document.querySelector('#job-form')===null"),true,'form saved and left');
 // detail shows web-derived defaults: benefits from the concept KB and the suggested target
 const text=await browserValue(browser,"document.body.textContent");
 assert.ok(text.includes('ผู้หญิงอายุ 20–40 ปี'),'target group suggested from the first concept');
 assert.ok(text.includes('ช่วยลดการสร้างเม็ดสีเมลานิน'),'claims suggested from concept KB');
 // sales role: owner locked to the signed-in sales user
 await run(`let role=document.querySelector('#role');role.value='sales';role.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-menu=create]').click()`);
 assert.equal(await browserValue(browser,"document.querySelector('#f-salesOwner').disabled"),true);
});
