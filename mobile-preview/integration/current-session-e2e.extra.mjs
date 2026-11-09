// Additional local diagnostic, appended only to a temporary upstream harness.
// IAM identity is synthetic; the experiment changes role/session after the UI check.
const mobileSave=(await import(process.env.FORMULA_MOBILE_CLIENT_URL)).default;
test('synthetic session e2e: invalidated before dispatch does not send',async()=>{
 const id='A08310',baseline=job(id,{createdBy:'Synthetic actor'});sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const request=mobileSave.prepareSave({id,baseline,changes:{notes:'Synthetic change'}});let calls=0;
 const result=await mobileSave.submitSave(request,async()=>{calls++;throw Error('unexpected dispatch')},()=>false);
 assert.equal(result.status,'session-changed');assert.equal(calls,0);assert.deepEqual(JSON.parse(sql(`select data from fs_records where id='${id}';`)),baseline);
});
test('synthetic session e2e: role switch after client precheck can write under new session',async()=>{
 const id='A08311',baseline=job(id,{createdBy:'Synthetic actor'});sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const request=mobileSave.prepareSave({id,baseline,changes:{notes:'Synthetic change'}});let current=true;
 const result=await mobileSave.submitSave(request,async(route,body)=>{
  current=false;const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('admin')},body:JSON.stringify(body)});return response.json();
 },()=>current);
 assert.equal(result.status,'session-changed-unconfirmed');
 const stored=JSON.parse(sql(`select data from fs_records where id='${id}';`));assert.equal(stored.notes,'Synthetic change');
});
test('synthetic session e2e: another synthetic account can receive a pending write',async()=>{
 const id='A08312',baseline=job(id,{createdBy:'Synthetic actor'});sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const request=mobileSave.prepareSave({id,baseline,changes:{notes:'Another synthetic user'} });let current=true,replyStatus;
 const actor={name:'Synthetic Other',role:'admin',centralUserId:'synthetic-other',exp:Date.now()+60000};
 const encoded=Buffer.from(JSON.stringify(actor)).toString('base64url');
 const otherCookie=`fs_session=${encoded}.${createHmac('sha256',sessionSecret).update(encoded).digest('base64url')}`;
 const result=await mobileSave.submitSave(request,async(route,body)=>{
  current=false;const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:otherCookie},body:JSON.stringify(body)});replyStatus=response.status;return response.json();
 },()=>current);
 assert.equal(replyStatus,200);assert.equal(result.status,'session-changed-unconfirmed');
 const stored=JSON.parse(sql(`select data from fs_records where id='${id}';`));assert.equal(stored.notes,'Another synthetic user');
});
test('synthetic session e2e: switched user without write role is denied',async()=>{
 const id='A08313',baseline=job(id,{createdBy:'Synthetic actor'});sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const request=mobileSave.prepareSave({id,baseline,changes:{notes:'Must not be stored'}});let current=true,serverResult;
 const actor={name:'Synthetic Other',role:'ra',centralUserId:'synthetic-other',exp:Date.now()+60000};
 const encoded=Buffer.from(JSON.stringify(actor)).toString('base64url');
 const otherCookie=`fs_session=${encoded}.${createHmac('sha256',sessionSecret).update(encoded).digest('base64url')}`;
 const result=await mobileSave.submitSave(request,async(route,body)=>{
  current=false;const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:otherCookie},body:JSON.stringify(body)});serverResult=await response.json();return serverResult;
 },()=>current);
 assert.equal(serverResult.status,'forbidden');assert.equal(result.status,'session-changed-unconfirmed');
 assert.deepEqual(JSON.parse(sql(`select data from fs_records where id='${id}';`)),baseline);
});
test('synthetic session e2e: browser cookie switches between precheck and dispatch',async t=>{
 const {actualBrowser,browserValue,waitForDocument}=await import('./helpers/chat-journal-browser.mjs');
 const id='A08314',baseline=job(id,{createdBy:'Synthetic actor'});sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const clientCode=await readFile(new URL(process.env.FORMULA_MOBILE_CLIENT_URL),'utf8');let forwarded=0,forwardedIdentity=null;
 const relay=createServer(async(req,res)=>{
  try{
   if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html'});return res.end('<!doctype html><script src="/mobile.js"></script>')}
   if(req.method==='GET'&&req.url==='/mobile.js'){res.writeHead(200,{'content-type':'application/javascript'});return res.end(clientCode)}
   if(req.method!=='POST'||req.url!=='/sb/rest/v1/rpc/fs_save_record'){res.writeHead(404);return res.end()}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);forwarded++;const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('fs_session='));if(token){const payload=token.slice('fs_session='.length).split('.')[0];forwardedIdentity=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')).centralUserId}
   const reply=await fetch(gatewayOrigin+req.url,{method:'POST',headers:{'content-type':'application/json',cookie:req.headers.cookie||''},body:Buffer.concat(chunks)});
   res.writeHead(reply.status,{'content-type':'application/json'});return res.end(await reply.text());
  }catch{res.writeHead(502);res.end('{}')}
 });
 const origin=await startLocalServer(relay);t.after(async()=>{relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve))});
 const browser=await actualBrowser(t,origin+'/');assert.ok(browser,'required Chromium test browser');await waitForDocument(browser,origin+'/');
 await browser.send('Network.enable');await browser.send('Network.setBlockedURLs',{urls:['https://*']});
 const setSession=async(value)=>{const result=await browser.send('Network.setCookie',{name:'fs_session',value,url:origin+'/'});assert.equal(result.error,undefined);const check=await browser.send('Network.getCookies',{urls:[origin+'/']});assert.ok(check.result?.cookies?.some(c=>c.name==='fs_session'&&c.value===value),'synthetic session cookie was not stored')};
 await setSession(cookie('sales').slice('fs_session='.length));
 const encoded=Buffer.from(JSON.stringify({name:'Synthetic Other',role:'admin',centralUserId:'synthetic-other',exp:Date.now()+60000})).toString('base64url');
 const nextCookie=`${encoded}.${createHmac('sha256',sessionSecret).update(encoded).digest('base64url')}`;
 const request=mobileSave.prepareSave({id,baseline,changes:{notes:'Browser controlled change'}});
 await browserValue(browser,`(()=>{window.sessionCurrent=true;window.transportStarted=false;window.operation=FormulaRuntimeJobSave.submitSave(${JSON.stringify(request)},async(route,body)=>{window.transportStarted=true;await new Promise(resolve=>window.releaseTransport=resolve);const response=await fetch('/sb/rest/v1/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return response.json()},()=>window.sessionCurrent);return true})()`);
 assert.equal(await browserValue(browser,'window.transportStarted'),true);assert.equal(forwarded,0);
 await setSession(nextCookie);await browserValue(browser,'(()=>{window.sessionCurrent=false;window.releaseTransport();return true})()');
 const result=await browserValue(browser,'window.operation');assert.equal(result.status,'session-changed-unconfirmed');assert.equal(forwarded,1);assert.equal(forwardedIdentity,'synthetic-other');
 assert.equal(JSON.parse(sql(`select data from fs_records where id='${id}';`)).notes,'Browser controlled change');
});
