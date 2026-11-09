const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/index.html','utf8');
assert.match(html, /connect-src 'none'/, 'หน้าทดลองต้องไม่เชื่อมเครือข่าย');
assert.match(html, /ข้อมูลจำลอง/, 'ต้องระบุว่าเป็นข้อมูลจำลอง');
const match = html.match(/<script id="model">([\s\S]*?)<\/script>/);
assert.ok(match, 'ต้องมีแบบจำลอง workflow');
const ctx = {module:{exports:{}}, Date}; vm.runInNewContext(match[1],ctx);
const m=ctx.module.exports, s=m.initialState();
assert.throws(()=>m.create(m.initialState(),'sales',{customer:'ตัวอย่าง',market:'Oversea',country:''}),/ประเทศปลายทาง/);
assert.doesNotThrow(()=>m.create(m.initialState(),'sales',{customer:'ตัวอย่าง',market:'Oversea',country:'ลาว'}));
const marketState=m.initialState();marketState.jobs[0].market='Oversea';marketState.jobs[0].country='ลาว';
assert.throws(()=>m.edit(marketState,'sales','A00001',{country:''}),/ประเทศปลายทาง/);
assert.doesNotThrow(()=>m.edit(marketState,'sales','A00001',{market:'Domestic',country:''}));
const marketBatch=m.initialState(),marketBefore=JSON.stringify(marketBatch);
assert.throws(()=>m.createMany(marketBatch,'sales',[{customer:'หนึ่ง',rows:[]},{customer:'สอง',market:'Oversea',country:'',rows:[]}]),/ประเทศปลายทาง/);
assert.equal(JSON.stringify(marketBatch),marketBefore,'ไฟล์หลายงานที่ข้อมูลประเทศไม่ครบต้องไม่สร้างบางส่วน');
assert.throws(()=>m.validateFormulaRows([{name:'',w:'100',p:'50'}]),/ชื่อสาร/);
assert.throws(()=>m.validateFormulaRows([{name:'   '}]),/ชื่อสาร/);
assert.doesNotThrow(()=>m.validateFormulaRows([{name:'สารจำลอง',w:'100',p:'50'}]));
assert.doesNotThrow(()=>m.validateFormulaRows([]));
let out=m.exportLegacyCSV({customer:'=1+1',brand:'แบรนด์',rows:[{name:'สาร, A',w:100,o:'ทดสอบ',p:50,note:'หมายเหตุ'}]});assert.ok(out.includes("'=1+1"));let round=m.parseLegacyCSV(out);assert.equal(round.rows[0].name,'สาร, A');
const marketCSV=m.parseLegacyCSV(m.exportLegacyCSV({customer:'ตัวอย่าง',market:'Oversea',country:'ลาว',rows:[]}));assert.equal(marketCSV.market,'Oversea');assert.equal(marketCSV.country,'ลาว');
assert.throws(()=>m.parseLegacyCSV('customer_name,ตัวอย่าง\nunknown_field,ข้อมูลที่หาย'),/ไม่รองรับ/);
assert.throws(()=>m.parseLegacyCSV('customer_name,หนึ่ง\ncustomer_name,สอง'),/ซ้ำ/);
assert.throws(()=>m.parseLegacyCSV('customer_name,ตัวอย่าง\n---ingredients---\ningredient_name,weight,origin,purity,note\n,100,แหล่ง,50,บันทึก'),/ชื่อสาร/);
assert.throws(()=>m.parseLegacyCSV('customer_name,ตัวอย่าง\n---ingredients---\ningredient_name,weight,origin,purity,note\nสาร,100,แหล่ง,50,บันทึก,,ข้อมูลเพิ่ม'),/ไม่รองรับ/);
assert.throws(()=>m.parseLegacyCSV('customer_name,ตัวอย่าง\nunit_weight,1\nunit_weight_mg,2'),/ซ้ำ/);
assert.throws(()=>m.parseLegacyCSV('customer_name,ตัวอย่าง\n__proto__,ข้อมูล'),/ไม่รองรับ/);
assert.throws(()=>m.parseLegacyCSV('customer_name,ตัวอย่าง\n---ingredients---\ningredient_name,weight,unknown,purity,note'),/ไม่รองรับ/);
let parsed=m.parseLegacyCSV('customer_name,"บริษัท, ทดสอบ"\nbrand_name,แบรนด์\n---ingredients---\ningredient_name,weight,origin,purity,note\nสาร,100,ตัวอย่าง,50,หมายเหตุ');
assert.equal(parsed.customer,'บริษัท, ทดสอบ');assert.equal(parsed.brand,'แบรนด์');assert.equal(parsed.rows[0].actual,50);
const full={customer:'จำลอง',brand:'ทดสอบ',salesOwner:'ฝ่ายขาย',phone:'123',cat:'สินค้ามาตรฐาน (B_)',subcat:'BW : บำรุงผิว',priority:'high',fdaType:'ตัวอย่าง',color:'ใส',scent:'กลิ่น',flavor:'รส',packType:'ซอง',widthCm:'0',lengthCm:'10',allBenefits:['A, B','C'],cons:['ข้อหนึ่ง, ข้อสอง'],rows:[{name:'สาร',w:'10',o:'ที่มา',p:'0',note:'หมายเหตุ',hero:true}]};
const restored=m.parseLegacyCSV(m.exportLegacyCSV(full));
for(const key of ['salesOwner','phone','cat','subcat','priority','fdaType','color','scent','flavor','packType','widthCm','lengthCm']) assert.equal(restored[key],full[key],key);
assert.deepEqual(Array.from(restored.allBenefits),full.allBenefits);assert.deepEqual(Array.from(restored.cons),full.cons);assert.equal(restored.rows[0].hero,true);assert.equal(restored.rows[0].p,'0');assert.equal(restored.rows[0].actual,0);
assert.throws(()=>m.parseLegacyCSV('claims_json,"{bad}"'));
assert.deepEqual(Array.from(m.parseLegacyCSV('claims,หนึ่ง,สอง').allBenefits),['หนึ่ง','สอง']);

assert.throws(()=>m.parseLegacyCSV('customer_name,"ไม่ปิด'));assert.equal(m.ingredientActual('100','50'),50); assert.equal(m.ingredientActual('','50'),null); assert.equal(m.ingredientActual('12x','50'),null); assert.equal(m.ingredientActual('0','50'),0); assert.equal(m.ingredientActual('100','Infinity'),null);assert.throws(()=>m.validateIngredientValues([{w:'100mg',p:'50'}]),/ตัวเลข/);assert.doesNotThrow(()=>m.validateIngredientValues([{w:'',p:'50'}])); const missing=m.parseLegacyCSV('customer_name,ตัวอย่าง\n---ingredients---\ningredient_name,weight,origin,purity,note\nสาร,100,,,');assert.equal(missing.rows[0].p,'');assert.equal(missing.rows[0].actual,null);
assert.equal(m.can('sales','create'),true); assert.equal(m.can('pd','create'),false);
assert.equal(m.can('pd','formula'),true); assert.equal(m.can('ra','formula'),false);
assert.equal(m.visible(s,'sales').length,1); assert.equal(m.visible(s,'pd').length,2);
assert.throws(()=>m.create(s,'ra',{customer:'ทดสอบ'}));
const job=m.create(s,'sales',{customer:'ลูกค้าทดสอบ',brand:'แบรนด์',form:'แคปซูล'});
assert.equal(job.createdBy,'sales'); assert.ok(m.visible(s,'sales').some(x=>x.id===job.id));
assert.throws(()=>m.send(s,'sales',s.jobs.find(x=>x.createdBy==='opc').id,'test')); assert.throws(()=>m.send(s,'sales',job.id,'  '));
m.send(s,'sales',job.id,'ข้อความทดสอบ'); assert.equal(job.messages.at(-1).text,'ข้อความทดสอบ');
assert.ok(s.notifications.some(n=>n.jobId===job.id && n.type==='chat' && n.actor==='sales'));
assert.equal(m.unreadFor(s,'sales').filter(n=>n.jobId===job.id).length,0, 'ผู้ส่งไม่ควรได้รับแจ้งเตือนจากการทำรายการของตนเอง');
assert.ok(m.unreadFor(s,'pd').some(n=>n.jobId===job.id && n.type==='chat')); 
assert.throws(()=>m.approve(s,'ra',job.id,'pd')); m.approve(s,'pd',job.id,'pd'); assert.equal(job.approvals.pd,true);
m.edit(s,'sales',job.id,{id:'A99999',createdBy:'opc'});assert.equal(job.id,'A00003');assert.equal(job.createdBy,'sales');
m.edit(s,'pd',job.id,{}); assert.equal(job.approvals.pd,true, 'บันทึกโดยไม่เปลี่ยนข้อมูลต้องไม่ล้างการอนุมัติ');
m.edit(s,'pd',job.id,{notes:'แก้แล้ว'}); assert.equal(job.approvals.pd,false);
assert.throws(()=>m.setClosed(s,'ra',job.id,true)); m.setClosed(s,'sales',job.id,true); assert.equal(job.closed,true);
for (const role of ['admin','sales','pd','ra','rd','opc','mkt','purchasing']) {
  const t=m.initialState(); assert.ok(m.visible(t,role).length>0, role+' must see a fixture');
  m.send(t,role,'A00001','ทดสอบ'); assert.equal(t.jobs[0].messages.at(-1).text,'ทดสอบ');
}
const matrix={admin:[true,true,true,true],sales:[true,false,true,false],pd:[false,true,false,false],ra:[false,false,false,false],rd:[false,false,false,false],opc:[true,false,true,true],mkt:[true,true,true,true],purchasing:[false,false,false,false]};
for(const [role,expected] of Object.entries(matrix)) assert.deepEqual(['create','formula','close','export'].map(p=>m.can(role,p)),expected,role+' capability matrix');
assert.deepEqual(['create','formula','close','export'].map(p=>m.can('oversea',p)),[true,false,true,true],'oversea capability matrix (web)');
const t=m.initialState(); m.edit(t,'pd','A00001',{customer:'เปลี่ยนไม่ได้',notes:'แก้ได้'});
assert.equal(t.jobs[0].customer,'ลูกค้าจำลอง A'); assert.equal(t.jobs[0].notes,'แก้ได้');
for(const role of Object.keys(matrix)) {
  for(const part of ['pd','ra','rd','sales']) {
    const fixture=m.initialState();
    if(role==='admin'||role===part||(role==='mkt'&&['pd','sales'].includes(part))||(role==='oversea'&&part==='sales')) {m.approve(fixture,role,'A00001',part);assert.equal(fixture.jobs[0].approvals[part],true,role+' สามารถอนุมัติ '+part)}
    else assert.throws(()=>m.approve(fixture,role,'A00001',part),undefined,role+' ต้องไม่อนุมัติแทน '+part);
  }
}
assert.throws(()=>m.approve(t,'purchasing','A00001','pd'));
for (const role of ['pd','ra','rd','sales']) { m.approve(t,role,'A00001',role); assert.equal(t.jobs[0].approvals[role],true); }
assert.ok(Object.values(t.jobs[0].approvals).every(Boolean));
m.setClosed(t,'opc','A00001',true); assert.equal(t.jobs[0].closed,true);
m.setClosed(t,'opc','A00001',false); assert.equal(t.jobs[0].closed,false);
assert.ok(t.notifications.some(n=>n.type==='update'));
assert.ok(t.notifications.some(n=>n.type==='chat'));
const exportState=m.initialState();assert.throws(()=>m.prepareChatExport(exportState,'opc','A00001'),/อนุมัติ/);
for(const r of ['pd','ra','rd','sales'])m.approve(exportState,r,'A00001',r);
for(const r of ['sales','pd','ra','rd','purchasing'])assert.throws(()=>m.prepareChatExport(exportState,r,'A00001'),/สิทธิ์/);
assert.equal(m.prepareChatExport(exportState,'mkt','A00001').id,'A00001','MKT ส่งออกได้ตามเว็บ');
assert.equal(m.prepareChatExport(exportState,'admin','A00001').id,'A00001');assert.equal(m.prepareChatExport(exportState,'opc','A00001').id,'A00001');
m.recordChatExport(exportState,'opc','A00001');assert.equal(exportState.jobs[0].exports,1);assert.equal(exportState.jobs[0].messages.at(-1).from,'system');
m.approve(exportState,'pd','A00001','pd');assert.throws(()=>m.prepareChatExport(exportState,'opc','A00001'),/อนุมัติ/);
const original=m.initialState(),before=JSON.stringify(original);
assert.throws(()=>m.createMany(original,'sales',[{customer:'งานหนึ่ง',rows:[]},{customer:'',brand:'',rows:[]}]));assert.equal(JSON.stringify(original),before,'นำเข้าที่ผิดพลาดต้องไม่สร้างงานบางส่วน');
assert.throws(()=>m.createMany(original,'sales',[{customer:'งานหนึ่ง',rows:[]},{customer:'งานสอง',rows:[{name:'สาร',w:'123mg',p:'50'}]}]),/ตัวเลข/);assert.equal(JSON.stringify(original),before);
assert.throws(()=>m.createMany(original,'ra',[{customer:'งานหนึ่ง',rows:[]} ]));
const batchState=m.createMany(original,'sales',[{sourceId:'T1',customer:'งานหนึ่ง',rows:[{name:'สารหนึ่ง'}]},{sourceId:'T2',customer:'งานสอง',rows:[]}]);
assert.equal(original.jobs.length,2);assert.equal(batchState.jobs.length,4);assert.equal(batchState.jobs[1].rows[0].name,'สารหนึ่ง');assert.equal(batchState.jobs[1].sourceId,undefined);
console.log('PASS: 8 บทบาท งาน ข้อความ อนุมัติ การแก้ไข และแจ้งเตือนจำลอง');
