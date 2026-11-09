// Synthetic browser test: login screen, live jobs, approve/close/reject/chat go through the native bridge (stubbed gateway).
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {actualBrowser,browserValue,waitForDocument}=await import(process.env.FORMULA_TEST_BROWSER_HELPER_URL||new URL('../../_IT-handoff/formula-studio/tests/helpers/chat-journal-browser.mjs',import.meta.url).href);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('live mode UI uses the native bridge for login, reads and writes, and falls back to login on 401',async t=>{
 const html=await readFile(new URL('../index.html',import.meta.url));
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const run=expression=>browserValue(browser,`(()=>{${expression}})()`);
 const wait=async(expr,label)=>{for(let i=0;i<150;i++){if(await browserValue(browser,expr))return;await pause(30)}assert.fail('timeout: '+label+' | page: '+await browserValue(browser,"(document.querySelector('#error')?.textContent||'')+' // '+document.querySelector('main').textContent.slice(0,60)+' // jobs='+JSON.stringify(state.jobs.map(j=>j.id+':'+j.createdBy))+' // log='+window.__log.slice(-6).join(',')"))};
 // stub the Android bridge with a tiny gateway
 await run(`window.confirm=()=>true;window.alert=()=>{};window.__log=[];window.__authed=true;
  const rec={id:'A09001',data:{id:'A09001',customer:'ลูกค้าทดสอบ',brand:'B',createdBy:'sales',salesOwner:'sales',rows:[]},updated_at:'2026-10-29T01:00:00Z'};
  window.__state={rec,apv:[],msgs:[]};
  window.FormulaNative={httpAsync(id,method,path,headers,body){setTimeout(()=>{window.__log.push(method+' '+path.split('?')[0]);let status=200,out;
    const S=window.__state;
    if(path==='/sb/session'){if(method==='POST'){const b=JSON.parse(body);if(b.password!=='ok'){status=401;out={}}else out={authenticated:true}}else if(method==='GET')out=window.__authed?{authenticated:true,name:'sales',role:'sales',canEdit:true,expiresAt:'2026-10-30T00:00:00Z'}:(status=401,{authenticated:false});else out={}}
    else if(!window.__authed){status=401;out={message:'x'}}
    else if(path.startsWith('/sb/rest/v1/fs_records')){const idm=/id=in[.][(]%22([A-Z0-9]+)%22[)]/.exec(path);const made=(S.created||[]).map(d=>({id:d.id,data:d,updated_at:'2026-10-29T03:00:00Z'}));const all=[S.rec,...made];out=idm?all.filter(r=>r.id===idm[1]):all}
    else if(path.startsWith('/sb/rest/v1/fs_approvals'))out=S.apv.map(p=>({job_id:'A09001',part:p,data:{by:'sales',at:'t',ts:1},updated_at:'2026-10-29T01:00:00Z'}));
    else if(path.startsWith('/sb/rest/v1/fs_messages')&&method==='GET')out=S.msgs;
    else if(path.startsWith('/sb/rest/v1/fs_messages')){const rows=JSON.parse(body);S.msgs.push(...rows);out=rows}
    else if(path==='/sb/rest/v1/rpc/fs_next_rec_seq'){window.__seq=(window.__seq||9001)+1;out=window.__seq}
    else if(path==='/sb/rest/v1/fs_chats'){out=JSON.parse(body)}
    else if(path==='/sb/rest/v1/rpc/fs_save_record'&&JSON.parse(body).p_expected===null){const b=JSON.parse(body);window.__created=b;S.created=S.created||[];S.created.push(b.p_data);out={status:'saved',id:b.p_id}}
    else if(path==='/__formula/approval-change'){const b=JSON.parse(body);window.__approvalBody=b;if(b.action==='approve')S.apv.push(b.part);else S.apv=[];out={status:'saved',id:b.id,operation:b.operation,replayed:false}}
    else if(path==='/sb/rest/v1/rpc/fs_save_record'){const b=JSON.parse(body);S.rec={id:b.p_id,data:b.p_data,updated_at:'2026-10-29T02:00:00Z'};out={status:'saved',id:b.p_id}}
    else{status=404;out={}}
    window.__nativeHttpDone(id,JSON.stringify({status,body:JSON.stringify(out)}))},5)}};updateMenu()`);
 assert.equal(await browserValue(browser,"!document.querySelector('#menu-live').classList.contains('hidden')"),true,'live menu appears inside the app');
 await run(`document.querySelector('[data-menu=live]').click()`);
 assert.equal(await browserValue(browser,"!!document.querySelector('#login-form')"),true,'login form');
 // wrong password
 await run(`document.querySelector('#l-user').value='sales';document.querySelector('#l-pass').value='bad';document.querySelector('#login-form button').click()`);
 await wait("document.querySelector('#error')?.textContent.includes('ไม่ถูกต้อง')",'bad login message');
 assert.equal(await browserValue(browser,"document.querySelector('#l-pass').value"),'','password cleared after a failed login');
 // good login
 await run(`document.querySelector('#l-user').value='sales';document.querySelector('#l-pass').value='ok';document.querySelector('#login-form button').click()`);
 await wait("!!document.querySelector('[data-open=\"A09001\"]')",'live job listed');
 assert.equal(await browserValue(browser,"document.querySelector('#role').disabled"),true,'role comes from the session');
 assert.equal(await browserValue(browser,"document.querySelector('main').textContent.includes('ข้อมูลจากระบบจริง')"),true);
 assert.equal(await browserValue(browser,"window.__log.some(x=>/^POST \\/sb\\/session/.test(x))&&JSON.stringify(window.__log).indexOf('ok')<0"),true);
 // approve through the server command
 await run(`document.querySelector('[data-open="A09001"]').click()`);
 await run(`document.querySelector('[data-action="approve:sales"]').click()`);
 await wait("window.__approvalBody&&window.__approvalBody.part==='sales'&&window.__approvalBody.action==='approve'",'approve sent');
 assert.equal(await browserValue(browser,"Object.keys(window.__approvalBody).sort().join()"),'action,approvals,expected,id,operation,part','exact request shape the gateway validates');
 await wait("document.querySelector('.detail-title .tag')&&/อนุมัติ|กำลัง/.test(document.querySelector('.detail-title .tag').textContent)",'detail redrawn');
 // withdraw
 await run(`document.querySelector('[data-action="approve:sales"]').click()`);
 await wait("window.__approvalBody.action==='withdraw'",'withdraw sent');
 // close then reject is final
 await run(`document.querySelector('[data-action="close"]').click()`);
 await wait("document.querySelector('.detail-title .tag')?.textContent.includes('ปิดงานแล้ว')",'closed from server');
 await run(`document.querySelector('[data-action="close"]').click()`);
 await wait("!document.querySelector('.detail-title .tag')?.textContent.includes('ปิดงานแล้ว')",'reopened');
 await run(`document.querySelector('[data-action="reject"]').click()`);
 await wait("document.querySelector('.detail-title .tag')?.textContent.includes('Reject')",'rejected from server');
 assert.equal(await browserValue(browser,"!!document.querySelector('[data-action=reject]')||!!document.querySelector('[data-action=close]')"),false,'no close/reject after reject');
 // chat send
 await run(`document.querySelector('[data-action="open-chat"]').click()`);
 await wait("!!document.querySelector('#message')",'chat opened');
 await run(`let m=document.querySelector('#message');m.value='ข้อความจากมือถือ';m.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#chat-form button[type=submit]').click()`);
 await wait("document.querySelector('.messages').textContent.includes('ข้อความจากมือถือ')",'message shown from server');
 assert.equal(await browserValue(browser,"window.__state.msgs.some(m=>m.data.text==='ข้อความจากมือถือ'&&m.data.user==='sales')"),true,'message stored through the gateway as the session user');
 // create a real job through the form: server sequence + CAS save with no previous version
 await run(`document.querySelector('[data-menu=create]').click()`);
 await wait("!!document.querySelector('#job-form')",'create form');
 await run(`let c=document.querySelector('#f-customer');c.value='ลูกค้าสร้างจากมือถือ';c.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#job-form button[type=submit]').click()`);
 await wait("window.__created&&window.__created.p_data.id==='A09002'",'server issued id and saved');
 assert.equal(await browserValue(browser,"window.__created.p_expected===null&&window.__created.p_data.createdBy==='sales'&&window.__created.p_data.salesOwner==='sales'"),true,'new job saved without a prior version, owner locked');
 await wait("document.querySelector('.detail-title .job-id')?.textContent==='A09002'",'opens the new job');
 // plain-model write is still blocked (live writes only go through the server)
 assert.equal(await browserValue(browser,"(()=>{try{create(state,'sales',{customer:'x'});return 'allowed'}catch(e){return e.message}})()").then(x=>/อ่านอย่างเดียว/.test(x)),true);
 // session expiry => login screen
 await run(`window.__authed=false;livePoll=livePoll;liveApi.changesSince('2026-10-29T00:00:00Z').catch(liveFail)`);
 await wait("!!document.querySelector('#login-form')",'back to login on 401');
 assert.equal(await browserValue(browser,"state.live===undefined||state.live===false"),true,'live data dropped after logout');
});
