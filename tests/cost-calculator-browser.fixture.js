(async function(){
 await new Promise(r=>setTimeout(r,0));
 const results=[];
 const check=(name,condition)=>{results.push({name,pass:!!condition});if(!condition)throw Error(name);};
 try{
 SB_URL='';SB_KEY='';currentUser='Synthetic RD';impersonator='';userList=[{name:currentUser,role:'rd'}];authSession=null;authMembership=null;
 records=[{id:'A00001',createdBy:'Synthetic RD',customer:'Synthetic project',rows:[]}];renderUserUI();
 const date='2029-01-01';
 const offers=[{id:'O1',version:1,materialId:'M1',tierId:'T1',vendorId:'V1',status:'confirmed',specApproved:true,currency:'THB',scope:{type:'central'},price:100,priceUnit:'kg',priceBasisQuantity:1,moq:2,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:10,validUntil:'2030-01-01',evidenceRef:'E1'}, {id:'O2',version:1,materialId:'M2',tierId:'T2',vendorId:'V2',status:'confirmed',specApproved:true,currency:'THB',scope:{type:'central'},price:120,priceUnit:'kg',moq:5,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:20,validUntil:'2030-01-01',evidenceRef:'E2'}];
 let scenario=CostCalculator.createScenario({projectId:'A00001',scenarioId:'S1',revision:1,currency:'THB',sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',rmLines:[{id:'L1',materialId:'M1',alias:'สารสกัดสำหรับทดสอบ',amount:1,unit:'g',lossPercent:0,offer:offers[0]}],extraCosts:[],extrasReviewed:false,policies:{},pk:null});
 const snapshots=[scenario],calls=[];
 check('known RM calculates while PK is absent',CostCalculator.calculate(scenario,date).rm.baseTotal===100);
 const pk={id:'PK1',version:1,projectId:'A00001',scenarioId:'S1',currency:'THB',sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',specVersion:'PACK1',status:'draft',validUntil:'2030-01-01',evidenceRef:'PKE1',baseTotal:300,adjustedTotal:null};
 function envelope(sendState){const result=CostCalculator.calculate(scenario,date);const rd=currentRole()==='rd';return {contract:'cost-v1',projectId:'A00001',scenarioId:'S1',revision:scenario.revision,view:CostCalculator.project(result,rd?'RD':'Sales'),capabilities:{editRM:rd,sendSummary:rd,adoptPK:rd},inputs:{sellingUnits:scenario.sellingUnits,unitsPerPack:scenario.unitsPerPack,fillAmount:scenario.fillAmount,fillUnit:scenario.fillUnit},lines:rd?scenario.rmLines.map((line,i)=>({...result.rm.lines[i],id:line.id,alias:line.alias,amount:line.amount,unit:line.unit,lossPercent:line.lossPercent})):[],catalog:rd?offers.map((o,i)=>({offerRef:o.id,group:'กลุ่มสารสกัด',name:'สารสกัดตัวอย่าง '+(i+1),spec:i?'Spec B · ความเข้มข้นสูง':'Spec A · มาตรฐาน',vendor:'SYNTHETIC VENDOR '+(i+1),tierLabel:o.tierId,price:o.price,priceUnit:'บาท / กก.',moq:o.moq,moqUnit:'กก.',leadTimeDays:o.leadTimeDays,eligible:true})):[],pkCandidate:rd?{snapshotRef:'PK1',versionLabel:'1 · รอยืนยัน'}:null,pkNotice:scenario.pk?'อ้างอิง PK เวอร์ชัน 1 · รอยืนยัน':'กำลังต่อราคาใน PU-PK · ทำสูตร/RM ต่อได้',sendState};}
 window.__costTestRequest=async(action,payload)=>{calls.push({action,payload});if(action!=='open'&&payload.expectedRevision!==scenario.revision)throw Error('REVISION_CONFLICT');if(action==='save'){const p=payload.patch;scenario=CostCalculator.revise(scenario,{sellingUnits:p.sellingUnits,unitsPerPack:p.unitsPerPack,fillAmount:p.fillAmount,rmLines:p.lines.map(l=>({...scenario.rmLines.find(x=>x.id===l.id),...l}))});snapshots.push(scenario);}if(action==='adoptPK'){scenario=CostCalculator.adoptPK(scenario,pk,date);snapshots.push(scenario);}return envelope(action==='sendSummary'?'pending':undefined);};
 await openCostCalculator('A00001');
 check('actual browser renders searchable RM and pending PK',!!document.getElementById('costSearch')&&document.getElementById('costView').textContent.includes('รอยืนยัน'));
 document.getElementById('costAlias0').value='ชื่อเปิดเผยใน revision';await costSave();
 check('save preserves immutable prior revision while PK missing',scenario.revision===2&&snapshots[0].rmLines[0].alias==='สารสกัดสำหรับทดสอบ'&&scenario.pk===null);
 costSearchChanged('Spec B');check('search compares spec without unrelated item',!document.getElementById('costView').textContent.includes('Spec A · มาตรฐาน')&&document.getElementById('costView').textContent.includes('Spec B'));
 costSearchChanged('');await costAdoptPK();check('draft PK adoption preserves RM and remains incomplete',scenario.revision===3&&scenario.rmLines[0].alias==='ชื่อเปิดเผยใน revision'&&CostCalculator.calculate(scenario,date).complete===false);
 window.confirm=()=>true;await costSendSummary();check('pending receipt is not sent',costState.response.sendState==='pending'&&!document.getElementById('costView').textContent.includes('ส่งสำเร็จ'));
 userList=[{name:currentUser,role:'sales'}];renderUserUI();costReset();await openCostCalculator('A00001');
 check('Sales cannot open the calculator at all',costState.response===null&&!document.getElementById('costSearch')&&!costAllowed('A00001'));
 renderRecordsList();
 const dashHtml=()=>document.getElementById('recordsPanel').innerHTML; // body.innerHTML รวมซอร์สใน <script> ด้วย ต้องดูเฉพาะตาราง
 check('Sales dashboard has no cost button',!dashHtml().includes('คำนวณต้นทุน'));
 userList=[{name:currentUser,role:'rd'}];renderRecordsList();
 check('RD dashboard keeps the cost button',dashHtml().includes('คำนวณต้นทุน'));
 userList=[{name:currentUser,role:'sales'}];
 check('Sales open left storage untouched',!JSON.stringify(localStorage).includes('SYNTHETIC VENDOR'));
 check('new costs never enter legacy stores',!JSON.stringify(localStorage).includes('SYNTHETIC VENDOR'));
 // Exercise shipped local transport and actual DOM events, not just the fixture gateway.
 delete window.__costTestRequest;userList=[{name:currentUser,role:'rd'}];costStore=null;localStorage.removeItem('fs_cost');
 await openCostCalculator('A00001');
 document.getElementById('costRequestBrief').value='Synthetic sourcing request';await costRequestMaterial();
 check('local request is acknowledged and visible without an external send',document.getElementById('costView').textContent.includes('บันทึกคำขอจัดหาแล้ว')&&document.getElementById('costView').textContent.includes('Synthetic sourcing request')&&loadCostStore().requests.length===1);
 check('weight unit is a dropdown',document.getElementById('costFillUnit').tagName==='SELECT');
 await costLocalRequest('save',{projectId:'A00001',expectedRevision:1,patch:{sellingUnits:100,unitsPerPack:60,fillAmount:1,fillUnit:'g',lines:[]}});
 loadCostStore().catalog=[offers[0]];await costLocalRequest('selectRM',{projectId:'A00001',expectedRevision:2,offerRef:'O1'});
 await openCostCalculator('A00001');const amount=document.getElementById('costAmount0');amount.value='0.4';amount.dispatchEvent(new Event('input',{bubbles:true}));
 check('typing updates cumulative mass before save',document.getElementById('costFormulaPreview').textContent.includes('0.4')&&document.getElementById('costFormulaPreview').textContent.includes('ยังขาด 0.6'));
 await costSave();const revision=costState.response.revision;await costSave();
 check('unchanged real form save retains revision',costState.response.revision===revision&&document.getElementById('costView').textContent.includes('ไม่มีข้อมูลเปลี่ยนแปลง'));
 authSession={user:{id:'SYNTHETIC'}};authMembership={role:'rd'};await openCostCalculator('A00001','S1',2);
 check('historical form disabled with explicit latest navigation',document.getElementById('costFillAmount').disabled&&document.getElementById('costView').textContent.includes('กำลังดู revision เก่า'));
 await costOpenLatest();check('latest navigation escapes old revision',costState.response.revision===revision&&!document.getElementById('costFillAmount').disabled);
 // E2: เมนู Cost Calculation และ dashboard ใบงานต้นทุน
 window.alert=()=>{};
 userList=[{name:currentUser,role:'rd'}];renderUserUI();
 check('RD sees the Cost Calculation menu',document.getElementById('sideCost').style.display==='flex');
 switchView('cost');
 check('cost dashboard lists the real job with its Formula id',document.getElementById('costDashView').classList.contains('on')&&document.getElementById('costDashBody').textContent.includes('CJ-000001')&&document.getElementById('costDashBody').textContent.includes('A00001'));
 {const box=document.getElementById('costDashSearch');box.focus();box.value='ไม่มีทาง';box.dispatchEvent(new Event('input',{bubbles:true}));
 check('dashboard search filters in place',document.getElementById('costDashBody').textContent.includes('ไม่พบใบงาน'));
 check('dashboard search keeps the input element (no full redraw)',document.getElementById('costDashSearch')===box);}
 userList=[{name:currentUser,role:'sales'}];renderUserUI();
 check('Sales menu hidden and dashboard view closed',document.getElementById('sideCost').style.display==='none'&&!document.getElementById('costDashView').classList.contains('on'));
 switchView('cost');
 check('Sales cannot switch to the cost dashboard',!document.getElementById('costDashView').classList.contains('on'));
 userList=[{name:currentUser,role:'rd'}];renderUserUI();await openCostCalculator('A00001');
 document.querySelector('.main').style.display='block';
 const banner=document.createElement('p');banner.textContent='ข้อมูลจำลองสำหรับตรวจ UI — ไม่ใช่ระบบเชื่อมจริง';banner.className='cost-warning';document.getElementById('costView').prepend(banner);
 document.documentElement.setAttribute('data-cost-test-status','passed');
 }catch(error){results.push({name:String(error.message),pass:false});document.documentElement.setAttribute('data-cost-test-status','failed');}
 const report=document.createElement('pre');report.id='cost-browser-results';report.textContent=JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2);report.style.display='none';document.body.appendChild(report);
})();
