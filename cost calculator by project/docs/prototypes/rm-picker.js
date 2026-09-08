'use strict';
// Synthetic interaction prototype only. No production adapter, price policy or persistence.
const RmPickerDemo={
 key(kind,r){const link=kind==='stock'?r:r.link?.confirmed?r.link:null;return JSON.stringify(link?[link.item,link.spec,link.uom]:['offer',r.materialId||r.id,r.spec]);},
 add(lines,kind,r){
  if(kind==='stock')this.chooseStock([r],r.id);
  const key=this.key(kind,r);let line=lines.find(l=>l.key===key);
  if(!line){line={key,kind,row:JSON.parse(JSON.stringify(r)),quantity:'',lots:[]};lines.push(line);}
  if(kind==='stock'&&!line.lots.some(l=>l.id===r.id))line.lots.push(JSON.parse(JSON.stringify(r)));
  return line;
 },
 replace(line,offer){if(this.key('rd',offer)!==line.key)throw Error('ต้องเป็นสารและ spec เดียวกันที่ยืนยันแล้ว');line.kind='rd';line.row=JSON.parse(JSON.stringify(offer));},
 snapshot(lines,revisions){if(!lines.length)throw Error('ยังไม่มี RM');const rev={revision:revisions.length+1,lines:JSON.parse(JSON.stringify(lines))};revisions.push(rev);return rev;},
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
 const lines=[],revisions=[];
 const alternatives=[...offers,{...offers[0],id:'R1-B',price:480,moq:2,lt:3}];
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
   const b=document.createElement('button');b.textContent=kind==='rd'?'เพิ่มข้อเสนอในรายการ RM':'เพิ่มรายการคลังใน RM';b.dataset.pick=r.id;b.onclick=()=>{selected={kind,row:kind==='stock'?RmPickerDemo.chooseStock(stocks,r.id):r};RmPickerDemo.add(lines,kind,selected.row);renderBasket();$('saveStatus').textContent='อัปเดตรายการ RM แล้ว · รายการเดิมไม่เพิ่มซ้ำ · ยังไม่บันทึก revision ใหม่';};el.append(b);rows.append(el);
  }
  if(source!=='stock')offers.filter(match).forEach(r=>card(r,'rd'));
  if(source!=='rd')RmPickerDemo.visible(stocks).filter(match).forEach(r=>card(r,'stock'));
  $('count').textContent='พบ '+rows.childElementCount+' ตัวเลือก · คลังแสดงเฉพาะ AVAILABLE';
 }
 function renderBasket(){
  const box=$('basket');box.replaceChildren();$('basketCount').textContent='รายการ RM ที่เลือก '+lines.length+' รายการ';$('basketJump').textContent='ดู RM ที่เลือก ('+lines.length+')';
  lines.forEach((line,index)=>{
   const card=document.createElement('article');card.dataset.line=index;if(selected&&line.key===RmPickerDemo.key(selected.kind,selected.row))card.className='active-line';
   const title=document.createElement('h3');title.textContent=(index+1)+'. '+line.row.name+' · '+line.row.spec;card.append(title);
   const label=document.createElement('label');label.textContent='ความต้องการ RM ของ scenario (kg)';
   const input=document.createElement('input');input.type='number';input.min='0';input.step='any';input.value=line.quantity;input.dataset.quantity=index;label.append(input);card.append(label);
   const comparison=document.createElement('p');card.append(comparison);
   const link=line.kind==='stock'?{item:line.row.item,spec:line.row.spec,uom:line.row.uom,confirmed:true}:line.row.link;
   const amount=RmPickerDemo.balance(stocks,link);
   const update=()=>{const n=Number(line.quantity);comparison.textContent=amount==null?'ยังไม่เชื่อมคลัง':('AVAILABLE '+money(amount)+' kg · '+(!line.quantity||!Number.isFinite(n)||n<=0?'รอปริมาณ':n>amount?'ขาด '+money(n-amount)+' kg':'ยอดเพียงพอ ณ เวลาตัวอย่าง'));};
   input.oninput=()=>{line.quantity=input.value;$('saveStatus').textContent='ร่างมีการแก้ไข — ยังไม่บันทึก revision ใหม่';update();};update();
   const details=document.createElement('details'),summary=document.createElement('summary');
   const lots=link?.confirmed?RmPickerDemo.visible(stocks).filter(r=>r.item===link.item&&r.spec===link.spec&&r.uom===link.uom):[];
   summary.textContent='ดู lot AVAILABLE ('+lots.length+') · ไม่จองหรือตัดสต็อก';details.append(summary);
   lots.forEach(l=>{const p=document.createElement('p');p.textContent=l.lot+' · '+money(l.qty)+' '+l.uom+' · หมดอายุ '+l.expiry;details.append(p);});card.append(details);
   const price=document.createElement('p');price.textContent=line.kind==='rd'?'ฐานราคา '+line.row.id+' · '+money(line.row.price)+' THB/kg · MOQ '+(line.row.moq??'รอข้อมูล')+' kg · LT '+(line.row.lt??'รอข้อมูล')+' วัน':'ฐานราคา: รอยืนยัน';card.append(price);
   const choices=alternatives.filter(o=>RmPickerDemo.key('rd',o)===line.key);
   if(choices.length){const select=document.createElement('select');select.setAttribute('aria-label','ข้อเสนอสำหรับ '+line.row.name+' '+line.row.spec);choices.forEach(o=>{const option=document.createElement('option');option.value=o.id;option.textContent=o.id+' · '+money(o.price)+' THB/kg · MOQ '+(o.moq??'รอข้อมูล')+' kg · LT '+(o.lt??'รอข้อมูล')+' วัน';select.append(option);});if(line.kind==='rd')select.value=line.row.id;card.append(select);
    const change=document.createElement('button');change.textContent='เปลี่ยนข้อเสนอ';change.dataset.replace=index;change.onclick=()=>{RmPickerDemo.replace(line,choices.find(o=>o.id===select.value));renderBasket();$('saveStatus').textContent='เปลี่ยนข้อเสนอในร่างแล้ว — revision เดิมไม่เปลี่ยน';};card.append(change);
   }
   const remove=document.createElement('button');remove.textContent='ลบรายการ';remove.dataset.remove=index;remove.className='remove';remove.onclick=()=>{lines.splice(index,1);renderBasket();$('saveStatus').textContent='ลบจากร่างแล้ว — revision เดิมไม่เปลี่ยน';};card.append(remove);box.append(card);
  });
  $('saveAll').disabled=!lines.length;
 }
 $('saveAll').onclick=()=>{const r=RmPickerDemo.snapshot(lines,revisions);$('saveStatus').textContent='บันทึก revision ทดลอง '+r.revision+' · '+r.lines.length+' รายการ · ยังไม่ใช่ราคาพร้อมเสนอ';const item=document.createElement('li');item.textContent='Revision '+r.revision+' — '+r.lines.map(l=>l.row.name+' '+l.row.spec+' / '+(l.quantity||'รอปริมาณ')+' kg / '+(l.kind==='rd'?l.row.id:'รอฐานราคา')).join(' · ');$('revisions').append(item);};
 renderBasket();
 $('query').oninput=render;$('source').onchange=e=>{source=e.target.value;render();};
 render();
}
