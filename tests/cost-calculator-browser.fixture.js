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
 window.__step='reopen-A00001-local';await openCostCalculator('A00001');
 window.__step='costRequestBrief';document.getElementById('costRequestBrief').value='Synthetic sourcing request';await costRequestMaterial();
 check('local request is acknowledged and visible without an external send',document.getElementById('costView').textContent.includes('บันทึกคำขอจัดหาแล้ว')&&document.getElementById('costView').textContent.includes('Synthetic sourcing request')&&loadCostStore().requests.length===1);
 check('weight unit is a dropdown',document.getElementById('costFillUnit').tagName==='SELECT');
 await costLocalRequest('save',{projectId:'A00001',expectedRevision:1,patch:{sellingUnits:100,unitsPerPack:60,fillAmount:1,fillUnit:'g',lines:[]}});
 loadCostStore().catalog=[offers[0]];await costLocalRequest('selectRM',{projectId:'A00001',expectedRevision:2,offerRef:'O1'});
 window.__step='reopen-after-selectRM';await openCostCalculator('A00001');window.__step='costAmount0';const amount=document.getElementById('costAmount0');amount.value='0.4';amount.dispatchEvent(new Event('input',{bubbles:true}));
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
 // E3: สร้างลอยจากหน้าสร้าง → เปิด → ผูกจากในหน้าเครื่องคำนวณ → เปิดใบที่ผูก
 records.push({id:'A00002',customer:'ลูกค้าสังเคราะห์ ข',brand:'SYN-B',createdBy:currentUser});
 costOpenCreate();check('create page opens on reference mode listing only unbound records',document.getElementById('costCreateRefList').textContent.includes('A00002')&&!document.getElementById('costCreateRefList').innerHTML.includes('value="A00001"'));
 costCreateMode('float');document.getElementById('costCreateTitle').value='งานลอยสังเคราะห์';await costCreateSubmit();
 check('floating job opens in the calculator under its own key',costState.response&&costState.response.job&&costState.response.job.bound===false&&/^CJ-\d{6}$/.test(costState.projectId)&&document.getElementById('costBindSelect')!==null);
 const floatingId=costState.projectId;
 document.getElementById('costBindSelect').value='A00002';await costBindFromView();
 check('binding reopens the job under the Formula id with the same job id',costState.projectId==='A00002'&&costState.response.job.id===floatingId&&costState.response.job.bound===true&&!document.getElementById('costBindSelect'));
 // 3b: เปิดใบที่ผูกกับ Formula ที่มีตารางสาร → ชื่อถูกดึงมา → ค้นหาไทย → ใช้ตัวนี้ → ปริมาณ → ราคาต่อหน่วยผลิต
 records.push({id:'A00003',customer:'ลูกค้าสังเคราะห์ ค',brand:'SYN-C',form:'แคปซูล',createdBy:currentUser,rows:[{name:'Vitamin C',w:100},{name:'สารที่ไม่มีในแคตตาล็อก',w:1}]});
 loadCostStore().catalog.push({...offers[0],id:'OVC',materialId:'MVC',name:'Ascorbic Acid 99% (Vitamin C)',vendor:'ผู้ขายสังเคราะห์ 3',price:320});saveCostStore();
 costOpenCreate();costCreateMode('ref');document.querySelector('input[name="costCreateRef"][value="A00003"]').checked=true;await costCreateSubmit();
 check('names from the Formula sheet are pre-seeded without amounts',costState.response.lines.length===2&&costState.response.lines[0].alias==='Vitamin C'&&costState.response.lines[0].amount===null&&costState.response.lines[0].unit==='mg'&&document.getElementById('costLineSearch0')!==null);
 {const box=document.getElementById('costLineSearch0');box.focus();box.value='วิตามินซี';box.dispatchEvent(new Event('input',{bubbles:true}));}
 check('typing Thai finds the English trade name via FDA keywords without a full redraw',document.getElementById('costLineSug0').textContent.includes('Ascorbic Acid')&&document.activeElement===document.getElementById('costLineSearch0'));
 document.querySelector('#costLineSug0 button[onclick^="costAssignRef"]').click();await new Promise(r=>setTimeout(r,0));await costAction('open',{});
 check('assigning keeps the Formula name and removes the search row',costState.response.lines[0].hasOffer===true&&costState.response.lines[0].alias==='Vitamin C'&&!document.getElementById('costLineSearch0')&&document.getElementById('costLineSearch1')!==null&&loadCostStore().picks.length>=1);
 {const amt=document.getElementById('costAmount0');amt.value='250';amt.dispatchEvent(new Event('input',{bubbles:true}));}
 check('unit price appears while typing the amount',document.getElementById('costLineUnit0').textContent.includes('0.08'));
 // E4: สอง tab สลับกัน ค่าที่กรอกค้างไม่หาย ปิดต้องยืนยัน — ปิด tab ของ 3b ก่อนเพื่อนับให้ตรง
 window.confirm=()=>true;costCloseTab('A00003');
 await openCostCalculator('A00001');document.getElementById('costSellingUnits').value='4321';
 await openCostCalculator('A00002');
 check('two tabs are open and the first keeps its unsaved value',document.querySelectorAll('.cost-tab[data-tab]').length===2&&costTabFor('A00001').state.edits.costSellingUnits==='4321'&&document.querySelector('.cost-tab-dirty')!==null);
 costActivateTab('A00001');check('switching back restores the unsaved value into the form',document.getElementById('costSellingUnits').value==='4321');
 let confirms=0;window.confirm=()=>{confirms++;return false;};costCloseTab('A00001');
 check('closing a dirty tab asks and a refusal keeps it',confirms===1&&document.querySelectorAll('.cost-tab[data-tab]').length===2);
 window.confirm=()=>{confirms++;return true;};const revBefore=loadCostStore().scenarios.length;costCloseTab('A00001');
 check('confirmed close drops the tab without saving a revision',document.querySelectorAll('.cost-tab[data-tab]').length===1&&loadCostStore().scenarios.length===revBefore&&costState.projectId==='A00002');
 // E4-02: ใบงาน Formula ปิดแล้ว
 records.find(r=>r.id==='A00002').closed={by:'Sales',at:'2026-09-07',ts:1};await openCostCalculator('A00002');
 check('closed Formula job renders read-only with clone',document.getElementById('costView').textContent.includes('ปิดงานแล้ว · อ่านอย่างเดียว')&&document.getElementById('costSellingUnits').disabled);
 delete records.find(r=>r.id==='A00002').closed;
 switchView('cost');costDashSearchChanged('');check('dashboard shows the bound job once with its Formula id',document.getElementById('costDashBody').textContent.split(floatingId).length===2&&document.getElementById('costDashBody').textContent.includes('A00002'));
 // E5: RD ส่งลิงก์เอกสาร → ปุ่มในแชทเห็นเฉพาะผู้มีสิทธิ์ → เปิดเอกสาร revision คงที่
 await openCostCalculator('A00001');const docRev=costState.response.revision;
 window.confirm=()=>true;await costSendDocument();
 check('sending the document posts one chat message carrying the revision ref',getChat('A00001').messages.filter(m=>m.costDocRef).length===1&&getChat('A00001').messages.find(m=>m.costDocRef).costDocRef.revision===docRev&&document.getElementById('costView').textContent.includes('ส่งลิงก์เอกสาร'));
 await costSendDocument();check('sending twice does not post twice',getChat('A00001').messages.filter(m=>m.costDocRef).length===1);
 openChatRoom('A00001');
 check('RD sees the open-document button in chat',!!document.querySelector('#chatView button[onclick^="openCostDocument"]'));
 document.querySelector('#chatView button[onclick^="openCostDocument"]').click();
 check('document view shows vendor detail and fixed revision',document.getElementById('costDocView').classList.contains('on')&&document.getElementById('costDocView').textContent.includes('V1')&&document.getElementById('costDocView').textContent.includes('T1')&&document.getElementById('costDocView').textContent.includes('Revision '+docRev+' (คงที่)')&&!document.querySelector('#costDocView input'));
 userList=[{name:currentUser,role:'sales'}];renderUserUI();openChatRoom('A00001');
 check('Sales sees the chat line but no document button',document.getElementById('chatView').textContent.includes('เอกสารต้นทุน')&&!document.querySelector('#chatView button[onclick^="openCostDocument"]'));
 document.getElementById('costDocView').innerHTML='';document.getElementById('costDocView').classList.remove('on');openCostDocument('CJ-000001',docRev);
 check('Sales cannot open the document directly',!document.getElementById('costDocView').classList.contains('on')&&document.getElementById('costDocView').innerHTML==='');
 // งานจัดซื้อ: Purchasing เห็นคำขอทุกโครงการ ยืนยันเงื่อนไขซื้อบนหน้าจอ → RD รับรอง spec → เลือกได้
 loadCostStore().catalog.push({...offers[0],id:'OP1',materialId:'MP1',name:'สารรอยืนยันสังเคราะห์',status:'review',specApproved:null,increment:null,incrementUnit:'',leadTimeDays:null,validUntil:''});saveCostStore();
 userList=[{name:currentUser,role:'purchasing'}];renderUserUI();switchView('cost');
 check('Purchasing sees the procurement desk button',document.getElementById('costDashView').textContent.includes('งานจัดซื้อ'));
 renderCostProcurement();
 check('desk lists open requests across projects and the pending offer',document.getElementById('costProcRequests').textContent.includes('Synthetic sourcing request')&&document.getElementById('costProcPending').textContent.includes('สารรอยืนยันสังเคราะห์'));
 document.getElementById('costProcInc-OP1').value='5';document.getElementById('costProcLt-OP1').value='14';document.getElementById('costProcUntil-OP1').value='2999-01-01';costProcConfirm('OP1');
 check('confirming on screen records purchasing terms without touching spec',loadCostStore().catalog.find(o=>o.id==='OP1').status==='confirmed'&&loadCostStore().catalog.find(o=>o.id==='OP1').specApproved===null&&document.getElementById('costDashView').textContent.includes('ยืนยันเงื่อนไขซื้อแล้ว'));
 {const key=costProcurementView().requests.find(r=>r.status==='open').key;document.getElementById('costProcNote-'+key).value='เพิ่มในชีตแล้ว';costProcClose(key);}
 check('closing a request marks it done with the closer',costProcurementView().requests.every(r=>r.status==='done')&&loadCostStore().requests.every(r=>r.closedBy===currentUser));
 userList=[{name:currentUser,role:'rd'}];renderUserUI();await openCostCalculator('A00001');
 check('RD sees the spec approval button on the confirmed-but-unapproved offer',!!document.querySelector('button[onclick="costApproveSpecRef(\'OP1\')"]'));
 window.confirm=()=>true;await costApproveSpecRef('OP1');
 check('after RD approval the offer becomes selectable',costState.response.catalogGroups.flatMap(g=>g.offers).find(o=>o.offerRef==='OP1').eligible===true&&!document.querySelector('button[onclick="costApproveSpecRef(\'OP1\')"]'));
 // E6: หน้ากฎราคา (Admin ถือ Finance/CEO) — ตั้งอัตราและกฎโดยไม่ผ่านเครื่องคำนวณ
 userList=[{name:currentUser,role:'admin'}];renderUserUI();
 check('Admin sees the pricing menu',document.getElementById('sidePricing').style.display==='flex');
 switchView('pricing');
 check('pricing page renders the rate table and the bound job list',document.getElementById('costPricingView').classList.contains('on')&&document.getElementById('costPricingRates').textContent.includes('รอกรอก')&&document.getElementById('costPricingJob').textContent.includes('A00001'));
 document.getElementById('costRateId').value='CAP-GEL-0';document.getElementById('costRateOwner').value='ฝ่ายผลิต';document.getElementById('costRateUntil').value='2999-01-01';document.getElementById('costRateLabel0').value='ค่าอัดแคป';document.getElementById('costRateAmount0').value='0.15';
 costPricingSaveRates();
 check('saving a rate produces a usable format version',document.getElementById('costPricingView').textContent.includes('บันทึกอัตรามาตรฐาน CAP-GEL-0')&&costFormatList().find(f=>f.id==='CAP-GEL-0').ready===true);
 document.getElementById('costPricingJob').value=costPricingJobs().find(j=>j.projectId==='A00001').id;document.getElementById('costPricingJob').dispatchEvent(new Event('change'));
 for(const [id,v] of [['costAllowance','10'],['costFactor','2.2'],['costRuleDecimals','6'],['costRuleOwner','Finance สังเคราะห์'],['costRuleUntil','2999-01-01'],['costPkMode','notApplicable'],['costFormatId','CAP-GEL-0']])document.getElementById(id).value=v;
 const revBeforeRule=loadCostStore().scenarios.filter(r=>r.projectId==='A00001').length;costPricingSaveRule();
 check('saving a rule appends a revision to that job',document.getElementById('costPricingView').textContent.includes('บันทึกกฎการบวกราคาของ')&&loadCostStore().scenarios.filter(r=>r.projectId==='A00001').length===revBeforeRule+1);
 userList=[{name:currentUser,role:'sales'}];renderUserUI();
 check('Sales pricing menu hidden',document.getElementById('sidePricing').style.display==='none');
 switchView('pricing');check('Sales cannot switch to the pricing page',!document.getElementById('costPricingView').classList.contains('on'));
 check('Sales menu hidden and dashboard view closed',document.getElementById('sideCost').style.display==='none'&&!document.getElementById('costDashView').classList.contains('on'));
 switchView('cost');
 check('Sales cannot switch to the cost dashboard',!document.getElementById('costDashView').classList.contains('on'));
 userList=[{name:currentUser,role:'rd'}];renderUserUI();await openCostCalculator('A00001');
 // Source-linked local PK confirmation and read-only IN preview (synthetic only).
 records.push({id:'A00004',customer:'Synthetic PK pilot',createdBy:currentUser,rows:[]});
 await costLocalRequest('open',{projectId:'A00004'});
 await costLocalRequest('save',{projectId:'A00004',expectedRevision:1,patch:{sellingUnits:100,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'SYN-PACK',lines:[]}});
 userList=[{name:currentUser,role:'purchasing'}];renderUserUI();await openCostCalculator('A00004');
 check('PU-PK sees source fields and exact job context',!!document.getElementById('costPkSourceSnapshot')&&document.getElementById('costView').textContent.includes('SYN-PACK'));
 for(const [id,value] of [['costPkAdjusted','1234.56'],['costPkValidUntil','2999-01-01'],['costPkEvidence','SYN-E'],['costPkSourceRequest','SYN-R'],['costPkSourceQuote','SYN-Q'],['costPkSourceSnapshot','SYN-S1'],['costPkSourceRevision','1']])document.getElementById(id).value=value;
 const pkBefore=loadCostStore().pk.length;window.confirm=()=>false;await costSavePk();
 check('declining PK confirmation records nothing',loadCostStore().pk.length===pkBefore);
 window.confirm=()=>true;await costSavePk();
 if(!costState.response.pkCandidate)throw Error('PK confirmation: '+costState.error+' pkCount='+loadCostStore().pk.length);
 check('explicit confirmation records source version without adopting',loadCostStore().pk.length===pkBefore+1&&costLatestEntry('A00004','S1').scenario.pk===null&&costState.response.pkCandidate.versionLabel.includes('SYN-S1'));
 document.getElementById('costInPaste').value='Qty\tUOM\tPrice\tUnit Cost\n100\tpiece\t123.45\t1.2345\n1\tbox\t1.001\t1';document.querySelector('button[onclick="costCheckInPreview()"]').click();
 check('IN preview shows exact arithmetic and sub-cent warning',document.getElementById('costInResult').textContent.includes('123.45')&&document.getElementById('costInResult').textContent.includes('ผลต่างต่ำกว่า 0.01'));
 check('IN preview explicitly keeps PO evidence pending',document.getElementById('costInResult').textContent.includes('PO: รอหลักฐาน'));
 userList=[{name:currentUser,role:'rd'}];renderUserUI();await openCostCalculator('A00004');
 check('RD sees source version but no PK recording or IN entry controls',costState.response.pkCandidate.versionLabel.includes('SYN-S1')&&!document.getElementById('costPkSourceSnapshot')&&!document.getElementById('costInPaste'));
 await costAdoptPK();const adoptedPk=costLatestEntry('A00004','S1').scenario.pk;if(!adoptedPk)throw Error('PK adoption: '+costState.error);
 check('RD explicit adoption keeps source lineage in its snapshot',adoptedPk.source.snapshotId==='SYN-S1'&&adoptedPk.adjustedTotal===1234.56);
 userList=[{name:currentUser,role:'purchasing'}];renderUserUI();await openCostCalculator('A00004');
 for(const [id,value] of [['costPkAdjusted','1200'],['costPkValidUntil','2999-01-01'],['costPkEvidence','SYN-E2'],['costPkSourceRequest','SYN-R'],['costPkSourceQuote','SYN-Q2'],['costPkSourceSnapshot','SYN-S2'],['costPkSourceRevision','2']])document.getElementById(id).value=value;
 await costSavePk();
 check('negotiation v2 does not overwrite adopted v1',costState.response.pkCandidate.versionLabel.includes('SYN-S2')&&costLatestEntry('A00004','S1').scenario.pk.adjustedTotal===1234.56);
 userList=[{name:currentUser,role:'sales'}];renderUserUI();costCheckInPreview();await openCostCalculator('A00004');
 check('Sales cannot open source confirmation or IN controls',!document.getElementById('costInPaste')&&!document.getElementById('costPkSourceSnapshot'));
 userList=[{name:currentUser,role:'purchasing'}];renderUserUI();await openCostCalculator('A00004');
 document.querySelector('.main').style.display='block';
 const banner=document.createElement('p');banner.textContent='ข้อมูลจำลองสำหรับตรวจ UI — ไม่ใช่ระบบเชื่อมจริง';banner.className='cost-warning';document.getElementById('costView').prepend(banner);
 document.documentElement.setAttribute('data-cost-test-status','passed');
 }catch(error){results.push({name:String(error.message)+' @ '+(window.__step||'?'),pass:false});document.documentElement.setAttribute('data-cost-test-status','failed');}
 const report=document.createElement('pre');report.id='cost-browser-results';report.textContent=JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2);report.style.display='none';document.body.appendChild(report);
})();
