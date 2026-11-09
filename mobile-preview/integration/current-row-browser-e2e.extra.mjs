// Disposable browser and synthetic relay/test data; not the real mobile login flow.
test('synthetic row e2e: mobile brief screen to adapter, gateway, and PostgreSQL',async t=>{
 const {actualBrowser,browserValue,waitForDocument}=await import('./helpers/chat-journal-browser.mjs');
 const id='A08332';
 const baseline=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',brand:'Before',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[{name:'Synthetic',w:100,p:50,o:'fixture',note:'fixture',hero:false,actual:50,fda:{status:'fixture',cls:'fixture',icon:'?',tip:'fixture'},extra:'preserve'}]});
 sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const html=await readFile(new URL(process.env.FORMULA_MOBILE_PAGE_URL),'utf8');
 const ui=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));t.after(()=>{ui.closeAllConnections();return new Promise(resolve=>ui.close(resolve))});
 const origin='http://127.0.0.1:'+ui.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const expression=`(()=>{role='admin';state.jobs=[{...${JSON.stringify(baseline)},approvals:{pd:false,ra:false,rd:false,sales:false},messages:[],updated:'synthetic'}];state.notifications=[];showJobs();document.querySelector('[data-open="${id}"]').click();document.querySelector('[data-action="edit"]').click();FormulaSaveSimulation.simulateSave=async(_s,base,changes)=>{window.syntheticCaptured={base,changes};return {status:'conflict'}};let el=document.querySelector('#brief-w-0');el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#job-form button[type=submit]').click()})()`;
 await browser.send('Runtime.evaluate',{userGesture:true,expression});
 for(let i=0;i<100&&!(await browserValue(browser,'!!window.syntheticCaptured'));i++)await new Promise(resolve=>setTimeout(resolve,20));
 const captured=await browserValue(browser,'window.syntheticCaptured');assert.ok(captured);assert.deepEqual(captured.base,baseline);
 assert.equal(await browserValue(browser,"document.querySelector('#brief-w-0').value"),'120');
 captured.changes.rows=rowAdapter.adaptLegacyRows(captured.changes.rows,legacyCalculator.derive);
 const request=mobileSave.prepareSave({id,baseline,changes:captured.changes});
 const result=await mobileSave.submitSave(request,async(route,body)=>{
  const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('admin')},body:JSON.stringify(body)});return response.json();
 },()=>true);
 assert.equal(result.status,'saved');const stored=JSON.parse(sql(`select data from fs_records where id='${id}';`));
 assert.equal(stored.rows[0].w,120);assert.equal(stored.rows[0].actual,60);assert.equal(stored.rows[0].fda.status,'over');assert.equal(stored.rows[0].extra,'preserve');
 assert.throws(()=>legacyRowRenderer.renderRecord(stored),new RegExp(legacyRowRenderer.sentinel));
});
