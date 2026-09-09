'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../docs/prototypes/rm-picker.js');
const row=(id,status='AVAILABLE',extra={})=>({id,item:'RM-1',category:'RM',status,qty:8,uom:'kg',spec:'95%',lot:id,...extra});
test('RM prototype only exposes exact AVAILABLE RM rows, including direct selection guard',()=>{
 const rows=[row('yes'),row('hold','HOLD'),row('missing',undefined,{status:null}),row('lower','available'),row('pk','AVAILABLE',{category:'PK'})];
 assert.deepEqual(d.visible(rows).map(r=>r.id),['yes']);
 assert.throws(()=>d.chooseStock(rows,'hold'),/AVAILABLE/);
 assert.equal(d.chooseStock(rows,'yes').id,'yes');
});
test('RM prototype uses onhand as supplied and never subtracts Reserve',()=>{
 assert.equal(d.balance([row('a','AVAILABLE',{reserve:7}),row('b','AVAILABLE',{qty:2})],{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),10);
});
test('RM prototype does not match names, unconfirmed links, incompatible spec or UOM',()=>{
 const rows=[row('a'),row('b','AVAILABLE',{qty:500,uom:'g'}),row('c','AVAILABLE',{qty:99,spec:'98%'})];
 assert.equal(d.balance(rows,null),null);
 assert.equal(d.balance(rows,{item:'RM-1',spec:'95%',uom:'kg',confirmed:false}),null);
 assert.equal(d.balance(rows,{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),8);
});
test('RM prototype unknown quantities remain unknown; unavailable lots contribute nothing',()=>{
 const link={item:'RM-1',spec:'95%',uom:'kg',confirmed:true};
 assert.equal(d.balance([row('a','HOLD')],link),0);
 assert.equal(d.balance([row('a','AVAILABLE',{qty:null})],link),null);
 assert.equal(d.balance([row('a','AVAILABLE',{qty:-1})],link),null);
});

const offer=(id='A',spec='95%')=>({id,name:'Synthetic',spec,link:{item:'RM-1',spec,uom:'kg',confirmed:true}});
test('multi RM keeps separate materials and merges same material lots without replacing price',()=>{
 const lines=[];const a=d.add(lines,'rd',offer());a.quantity='12';d.add(lines,'stock',row('L1'));d.add(lines,'stock',row('L2'));d.add(lines,'stock',row('L2'));d.add(lines,'rd',offer('B'));
 assert.equal(lines.length,1);assert.equal(a.quantity,'12');assert.equal(a.row.id,'A');assert.equal(a.lots.length,2);
 d.add(lines,'rd',offer('C','98%'));assert.equal(lines.length,2);
 d.add(lines,'rd',{id:'NEW',name:'Synthetic',spec:'95%'});assert.equal(lines.length,3);
});
test('multi RM explicit replacement preserves quantity and rejects different spec',()=>{
 const lines=[],a=d.add(lines,'rd',offer());a.quantity='3';d.replace(a,offer('B'));assert.equal(a.row.id,'B');assert.equal(a.quantity,'3');assert.throws(()=>d.replace(a,offer('C','98%')),/spec/);
});
test('multi RM revision is one immutable copy of the whole draft even after removal',()=>{
 const lines=[],revs=[];const a=d.add(lines,'rd',offer());a.quantity='3';d.add(lines,'rd',offer('C','98%'));const first=d.snapshot(lines,revs);
 a.quantity='4';d.replace(a,offer('B'));lines.pop();const second=d.snapshot(lines,revs);
 assert.equal(first.lines.length,2);assert.equal(first.lines[0].quantity,'3');assert.equal(first.lines[0].row.id,'A');assert.equal(second.revision,2);assert.equal(second.lines.length,1);assert.throws(()=>d.snapshot([],revs),/RM/);
});

// ---- ข้อบกพร่องที่พบตอนทวน workflow หลายรายการ 2026-09-09 ----
test('reference ที่ชี้ไม่ถึงรายการคลังใดเลย ต้องเป็น "ยังไม่เชื่อมคลัง" ไม่ใช่ยอดศูนย์',()=>{
 // ยอดศูนย์แปลว่า "ของหมด" RD จะสั่งซื้อทันที · ยังไม่เชื่อมแปลว่า "ยังอ่านยอดไม่ได้" ต้องแยกกัน
 const rows=[row('a')]; // item RM-1 · spec 95% · uom kg · AVAILABLE 8
 assert.equal(d.balance(rows,{item:'RM-1',spec:'95%',uom:'g',confirmed:true}),null,'หน่วยไม่ตรง = mapping ยังไม่ครบ');
 assert.equal(d.balance(rows,{item:'RM-9',spec:'95%',uom:'kg',confirmed:true}),null,'ไม่มีรายการนี้ในคลัง');
 assert.equal(d.balance(rows,{item:'RM-1',spec:'98%',uom:'kg',confirmed:true}),null,'spec ไม่ตรง');
 assert.equal(d.balance([row('a','HOLD')],{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),0,'มีรายการจริงแต่ไม่มี lot AVAILABLE = ศูนย์');
 assert.equal(d.balance(rows,{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),8,'ปกติต้องได้ยอดเดิม');
 assert.equal(d.balance([row('a','AVAILABLE',{category:'PK'})],{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),null,'รายการ PK ไม่ใช่หลักฐานว่าผูก RM แล้ว');
});
test('ข้อเสนอของสารเดียวกัน (materialId เดียวกัน) ไม่แตกเป็นสองแถว แม้ตัวหนึ่งผูกคลังแล้วอีกตัวยังไม่ผูก',()=>{
 // แตกเป็นสองแถว = demand ของสารนั้นถูกนับซ้ำ · การรวมนี้ใช้ materialId ที่ระบบกำหนด ไม่ใช่ชื่อคล้ายกัน
 const linked={id:'A',materialId:'MAT-1',name:'Synthetic',spec:'95%',price:450,link:{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}};
 const unlinked={id:'A-OLD',materialId:'MAT-1',name:'Synthetic',spec:'95%',price:470,link:null};
 let lines=[];const a=d.add(lines,'rd',linked);a.quantity='5';d.add(lines,'rd',unlinked);
 assert.equal(lines.length,1);assert.equal(a.row.id,'A','ฐานราคาเดิมต้องไม่ถูกเปลี่ยนเอง');assert.equal(a.quantity,'5');
 lines=[];const b=d.add(lines,'rd',unlinked);b.quantity='5';d.add(lines,'rd',linked);
 assert.equal(lines.length,1);assert.equal(b.row.id,'A-OLD');assert.equal(b.quantity,'5');
 d.replace(b,linked);
 assert.equal(b.row.id,'A',' เปลี่ยนข้อเสนอไปตัวที่ผูกคลังแล้วได้');assert.equal(b.quantity,'5','ปริมาณคงเดิม');
 assert.equal(d.balance([row('a')],b.row.link),8,'เปลี่ยนแล้วอ่านยอดคลังได้');
 assert.throws(()=>d.replace(b,{id:'Z',materialId:'MAT-9',name:'Z',spec:'95%',link:null}),/เดียวกัน/,'ข้ามสารยังห้าม');
 lines=[];d.add(lines,'rd',{id:'N1',name:'ไม่มี materialId',spec:'95%'});d.add(lines,'rd',{id:'N2',name:'ไม่มี materialId',spec:'95%'});
 assert.equal(lines.length,2,'ไม่มี materialId ห้ามเดารวมจากชื่อ');
});
test('กดเพิ่มข้อเสนอลงสารที่มีแถวจากคลังอยู่แล้ว ต้องไม่ตั้งฐานราคาให้เอง',()=>{
 const lines=[];d.add(lines,'stock',row('L1'));
 const line=d.add(lines,'rd',{id:'A',materialId:'MAT-1',name:'Synthetic',spec:'95%',price:450,link:{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}});
 assert.equal(lines.length,1,'ไม่เพิ่มแถวซ้ำ');
 assert.equal(line.kind,'stock','ฐานราคาต้องไม่ถูกตั้งเอง — ผู้ใช้ต้องกดเปลี่ยนข้อเสนอ');
});
test('แถวที่เริ่มจากคลังจำตัวตนสารจากข้อเสนอที่ผูกยืนยันแล้ว ข้อเสนออื่นของสารนั้นจึงไม่แตกแถว',()=>{
 // RD เลือกจากคลังก่อน แล้วอยากได้ราคาจากข้อเสนอเก่าที่ยังไม่ผูกคลัง — ต้องยังเป็นแถวเดียว
 const linked={id:'A',materialId:'MAT-1',name:'Synthetic',spec:'95%',price:450,link:{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}};
 const unlinked={id:'A-OLD',materialId:'MAT-1',name:'Synthetic',spec:'95%',price:470,link:null};
 const lines=[];const line=d.add(lines,'stock',row('L1'));line.quantity='4';
 assert.equal(d.materialOf(line),null,'แถวจากคลังยังไม่รู้ตัวตนสารด้วยตัวเอง');
 d.add(lines,'rd',linked);
 assert.equal(d.materialOf(line),'MAT-1','ข้อเสนอที่ผูกยืนยันแล้วและตรงคีย์เดียวกันเป็นหลักฐานว่าเป็นสารใด');
 assert.equal(line.kind,'stock','การรู้ตัวตนต้องไม่เปลี่ยนฐานราคา');
 d.add(lines,'rd',unlinked);
 assert.equal(lines.length,1,'ข้อเสนออื่นของสารเดียวกันต้องไม่แตกแถว');
 assert.equal(line.quantity,'4','ปริมาณเดิมคงอยู่');
 d.replace(line,unlinked);
 assert.equal(line.row.id,'A-OLD');assert.equal(line.kind,'rd');assert.equal(line.quantity,'4');
 const other=[];d.add(other,'stock',row('L2'));d.add(other,'rd',{id:'Z',materialId:'MAT-9',name:'Other',spec:'95%',link:null});
 assert.equal(other.length,2,'สารอื่นที่ไม่มีหลักฐานผูกกัน ต้องยังแยกแถว');
});
