// Synthetic only. Appended to an isolated, temporary gateway/PostgREST/PostgreSQL harness.
const rowAdapter=(await import(process.env.FORMULA_ROW_ADAPTER_URL)).default;
const legacyCalculator=(await import(process.env.FORMULA_ROW_CALCULATOR_URL)).default;
const legacyRowRenderer=(await import(process.env.FORMULA_ROW_RENDERER_URL)).default;
const syntheticBriefReader=(await import(process.env.FORMULA_ROW_BRIEF_URL)).default;
test('synthetic row e2e: adapted brief survives current gateway and temporary PostgreSQL',async t=>{
 const id='A08331';
 const baseline=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',brand:'Before',conceptStr:'Synthetic concept',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[{name:'Synthetic',w:100,p:50,o:'fixture',note:'fixture',hero:false,actual:50,fda:{status:'fixture',cls:'fixture',icon:'?',tip:'fixture'},extra:'preserve'}]});
 sql(`insert into fs_records(id,data) values ('${id}',${literal(baseline)});`);
 const changes=syntheticBriefReader.readBrief(baseline,{customer:'Synthetic',brand:'Before'},{0:{w:'120'}});
 changes.rows=rowAdapter.adaptLegacyRows(changes.rows,legacyCalculator.derive);
 const request=mobileSave.prepareSave({id,baseline,changes});
 const result=await mobileSave.submitSave(request,async(route,body)=>{
  const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales')},body:JSON.stringify(body)});return response.json();
 },()=>true);
 assert.equal(result.status,'saved');
 const stored=JSON.parse(sql(`select data from fs_records where id='${id}';`));
 assert.equal(stored.rows[0].w,120);assert.equal(stored.rows[0].actual,60);assert.equal(stored.rows[0].fda.status,'over');assert.equal(stored.rows[0].extra,'preserve');
 assert.throws(()=>legacyRowRenderer.renderRecord(stored),new RegExp(legacyRowRenderer.sentinel));
 const {actualBrowser,browserValue,waitForDocument}=await import('./helpers/chat-journal-browser.mjs');
 const legacyHtml=readFileSyncForCopy.bytes;
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"});res.end(legacyHtml)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
 const origin='http://127.0.0.1:'+server.address().port+'/';const browser=await actualBrowser(t,origin);assert.ok(browser);await waitForDocument(browser,origin);
 const view=await browserValue(browser,`(()=>{try{renderDashboard(${JSON.stringify(stored)});return {ok:true,table:document.querySelector('#d_formula_body').textContent,amount:document.querySelector('#d_tot_a').textContent}}catch(e){return {ok:false,error:String(e)}}})()`);
 assert.equal(view.ok,true,view.error);assert.match(view.table,/Synthetic/);assert.match(view.table,/120\.00/);assert.match(view.table,/60\.00/);assert.match(view.amount,/60\.00/);
 const stale=mobileSave.prepareSave({id,baseline:stored,changes:{brand:'stale synthetic'}});
 const newer={...stored,brand:'newer synthetic'};
 sql(`update fs_records set data=${literal(newer)} where id='${id}';`);
 const denied=await mobileSave.submitSave(stale,async(route,body)=>{
  const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales')},body:JSON.stringify(body)});return response.json();
 },()=>true);
 assert.equal(denied.status,'conflict');assert.deepEqual(JSON.parse(sql(`select data from fs_records where id='${id}';`)),newer);
});
test('synthetic row e2e: multiple rows preserve order and denied role cannot save',async()=>{
 const id='A08333';
 const original=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',conceptStr:'Synthetic concept',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[
  {name:'Synthetic Alpha',w:100,p:50,o:'fixture one',note:'first',hero:true,actual:50,fda:{status:'fixture',cls:'fixture',icon:'?',tip:'fixture'},extra:'first-only'},
  {name:'Other Beta',w:80,p:25,o:'fixture two',note:'second',hero:false,actual:20,fda:{status:'fixture',cls:'fixture',icon:'?',tip:'fixture'},extra:'second-only'}
 ]});
 sql(`insert into fs_records(id,data) values ('${id}',${literal(original)});`);
 const changes=syntheticBriefReader.readBrief(original,{customer:'Synthetic'},{0:{w:'120'},1:{w:'160'}});
 assert.throws(()=>rowAdapter.adaptLegacyRows(changes.rows,rows=>legacyCalculator.derive(rows).reverse()),/รายการสาร/);
 changes.rows=rowAdapter.adaptLegacyRows(changes.rows,legacyCalculator.derive);
 const request=mobileSave.prepareSave({id,baseline:original,changes});
 const send=role=>async(route,body)=>{const response=await fetch(`${gatewayRest()}/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie(role)},body:JSON.stringify(body)});return response.json()};
 assert.equal((await mobileSave.submitSave(request,send('ra'),()=>true)).status,'forbidden');
 assert.deepEqual(JSON.parse(sql(`select data from fs_records where id='${id}';`)),original);
 assert.equal((await mobileSave.submitSave(request,send('admin'),()=>true)).status,'saved');
 const rows=JSON.parse(sql(`select data from fs_records where id='${id}';`)).rows;
 assert.deepEqual(rows.map(r=>[r.name,r.w,r.actual,r.fda.status,r.extra]),[['Synthetic Alpha',120,60,'over','first-only'],['Other Beta',160,40,'unknown','second-only']]);
});
