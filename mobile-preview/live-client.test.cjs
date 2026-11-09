// ทดสอบไคลเอนต์โหมดระบบจริงกับ "ประตูข้อมูลจำลอง" ที่ทำตามสัญญาเดียวกับ runtime (ไม่เชื่อมระบบจริง)
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const src=html.match(/<script id="live-client">([\s\S]*?)<\/script>/)[1];
assert.ok(!/password\s*=|secret|apikey|service_role|Bearer /i.test(src.replace(/password\s*\|\|/g,'').replace(/String\(password/g,'')),'ไม่มีความลับฝังในโค้ด');
const ctx={module:{exports:{}},Date,Promise,Map,JSON,encodeURIComponent,Number,String,Array,Object,Error,TypeError,Math,Set};vm.runInNewContext(src,ctx);
const {create,LiveError}=ctx.module.exports;
const rec=(id,by,extra={})=>({id,updated_at:'2026-10-29T01:00:00Z',data:{id,customer:'ลูกค้า '+id,brand:'B',createdBy:by,salesOwner:by,rows:[{name:'x',w:'1'}],date:'29/10/2569',...extra}});
const DB={fs_records:[rec('A00003','sales2'),rec('A00002','oversea',{closed:{by:'oversea',at:'x',ts:1}}),rec('A00001','sales',{rejected:{by:'sales',at:'y',ts:2}})],
 fs_approvals:[{job_id:'A00001',part:'pd',data:{by:'pd',at:'t',ts:5},updated_at:'2026-10-29T01:00:00Z'},{job_id:'A00001',part:'sales',data:{by:'sales',at:'t2',ts:6},updated_at:'2026-10-29T01:00:00Z'},{job_id:'A00002',part:'xx',data:{by:'q'}}],
 fs_messages:Array.from({length:1500},(_,i)=>({uid:'M'+String(i).padStart(6,'0'),job_id:'A00001',ts:1000+i,updated_at:'2026-10-29T02:00:00Z',data:{type:i===0?'sys':'msg',user:'sales',text:'ข้อความ '+i}}))};
function gateway({role='admin',name='admin',session=true,breakWith=null}={}){
 const log=[];
 const transport=async(method,path,{headers={},body}={})=>{log.push({method,path,headers,body});
  if(breakWith==='net')throw new Error('offline');
  if(path==='/sb/session'){
   if(method==='POST'){const b=JSON.parse(body);return b.password==='ok'?{status:200,headers:{},body:'{}'}:{status:401,headers:{},body:'{"message":"x"}'}}
   if(method==='DELETE'){session=false;return{status:200,headers:{},body:'{}'}}
   return session?{status:200,headers:{},body:JSON.stringify({authenticated:true,name,role,canEdit:true,expiresAt:'2026-10-30T00:00:00Z'})}:{status:401,headers:{},body:'{"authenticated":false}'}}
  if(!session)return{status:401,headers:{},body:'{"message":"กรุณาเข้าระบบ"}'};
  if(breakWith==='403')return{status:403,headers:{},body:'{"message":"ไม่มีสิทธิ์"}'};
  if(breakWith==='bad')return{status:200,headers:{},body:'{"not":"array"}'};
  const m=/^\/sb\/rest\/v1\/(\w+)\?(.*)$/.exec(path);if(!m)return{status:404,headers:{},body:'{}'};
  const [,table,qs]=m,q=new URLSearchParams(qs.replace(/%28/g,'(').replace(/%29/g,')').replace(/%2C/g,','));
  let rows=DB[table].slice();
  if(table==='fs_records'&&['sales','oversea'].includes(role))rows=rows.filter(r=>r.data.createdBy===name);
  const f=q.get('job_id');if(f){const ids=[...f.matchAll(/"([A-Z]\d{5})"/g)].map(x=>x[1]);rows=rows.filter(r=>ids.includes(r.job_id))}
  const g=q.get('updated_at');if(g)rows=rows.filter(r=>r.updated_at>=g.slice(4));
  const order=q.get('order')||'';if(order.startsWith('id.desc'))rows.sort((a,b)=>b.id.localeCompare(a.id));if(order.startsWith('ts.asc'))rows.sort((a,b)=>a.ts-b.ts);
  const [from,to]=headers.Range.split('-').map(Number);return{status:200,headers:{},body:JSON.stringify(rows.slice(from,to+1))}};
 return{transport,log};
}
(async()=>{
 // ล็อกอิน
 let g=gateway({session:false});let live=create({transport:g.transport});
 await assert.rejects(()=>live.login('u','wrong'),e=>e instanceof LiveError&&e.code==='BAD_LOGIN'&&e.status===401);
 assert.equal(await live.session(),null);
 g=gateway({session:true,role:'admin'});live=create({transport:g.transport});
 const s=await live.login('admin','ok');assert.deepEqual({name:s.name,role:s.role},{name:'admin',role:'admin'});
 assert.equal(g.log.filter(x=>/password/i.test(String(x.body))).length,1,'รหัสผ่านถูกส่งครั้งเดียวตอนล็อกอิน');
 assert.ok(g.log.slice(1).every(x=>!/ok/.test(String(x.body||''))),'ไม่ส่งรหัสผ่านซ้ำ');
 // อ่านงาน + อนุมัติ + สถานะ
 const jobs=await live.loadJobs(100);assert.equal(jobs.map(j=>j.id).join(),'A00003,A00002,A00001');
 const a1=jobs.find(j=>j.id==='A00001'),a2=jobs.find(j=>j.id==='A00002');
 assert.deepEqual([a1.approvals.pd,a1.approvals.ra,a1.approvals.rd,a1.approvals.sales],[true,false,false,true]);assert.equal(a1.approvalInfo.pd.by,'pd');assert.ok(a1.rejected&&a1.rejected.by==='sales');
 assert.equal(a2.closed,true);assert.equal(a2.closedBy,'oversea');assert.equal(a2.approvals.pd,false,'ชื่อส่วนที่ไม่รู้จักถูกข้าม');assert.ok(jobs.every(j=>j.live===true));
 // ขอบเขตผู้ใช้: เซิร์ฟเวอร์กรอง (sales เห็นเฉพาะของตน)
 g=gateway({role:'sales',name:'sales'});live=create({transport:g.transport});assert.equal((await live.loadJobs()).map(j=>j.id).join(),'A00001');
 g=gateway({role:'oversea',name:'oversea'});live=create({transport:g.transport});assert.equal((await live.loadJobs()).map(j=>j.id).join(),'A00002');
 // ข้อความ แบ่งหน้า >1000 เรียงตามเวลา
 g=gateway();live=create({transport:g.transport});const ms=await live.loadMessages('A00001');assert.equal(ms.length,1500);assert.equal(ms[0].from,'system');assert.ok(ms[1].ts>ms[0].ts);assert.equal(new Set(ms.map(m=>m.uid)).size,1500);
 assert.ok(g.log.filter(x=>/fs_messages/.test(x.path)).some(x=>x.headers.Range==='1000-1999'),'อ่านหน้าที่สอง');
 await assert.rejects(()=>live.loadMessages('x; drop'),e=>e.code==='BAD_ID');
 // การเปลี่ยนแปลงตั้งแต่เวลาหนึ่ง (ใช้ตัวกรอง updated_at ของประตูข้อมูล)
 const ch=await live.changesSince('2026-10-29T01:30:00Z');assert.equal(ch.jobs.length,0);assert.equal(ch.messages.length,1000,'หน้าเดียวตามขีดจำกัดของประตูข้อมูล');assert.ok(g.log.some(x=>/updated_at=gte\.2026-10-29T01:30:00Z/.test(x.path)));
 await assert.rejects(()=>live.changesSince('ไม่ใช่เวลา'),e=>e.code==='BAD_TIME');
 // ความล้มเหลว: เซสชันหมด, ไม่มีสิทธิ์, เครือข่าย, ข้อมูลผิดรูป
 g=gateway({session:false});live=create({transport:g.transport});await assert.rejects(()=>live.loadJobs(),e=>e.code==='UNAUTHENTICATED'&&e.status===401);
 g=gateway({breakWith:'403'});live=create({transport:g.transport});await assert.rejects(()=>live.loadJobs(),e=>e.code==='FORBIDDEN');
 g=gateway({breakWith:'net'});live=create({transport:g.transport});await assert.rejects(()=>live.loadJobs(),e=>e.code==='NETWORK');
 g=gateway({breakWith:'bad'});live=create({transport:g.transport});await assert.rejects(()=>live.loadJobs(),e=>e.code==='INVALID');
 // ไม่มีการเขียน: ทุกคำขอเป็น GET ยกเว้นล็อกอิน/ล็อกเอาต์ที่ /sb/session
 g=gateway();live=create({transport:g.transport});await live.loadJobs();await live.loadMessages('A00001');await live.changesSince('2026-10-29T00:00:00Z');await live.logout();
 assert.ok(g.log.every(x=>x.method==='GET'||x.path==='/sb/session'),'อ่านอย่างเดียว');
 console.log('PASS: ไคลเอนต์โหมดระบบจริง (อ่านอย่างเดียว) ตามสัญญาประตูข้อมูล');
})().catch(e=>{console.error(e);process.exit(1)});
