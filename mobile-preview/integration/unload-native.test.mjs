// Local, synthetic preview only; actual headless Chromium, disposable profile.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('unfinished brief warns on browser reload and keeps the draft when canceled',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser,'Chromium is required');await waitForDocument(browser,origin);await browser.send('Page.enable');
 const interaction=await browser.send('Runtime.evaluate',{userGesture:true,expression:`(()=>{document.querySelector('[data-action="create"]').click();const input=document.querySelector('#f-customer');input.value='ข้อมูลทดลองยังไม่บันทึก';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,returnByValue:true});assert.equal(interaction.result?.result?.value,true);
 const reload=browser.send('Page.reload');const deadline=Date.now()+8000;while(!browser.dialogs.length&&Date.now()<deadline)await pause(25);
 assert.equal(browser.dialogs.at(-1)?.type,'beforeunload','browser must show its standard warning');
 await browser.send('Page.handleJavaScriptDialog',{accept:false});await reload;
 assert.equal(await browserValue(browser,"document.querySelector('#f-customer').value"),'ข้อมูลทดลองยังไม่บันทึก');
 await browser.send('Runtime.evaluate',{userGesture:true,expression:"document.querySelector('#job-form button[type=submit]').click()"});
 const savedDeadline=Date.now()+5000;while(await browserValue(browser,"!!document.querySelector('#job-form')")&&Date.now()<savedDeadline)await pause(25);
 assert.equal(await browserValue(browser,"!!document.querySelector('#job-form')"),false,'demo save should open details');
 const reloadSaved=browser.send('Page.reload');const savedDialogDeadline=Date.now()+8000;while(browser.dialogs.length<2&&Date.now()<savedDialogDeadline)await pause(25);
 assert.equal(browser.dialogs[1]?.type,'beforeunload','saved in-memory demo data also requires warning');
 await browser.send('Page.handleJavaScriptDialog',{accept:false});await reloadSaved;
 assert.equal(await browserValue(browser,'document.querySelector("main h1").textContent'),'ข้อมูลทดลองยังไม่บันทึก');
});
