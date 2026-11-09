// Synthetic local file and disposable Chromium profile only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
test('same rejected file can be selected again in Chromium',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'formula-import-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'synthetic.csv');await writeFile(file,'customer_name,ตัวอย่าง\nunknown,ข้อมูล');
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 await browser.send('Runtime.evaluate',{userGesture:true,expression:`document.querySelector('[data-action="create"]').click();window.importChanges=0;document.querySelector('#csv-file').addEventListener('change',()=>window.importChanges++)`});
 const doc=await browser.send('DOM.getDocument');const match=await browser.send('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'#csv-file'});
 await browser.send('DOM.setFileInputFiles',{nodeId:match.result.nodeId,files:[file]});
 for(let i=0;i<100&&!(await browserValue(browser,"document.querySelector('#csv-status').textContent"));i++)await new Promise(r=>setTimeout(r,20));
 assert.match(await browserValue(browser,"document.querySelector('#csv-status').textContent"),/ไม่รองรับ/);
 assert.equal(await browserValue(browser,"document.querySelector('#csv-file').value"),'');
 await browser.send('DOM.setFileInputFiles',{nodeId:match.result.nodeId,files:[file]});
 assert.equal(await browserValue(browser,'window.importChanges'),2,'selecting the same file triggers another change');
});
