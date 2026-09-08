'use strict';
// Synthetic interaction prototype only. No production adapter, price policy or persistence.
const RmPickerDemo={
 visible:rows=>rows.filter(r=>r.category==='RM'&&r.status==='AVAILABLE'),
 chooseStock(rows,id){const r=this.visible(rows).find(r=>r.id===id);if(!r)throw Error('เลือกได้เฉพาะ RM AVAILABLE');return r;},
 balance(rows,link){
  if(!link||link.confirmed!==true)return null;
  const lots=this.visible(rows).filter(r=>r.item===link.item&&r.spec===link.spec&&r.uom===link.uom);
  if(lots.some(r=>typeof r.qty!=='number'||!Number.isFinite(r.qty)||r.qty<0))return null;
  return lots.reduce((total,r)=>total+r.qty,0);
 }
};
if(typeof module!=='undefined')module.exports=RmPickerDemo;
if(typeof document!=='undefined'){
 const stocks=[
  {id:'S1',item:'DEMO-RM1',category:'RM',status:'AVAILABLE',name:'สารตัวอย่าง Alpha',spec:'95%',qty:8,uom:'kg',lot:'LOT-A',expiry:'2027-06-30',location:'DEMO-A'},
  {id:'S2',item:'DEMO-RM1',category:'RM',status:'AVAILABLE',name:'สารตัวอย่าง Alpha',spec:'95%',qty:2,uom:'kg',lot:'LOT-B',expiry:'2027-12-31',location:'DEMO-B'},
  {id:'S3',item:'DEMO-RM1',category:'RM',status:'HOLD',name:'ห้ามแสดงในรายการ',spec:'95%',qty:99,uom:'kg',lot:'LOT-H'},
  {id:'S4',item:'DEMO-RM2',category:'RM',status:'AVAILABLE',name:'สารตัวอย่าง Alpha',spec:'98%',qty:4,uom:'kg',lot:'LOT-C',expiry:'2027-09-30',location:'DEMO-A'}
 ];
 const offers=[
  {id:'R1',name:'สารตัวอย่าง Alpha',spec:'95%',price:450,moq:5,lt:7,confirmed:true,link:{item:'DEMO-RM1',spec:'95%',uom:'kg',confirmed:true}},
  {id:'R2',name:'สารตัวอย่าง Alpha',spec:'98%',price:620,moq:10,lt:21,confirmed:true,link:null},
  {id:'R3',name:'สารใหม่ Beta',spec:'สารสกัด 10:1',price:null,moq:null,lt:null,confirmed:false,link:null}
 ];
 const $=id=>document.getElementById(id),money=n=>n==null?'รอยืนยัน':n.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
 let selected=null,source='all';
 const match=r=>$('query').value.trim().toLowerCase().split(/\s+/).every(w=>[r.id,r.item,r.name,r.spec,r.lot].join(' ').toLowerCase().includes(w));
 function render(){
  const rows=$('results');rows.replaceChildren();
  function card(r,kind){
   const el=document.createElement('article'),h=document.createElement('h2');h.textContent=r.name+' · '+r.spec;el.append(h);
   const p=document.createElement('p');
   const balance=kind==='rd'?RmPickerDemo.balance(stocks,r.link):r.qty;
   p.textContent=kind==='rd'?'RD Data Center · '+r.id+' · '+(r.confirmed?'รับรองแล้ว (ตัวอย่าง)':'รอรับรอง spec / เงื่อนไขซื้อ'):'Stock Inventory · '+r.item+' · AVAILABLE';el.append(p);
   const detail=document.createElement('p');detail.className='detail';
   detail.textContent=kind==='rd'?'ราคา '+money(r.price)+' THB/kg · MOQ '+(r.moq??'รอข้อมูล')+' kg · LT '+(r.lt??'รอข้อมูล')+' วัน':'Lot '+r.lot+' · หมดอายุ '+r.expiry+' · ตำแหน่ง '+r.location;el.append(detail);
   const qty=document.createElement('p');qty.className='balance';qty.textContent=balance==null?'ยังไม่เชื่อมรายการคลัง — ไม่ใช่ยอดศูนย์':'คงเหลือ AVAILABLE '+money(balance)+' kg'+(kind==='rd'?' · คู่รายการยืนยันแล้ว':'');el.append(qty);
   if(kind==='stock'){const p=document.createElement('p');p.textContent='ฐานราคาคำนวณ: รอยืนยัน · ไม่ใช้ราคา IN อัตโนมัติ';el.append(p);}
   const b=document.createElement('button');b.textContent=kind==='rd'?'เลือกข้อเสนอนี้':'เลือกรายการคลังนี้';b.dataset.pick=r.id;b.onclick=()=>{selected={kind,row:kind==='stock'?RmPickerDemo.chooseStock(stocks,r.id):r};$('draft').textContent='';renderSelection();$('selection').scrollIntoView({block:'start',behavior:'smooth'});};el.append(b);rows.append(el);
  }
  if(source!=='stock')offers.filter(match).forEach(r=>card(r,'rd'));
  if(source!=='rd')RmPickerDemo.visible(stocks).filter(match).forEach(r=>card(r,'stock'));
  $('count').textContent='พบ '+rows.childElementCount+' ตัวเลือก · คลังแสดงเฉพาะ AVAILABLE';
 }
 function renderSelection(){
  $('selection').hidden=!selected;if(!selected)return;
  const {row:r,kind}=selected;const amount=kind==='rd'?RmPickerDemo.balance(stocks,r.link):r.qty;
  $('chosen').textContent=r.name+' · '+r.spec+' · '+(kind==='rd'?'ข้อเสนอ '+r.id:'รหัส '+r.item+' / '+r.lot);
  const demand=$('demand').value.trim(),n=Number(demand);
  $('comparison').textContent=amount==null?'ยังเทียบสต็อกไม่ได้: รอคู่รายการคลังที่รับรอง':!demand||!Number.isFinite(n)||n<=0?'ระบุความต้องการเป็น kg เพื่อเทียบยอด':('ต้องการ '+money(n)+' kg · คงเหลือ '+money(amount)+' kg · '+(n>amount?'ขาด '+money(n-amount)+' kg':'ยอดเพียงพอ ณ เวลาตัวอย่าง')+' · ไม่หัก Reserve ซ้ำ');
  $('price').textContent=kind==='rd'?(r.confirmed?'ฐานราคา: ข้อเสนอ RD Data Center '+r.id+' · '+money(r.price)+' THB/kg':'ยังเป็น draft: รอรับรอง spec และเงื่อนไขซื้อ'):'ฐานราคา: รอยืนยัน — เลือกคลังแล้วไม่ได้เลือก Unit Cost จาก IN';
 }
 $('query').oninput=render;$('source').onchange=e=>{source=e.target.value;render();};
 $('demand').oninput=()=>{$('draft').textContent='';renderSelection();};
 $('keep').onclick=()=>{if(!selected)return;if(selected.kind==='stock')RmPickerDemo.chooseStock(stocks,selected.row.id);$('draft').textContent='เก็บตัวเลือกในร่างทดลองแล้ว · '+selected.row.name+' '+selected.row.spec+' · ยังไม่บันทึกลงสูตรจริง ไม่จองหรือตัดสต็อก';};
 render();
}
