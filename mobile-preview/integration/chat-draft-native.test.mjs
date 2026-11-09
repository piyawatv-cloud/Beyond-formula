// Synthetic preview: protect an unsent message when leaving the chat screen.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);

test('unsent chat survives a cancelled navigation and sends without a warning',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';
 const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=expression=>browserValue(browser,`(()=>{${expression}})()`);
 await run(`document.querySelector('[data-open="A00001"]').click();document.querySelector('[data-action="open-chat"]').click();window.confirmations=[];window.confirm=message=>{window.confirmations.push(message);return false};let input=document.querySelector('#message');input.value='ข้อความที่ยังไม่ส่ง';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action="back-detail"]').click()`);
 assert.equal(await browserValue(browser,'window.confirmations.length'),1,'leaving an unsent message needs confirmation');
 assert.equal(await browserValue(browser,"document.querySelector('#message')?.value"),'ข้อความที่ยังไม่ส่ง');
 await run(`let role=document.querySelector('#role');role.value='pd';role.dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await browserValue(browser,'window.confirmations.length'),2,'role change needs confirmation');
 assert.equal(await browserValue(browser,"document.querySelector('#role').value"),'sales');
 assert.equal(await browserValue(browser,"document.querySelector('#message')?.value"),'ข้อความที่ยังไม่ส่ง');
 await run(`document.querySelector('#chat-form button[type=submit]').click()`);
 assert.equal(await browserValue(browser,'window.confirmations.length'),2,'sending should not ask to discard the message');
 assert.equal(await browserValue(browser,"document.querySelector('.messages').textContent.includes('ข้อความที่ยังไม่ส่ง')"),true);
 await run(`document.querySelector('[data-action="back-detail"]').click()`);
 assert.equal(await browserValue(browser,'window.confirmations.length'),2,'leaving after sending should not warn');
 await run(`document.querySelector('[data-action="open-chat"]').click();let input=document.querySelector('#message');input.value='ข้อความที่ยอมทิ้ง';input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=message=>{window.confirmations.push(message);return true};document.querySelector('[data-action="back-detail"]').click()`);
 assert.equal(await browserValue(browser,'window.confirmations.length'),3,'discarding an unsent message requires consent');
 assert.equal(await browserValue(browser,"!!document.querySelector('#message')"),false,'accepted navigation leaves the chat');
 await run(`document.querySelector('[data-action="open-chat"]').click()`);
 assert.equal(await browserValue(browser,"document.querySelector('#message').value"),'','discarded text is not sent or restored');
 assert.equal(await browserValue(browser,"document.querySelector('.messages').textContent.includes('ข้อความที่ยอมทิ้ง')"),false);
});
