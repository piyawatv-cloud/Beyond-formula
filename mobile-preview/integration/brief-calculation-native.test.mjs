// Synthetic page in disposable Chromium; no database or regulatory check.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('brief ingredient edit updates the illustrative stored amount',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 await browser.send('Runtime.evaluate',{userGesture:true,expression:`document.querySelector('[data-open="A00001"]').click();document.querySelector('[data-action="edit"]').click();let el=document.querySelector('#brief-w-0');el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#job-form button[type=submit]').click()`});
 for(let i=0;i<100&&await browserValue(browser,"!!document.querySelector('#job-form')");i++)await pause(20);
 assert.equal(await browserValue(browser,"state.jobs.find(j=>j.id==='A00001').rows[0].actual"),60);
 assert.equal(await browserValue(browser,"document.querySelector('main').textContent.includes('60.00 mg')"),true);
});
