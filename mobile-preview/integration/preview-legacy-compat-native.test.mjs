// Capture a synthetic record produced by the mobile screen and exercise the handoff renderer fragment.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {actualBrowser,browserValue,waitForDocument} from '../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs';
const require=createRequire(import.meta.url),{renderRecord,sentinel}=require('./legacy-render-fixture.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('mobile-created synthetic job exposes handoff renderer incompatibilities',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=x=>browserValue(browser,`(()=>{${x}})()`);
 await run(`document.querySelector('[data-action="create"]').click();let el=document.querySelector('#f-customer');el.value='ลูกค้าสมมติ';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#job-form button[type=submit]').click()`);
 for(let i=0;i<100&&await browserValue(browser,"!!document.querySelector('#job-form')");i++)await pause(20);
 const id=await browserValue(browser,"document.querySelector('.detail-title .job-id')?.textContent");assert.match(id,/^A\d{5}$/);
 await run(`let el=document.querySelector('#role');el.value='pd';el.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-open="${id}"]').click();document.querySelector('[data-action="formula"]').click();el=document.querySelector('#new-ing');el.value='สารสมมติ';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#formula-form button[type=submit]').click()`);
 for(let i=0;i<100&&await browserValue(browser,"!!document.querySelector('#formula-form')");i++)await pause(20);
 const record=await browserValue(browser,`state.jobs.find(j=>j.id===${JSON.stringify(id)})`);
 assert.equal(record.rows[0].name,'สารสมมติ');assert.equal(record.allConcepts,undefined);
 assert.throws(()=>renderRecord(record),/length/,'missing derived concept list breaks handoff renderer');
 const withLists={...record,allConcepts:[],allBenefits:[],allSP:[],cons:[]};
 assert.throws(()=>renderRecord(withLists),/fda|cls/,'ingredient from mobile is not handoff-renderable');
 const illustrative={...withLists,rows:[{...record.rows[0],w:100,p:50,actual:50,fda:{cls:'synthetic',icon:'?',tip:'synthetic'}}]};
 assert.throws(()=>renderRecord(illustrative),new RegExp(sentinel),'synthetic complete row reaches table append only');
});
