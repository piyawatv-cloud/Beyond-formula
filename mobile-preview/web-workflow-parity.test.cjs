// เทียบแบบจำลองมือถือกับ workflow ของหน้าเว็บ production (formula.beyond-workflow.com, รุ่น cf7ab78)
// ROLES ด้านล่างคัดจาก index.html ของรุ่นนั้นโดยตรง; ตั้ง WEB_INDEX=<path> เพื่อให้เทสต์สกัดจากไฟล์เว็บสดแทนสำเนานี้
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const ctx={module:{exports:{}},Date};vm.runInNewContext(html.match(/<script id="model">([\s\S]*?)<\/script>/)[1],ctx);
const m=ctx.module.exports;
let WEB={admin:{createData:1,editFormula:1,chat:1,approve:'*',export:1,manageUsers:1,deleteChat:1,closeJob:1},pd:{editFormula:1,chat:1,approve:['pd']},ra:{chat:1,approve:['ra']},rd:{chat:1,approve:['rd']},sales:{createData:1,chat:1,approve:['sales'],closeJob:1,ownOnly:1},oversea:{createData:1,chat:1,approve:['sales'],export:1,closeJob:1,ownOnly:1},opc:{createData:1,chat:1,export:1,closeJob:1},mkt:{createData:1,editFormula:1,chat:1,approve:['pd','sales'],export:1,closeJob:1},purchasing:{chat:1}};
if(process.env.WEB_INDEX){const w=fs.readFileSync(process.env.WEB_INDEX,'utf8');const b=w.slice(w.indexOf('const ROLES = {'));const lit=b.slice(b.indexOf('{'),b.indexOf('};')+1).replace(/label:'[^']*',\s*desc:'[^']*',/g,'');WEB=vm.runInNewContext('('+lit.replace(/\n\s*can:/g,'can:')+')');WEB=Object.fromEntries(Object.entries(WEB).map(([k,v])=>[k,v.can]))}
const PARTS=['pd','ra','rd','sales'];
// 1) สิทธิ์ทุกบทบาท ตรงกับเว็บ
for(const [role,c] of Object.entries(WEB)){
  assert.equal(!!m.can(role,'create'),!!c.createData,role+' create');
  assert.equal(!!m.can(role,'formula'),!!c.editFormula,role+' formula');
  assert.equal(!!m.can(role,'chat'),!!c.chat,role+' chat');
  assert.equal(!!m.can(role,'close'),!!c.closeJob,role+' close');
  assert.equal(!!m.can(role,'export'),!!c.export,role+' export');
  assert.equal(!!m.can(role,'own'),!!c.ownOnly,role+' own-only visibility');
  assert.equal(!!m.can(role,'manage'),!!c.manageUsers,role+' manageUsers');
  const allowed=c.approve==='*'?PARTS:(c.approve||[]);
  for(const p of PARTS){const s=m.initialState();s.jobs[0].createdBy=role;s.jobs[0].salesOwner=role;let ok=true;try{m.approve(s,role,'A00001',p)}catch(e){ok=false}assert.equal(ok,allowed.includes(p),role+' approve '+p)}
}
// 2) ถอนอนุมัติ = ล้างทุกฝ่าย และดึงงานที่ปิดแล้วกลับ
{const s=m.initialState(),j=s.jobs[0];for(const p of PARTS)m.approve(s,'admin','A00001',p);
 assert.ok(j.messages.some(x=>/อนุมัติครบทุกฝ่าย/.test(x.text)),'ข้อความอนุมัติครบ');
 m.setClosed(s,'admin','A00001',true);assert.equal(j.closed,true);
 m.approve(s,'pd','A00001','pd');
 assert.deepEqual(PARTS.map(p=>j.approvals[p]),[false,false,false,false],'ถอน PD ต้องล้างทุกฝ่าย');
 assert.equal(j.closed,false,'ถอนอนุมัติ = ดึงงานปิดกลับ');
 assert.ok(j.messages.some(x=>/ดึงงานกลับ/.test(x.text)));
 const uids=j.messages.map(x=>x.uid);assert.equal(new Set(uids).size,uids.length,'รหัสข้อความไม่ซ้ำ')}
// 3) Reject: Admin หรือ Sales-role เจ้าของงานเท่านั้น · ยกเลิกไม่ได้ · ปิดงานซ้ำไม่ได้
{const s=m.initialState(),mine=m.create(s,'oversea',{customer:'x'});
 assert.equal(m.canReject(mine,'oversea'),true);assert.equal(m.canReject(mine,'admin'),true);
 for(const r of ['pd','ra','rd','opc','purchasing'])assert.equal(m.canReject(mine,r),false,r+' reject');
 assert.equal(m.canReject(mine,'mkt'),false,'MKT ไม่ใช่เจ้าของงาน');
 const other=s.jobs.find(x=>x.id==='A00001');assert.throws(()=>m.rejectJob(s,'oversea',other.id),/ไม่มีสิทธิ์|Reject ได้เฉพาะ/);
 assert.throws(()=>m.rejectJob(s,'opc',other.id),/Reject ได้เฉพาะ/);
 m.rejectJob(s,'oversea',mine.id);assert.ok(mine.rejected&&mine.rejected.by==='oversea');
 assert.throws(()=>m.rejectJob(s,'oversea',mine.id),/Reject แล้ว/);assert.throws(()=>m.setClosed(s,'oversea',mine.id,true),/Reject แล้ว/);
 const c=m.create(s,'sales',{customer:'y'});m.setClosed(s,'sales',c.id,true);assert.throws(()=>m.rejectJob(s,'sales',c.id),/ปิดแล้ว/);
 const d=m.dashStats(s,'admin');assert.equal(d.rejected,1);assert.equal(d.closed,1);assert.equal(m.isActive(mine),false)}
// 4) ปิด/เปิดงาน
{const s=m.initialState();assert.throws(()=>m.setClosed(s,'sales','A00001',false),/ยังไม่ได้ปิด/);m.setClosed(s,'sales','A00001',true);assert.throws(()=>m.setClosed(s,'sales','A00001',true),/ปิดแล้ว/);
 for(const r of ['pd','ra','rd','purchasing'])assert.throws(()=>m.setClosed(s,r,'A00001',false),/เปลี่ยนสถานะงานไม่ได้/);m.setClosed(s,'opc','A00001',false);assert.equal(s.jobs[0].closed,false)}
// 5) สถิติ: งานที่ปิด/Reject ไม่นับในกล่องอื่น
{const s=m.initialState();for(const p of PARTS)m.approve(s,'admin','A00001',p);let d=m.dashStats(s,'admin');assert.deepEqual([d.total,d.approved,d.pending],[2,1,1]);m.setClosed(s,'admin','A00001',true);d=m.dashStats(s,'admin');assert.deepEqual([d.total,d.approved,d.closed],[1,0,1])}
// 6) งานเงียบเกิน 7 วัน (ไม่นับงานปิด/Reject)
{const s=m.initialState(),j=s.jobs[0],day=86400000,now=Date.now();j.lastActivityAt=now-8*day;assert.equal(m.isStale(j,now),true);j.lastActivityAt=now-6*day;assert.equal(m.isStale(j,now),false);j.lastActivityAt=now-8*day;j.closed=true;assert.equal(m.isStale(j,now),false);j.closed=false;j.rejected={by:'admin'};assert.equal(m.isStale(j,now),false);delete j.lastActivityAt;j.rejected=undefined;assert.equal(m.isStale(j,now),false,'ไม่มีเวลาเคลื่อนไหว = ไม่เตือน')}
// 7) ล็อกผู้รับผิดชอบฝั่งขาย
for(const r of ['sales','oversea','mkt']){const s=m.initialState(),j=m.create(s,r,{customer:'z',salesOwner:'คนอื่น'});assert.equal(j.salesOwner,r,r+' ถูกล็อกเป็นของตนเอง')}
// 8) เห็นเฉพาะงานของตน (ownOnly) ส่วน MKT/OPC เห็นทั้งหมด
{const s=m.initialState();const o=m.create(s,'oversea',{customer:'o'});assert.equal(JSON.stringify(m.visible(s,'oversea').map(x=>x.id)),JSON.stringify([o.id]));assert.ok(m.visible(s,'mkt').length===s.jobs.length&&m.visible(s,'opc').length===s.jobs.length)}
// 9) ผู้ใช้หลายคนในบทบาทเดียวกัน: ownOnly ตามชื่อผู้ใช้ ไม่ใช่ตามบทบาท (เหมือนเว็บ r.createdBy===currentUser)
{const s=m.initialState();s.me.sales='sales2';const a=m.create(s,'sales',{customer:'ของ sales2'});assert.equal(a.createdBy,'sales2');assert.equal(a.salesOwner,'sales2');
 assert.equal(JSON.stringify(m.visible(s,'sales').map(x=>x.id)),JSON.stringify([a.id]),'sales2 เห็นเฉพาะงานตนเอง');
 s.me.sales='sales';assert.ok(!m.visible(s,'sales').some(x=>x.id===a.id),'sales คนแรกไม่เห็นงานของ sales2');assert.throws(()=>m.rejectJob(s,'sales',a.id),/ไม่มีสิทธิ์|Reject ได้เฉพาะ/);
 s.me.sales='sales2';m.rejectJob(s,'sales',a.id);assert.equal(a.rejected.by,'sales')
 const t=m.initialState();t.me.oversea='oversea2';const o=m.create(t,'oversea',{customer:'o2'});t.me.oversea='oversea';assert.equal(m.visible(t,'oversea').length,0,'oversea คนแรกไม่เห็นงานของ oversea2');
 t.me.sales='ไม่มีอยู่จริง';assert.equal(m.actor(t,'sales'),'sales','ชื่อที่ไม่มีอยู่ถอยกลับเป็นผู้ใช้หลัก')}
// 10) จัดการผู้ใช้: เฉพาะ Admin · กันลบ Admin คนสุดท้าย · งานของผู้ใช้ที่ลบยังอยู่
{const s=m.initialState();for(const r of Object.keys(WEB).filter(r=>r!=='admin'))assert.throws(()=>m.addUser(s,r,{name:'x',role:'sales'}),/เฉพาะ Admin/,r);
 m.addUser(s,'admin',{name:'ผู้ใช้ใหม่',role:'rd'});assert.throws(()=>m.addUser(s,'admin',{name:' ผู้ใช้ใหม่ ',role:'rd'}),/มีอยู่แล้ว/);assert.throws(()=>m.addUser(s,'admin',{name:'',role:'rd'}),/ชื่อผู้ใช้/);assert.throws(()=>m.addUser(s,'admin',{name:'y',role:'ไม่มี'}),/Role/);
 m.setUserRole(s,'admin','ผู้ใช้ใหม่','pd');assert.equal(s.users.find(u=>u.name==='ผู้ใช้ใหม่').role,'pd');
 assert.throws(()=>m.setUserRole(s,'admin','admin','pd'),/Admin ที่ใช้งานอยู่/);assert.throws(()=>m.setUserActive(s,'admin','admin',false),/Admin ที่ใช้งานอยู่/);assert.throws(()=>m.removeUser(s,'admin','admin'),/Admin ที่ใช้งานอยู่/);
 m.addUser(s,'admin',{name:'admin2',role:'admin'});m.setUserActive(s,'admin','admin',false);assert.equal(s.users.find(u=>u.name==='admin').active,false);
 const j=m.create(s,'sales',{customer:'ก่อนลบ'});m.removeUser(s,'admin','sales');assert.ok(s.jobs.some(x=>x.id===j.id),'งานของผู้ใช้ที่ถูกลบยังอยู่');
 assert.ok(s.activities.some(a=>a.cat==='user'&&a.action==='ลบผู้ใช้'),'บันทึกประวัติจัดการผู้ใช้')}
// 11) โหมดระบบจริงอ่านอย่างเดียว: ทุกการเขียนในโมเดลถูกปฏิเสธ
{const s=m.initialState();s.live=true;const err=/อ่านอย่างเดียว/;
 assert.throws(()=>m.create(s,'admin',{customer:'x'}),err);assert.throws(()=>m.approve(s,'admin','A00001','pd'),err);assert.throws(()=>m.rejectJob(s,'admin','A00001'),err);assert.throws(()=>m.setClosed(s,'admin','A00001',true),err);
 assert.throws(()=>m.send(s,'admin','A00001','x'),err);assert.throws(()=>m.edit(s,'admin','A00001',{notes:'x'}),err);assert.throws(()=>m.addUser(s,'admin',{name:'q',role:'rd'}),err);assert.throws(()=>m.recordChatExport(s,'admin','A00001'),err)}
console.log('PASS: workflow และสิทธิ์ตรงกับหน้าเว็บ production (cf7ab78)');
