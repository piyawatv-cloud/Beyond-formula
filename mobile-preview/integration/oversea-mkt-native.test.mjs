// Synthetic preview: MKT may approve on behalf of PD; Oversea has Sales-equivalent rights; ids are never reused.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);

test('MKT approves PD only, Oversea matches Sales, job and message ids are never reused',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';
 const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=expression=>browserValue(browser,`(()=>{${expression}})()`);
 await run(`window.confirm=()=>true;window.alert=()=>{}`);
 const salesLike=['create','chat','approve','close','own'];
 const perms=JSON.parse(await browserValue(browser,'JSON.stringify({sales:roles.sales,oversea:roles.oversea,mkt:roles.mkt})'));
 assert.deepEqual({...perms.oversea,export:undefined},{...perms.sales,export:undefined},'Oversea has the Sales permissions (web rule) plus Excel export');
 assert.equal(perms.oversea.export,1,'Oversea may export Excel');assert.equal(perms.sales.export,undefined,'Sales export stays unconfirmed (hidden)');
 assert.deepEqual(perms.mkt.approve,['pd','sales'],'MKT approves PD and Sales (web rule)');
 // behaviour through the model, not only the table
 const result=JSON.parse(await browserValue(browser,`JSON.stringify((()=>{
  const s=initialState(),out={};
  const j=create(s,'oversea',{customer:'Oversea synthetic',market:'Oversea',country:'Japan'});out.id=j.id;
  approve(s,'oversea',j.id,'sales');out.oseaSales=s.jobs.find(x=>x.id===j.id).approvals.sales;
  try{approve(s,'oversea',j.id,'pd');out.oseaPd='allowed'}catch(e){out.oseaPd='denied'}
  out.seesSalesJob=visible(s,'oversea').some(x=>x.id==='A00001');
  const k=create(s,'mkt',{customer:'MKT synthetic'});
  approve(s,'mkt',k.id,'pd');out.mktPd=s.jobs.find(x=>x.id===k.id).approvals.pd;approve(s,'mkt',k.id,'sales');out.mktSales=s.jobs.find(x=>x.id===k.id).approvals.sales;
  for(const part of ['ra','rd']){try{approve(s,'mkt',k.id,part);out['mkt_'+part]='allowed'}catch(e){out['mkt_'+part]='denied'}}
  const ids=s.jobs.map(x=>x.id);s.jobs=s.jobs.filter(x=>x.id!==k.id);const again=create(s,'sales',{customer:'After removal'});out.reused=ids.includes(again.id);
  send(s,'oversea',j.id,'a');send(s,'oversea',j.id,'b');const uids=s.jobs.flatMap(x=>x.messages.map(m=>m.uid)).filter(Boolean);out.uidsUnique=new Set(uids).size===uids.length&&uids.length>=2;
  return out})())`));
 assert.equal(result.oseaSales,true);assert.equal(result.oseaPd,'denied');assert.equal(result.seesSalesJob,false,'Oversea sees only its own jobs like Sales');
 assert.equal(result.mktPd,true);assert.equal(result.mktSales,true);
 for(const part of ['ra','rd'])assert.equal(result['mkt_'+part],'denied','MKT cannot approve '+part);
 assert.equal(result.reused,false,'a removed job number is not reissued');
 assert.equal(result.uidsUnique,true,'every message gets a unique id');
});
