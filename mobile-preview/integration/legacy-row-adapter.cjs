'use strict';
// Experimental, synthetic-only adapter. The supplied calculator and reference
// dataset are NOT authenticated here. Never use this to write production data.
function adaptLegacyRows(rows, derive) {
 if (!Array.isArray(rows) || typeof derive!=='function') throw Error('รายการสารหรือตัวคำนวณไม่ถูกต้อง');
 const source=structuredClone(rows);
 const inputs=source.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.name!=='string'||!row.name.trim())throw Error('รายการสารต้องมีชื่อ');
  const number=v=>v==null||String(v).trim()===''?NaN:Number(v);
  const w=number(row.w),p=number(row.p);
  if(!Number.isFinite(w)||w<0)throw Error('ปริมาณสารไม่ถูกต้อง');
  // Zero/blank potency differs between inspected implementations; await owner decision.
  if(!Number.isFinite(p)||p<=0)throw Error('ความเข้มข้นต้องรอการยืนยันก่อนทดลอง');
  return {name:row.name.trim(),w,p,o:row.o||'—',note:row.note||'',hero:!!row.hero};
 });
 const derived=derive(structuredClone(inputs));
 if(!Array.isArray(derived)||derived.length!==source.length)throw Error('รายการสารจากตัวคำนวณไม่ตรง');
 return derived.map((r,i)=>{
  const x=inputs[i];
  if(!r||r.num!==i+1||r.name!==x.name||r.w!==x.w||r.p!==x.p||r.o!==x.o||r.note!==x.note||r.hero!==x.hero)throw Error('รายการสารจากตัวคำนวณไม่ตรง');
  if(!Number.isFinite(r.actual)||r.actual!==x.w*x.p/100)throw Error('ผลคำนวณจากตัวคำนวณไม่ตรง');
  if(!r.fda||typeof r.fda!=='object'||Array.isArray(r.fda)||!['status','cls','icon','tip'].every(k=>typeof r.fda[k]==='string'))throw Error('ข้อมูลประกอบจากตัวคำนวณไม่ครบ');
  const {num,name,w,p,actual,o,note,hero,fda}=r;
  return {...source[i],num,name,w,p,actual,o,note,hero,fda:structuredClone(fda)};
 });
}
module.exports={adaptLegacyRows};
