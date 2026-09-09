'use strict';
// ตัวอ่านชีต Stock onhand — ข้อมูลทดสอบเป็นค่าสังเคราะห์ที่มีรูปทรงเดียวกับชีตจริง
// ไม่มีรหัสสินค้า ชื่อผู้ขาย หรือยอดจริงถูกคัดลอกมา
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../apps_script/StockOnhandSource.gs');
const AT='2026-09-09T09:00:00.000Z';
// หัวตารางไม่ได้อยู่แถวแรก และมีคอลัมน์ Reserve ปนมาเพื่อพิสูจน์ว่าไม่ถูกนำไปหัก
const HEAD=['New Code','Trade name','Spec','คงเหลือ','UOM','status','Lot','Location','Exp. date','Category','Reserve'];
const grid=(...rows)=>[['รายงานคงเหลือ','','','','','','','','','',''],[],HEAD,...rows];
const lot=(item,spec,qty,status='AVAILABLE',extra={})=>[item,extra.name||'ชื่อสังเคราะห์',spec,qty,extra.uom||'kg',status,extra.lot||'L1',extra.loc||'A-01','',extra.cat===undefined?'RM':extra.cat,extra.reserve??''];

test('อ่านชีตที่หัวตารางไม่ได้อยู่แถวแรก และรายงานเลขแถวจริงของชีต',()=>{
 const out=S.read(grid(lot('RM-1','95%','8'),[],lot('RM-2','98%','4')),{readAt:AT});
 assert.equal(out.summary.headerRow,3);
 assert.equal(out.lots.length,2);
 assert.equal(out.lots[0].sourceRow,4,'แถวข้อมูลแรกคือแถว 4 ของชีต');
 assert.equal(out.lots[1].sourceRow,6,'แถวว่างไม่ทำให้เลขแถวเพี้ยน');
 assert.equal(out.readAt,AT);
});
test('เห็นเฉพาะ AVAILABLE · สถานะอื่นถูกนับและบอกเหตุผล ไม่หายเงียบ',()=>{
 const out=S.read(grid(lot('RM-1','95%','8'),lot('RM-1','95%','99','HOLD',{lot:'L2'}),lot('RM-1','95%','5','QC',{lot:'L3'}),lot('RM-1','95%','1','available',{lot:'L4'})),{readAt:AT});
 assert.equal(out.lots.length,2,'ตัวพิมพ์เล็กเป็นความต่างของการพิมพ์ ไม่ใช่ความหมาย');
 assert.ok(out.lots.every(l=>l.status==='AVAILABLE'));
 assert.equal(out.skipped.length,2);
 assert.deepEqual(out.skipped.map(s=>s.row),[5,6]);
 assert.match(out.skipped[0].reason,/HOLD/);
 assert.equal(out.summary.statuses.HOLD,1);assert.equal(out.summary.statuses.QC,1);
});
test('ยอดที่อ่านไม่ได้ต้องเป็นไม่ทราบ ไม่ใช่ศูนย์ และไม่หัก Reserve',()=>{
 const out=S.read(grid(lot('RM-1','95%','1,234.50',undefined,{reserve:'900'}),lot('RM-2','95%','',undefined,{lot:'L2'}),lot('RM-3','95%','12 kg',undefined,{lot:'L3'}),lot('RM-4','95%','-5',undefined,{lot:'L4'}),lot('RM-5','95%',7,undefined,{lot:'L5'})),{readAt:AT});
 assert.equal(out.lots[0].qty,1234.5,'คอมมาในตัวเลขอ่านได้ · Reserve 900 ต้องไม่ถูกหัก');
 assert.equal(out.lots[1].qty,null,'ว่าง = ไม่ทราบ');
 assert.equal(out.lots[2].qty,null,'มีหน่วยปนในช่องยอด = อ่านไม่ได้ ไม่เดา');
 assert.equal(out.lots[3].qty,null,'ติดลบอ่านไม่ได้');
 assert.equal(out.lots[4].qty,7,'ตัวเลขจากชีตโดยตรง');
 assert.equal(out.summary.unknownQuantity,3);
 assert.ok(!('reserve' in out.lots[0]),'ไม่ดึง Reserve เข้ามาในผลลัพธ์เลย');
});
test('ขาดคอลัมน์ที่จำเป็นต้องล้มพร้อมบอกชื่อ ไม่คืนรายการว่างให้เข้าใจว่าไม่มีของ',()=>{
 assert.throws(()=>S.read([['New Code','คงเหลือ'],['RM-1','8']],{readAt:AT}),e=>/ขาดคอลัมน์/.test(e.message)&&/UOM/.test(e.message)&&/status/.test(e.message));
 assert.throws(()=>S.read([[]],{readAt:AT}),/ขาดคอลัมน์/);
});
test('ต้องระบุเวลาที่อ่านต้นทาง ห้ามให้โดเมนตั้งความสดเอง',()=>{
 const rows=grid(lot('RM-1','95%','8'));
 for(const bad of [undefined,{},{readAt:''},{readAt:'2026-09-09'},{readAt:'เมื่อกี้'},{readAt:'2026-13-45T00:00:00Z'}])
  assert.throws(()=>S.read(rows,bad),/readAt|เวลาที่อ่าน/,JSON.stringify(bad));
});
test('ชีตที่ไม่มีคอลัมน์หมวด ต้องไม่เดาว่าเป็น RM',()=>{
 const head=HEAD.filter(h=>h!=='Category');
 const out=S.read([head,['RM-1','ชื่อ','95%','8','kg','AVAILABLE','L1','A-01','','']],{readAt:AT});
 assert.equal(out.lots[0].category,null);
 assert.equal(S.read(grid(lot('RM-1','95%','8',undefined,{cat:'PK'})),{readAt:AT}).lots[0].category,'PK','ชีตบอกหมวดมาก็ต้องส่งต่อตามนั้น');
});
test('คีย์ lot ที่ซ้ำกันถูกรายงาน ไม่รวมยอดเงียบ ๆ',()=>{
 const out=S.read(grid(lot('RM-1','95%','8',undefined,{lot:'',loc:''}),lot('RM-1','95%','2',undefined,{lot:'',loc:''})),{readAt:AT});
 assert.equal(out.duplicates.length,1);
 assert.deepEqual(out.duplicates[0].rows,[4,5]);
 assert.equal(out.summary.duplicates,1);
});
test('balance แยก "ยังไม่เชื่อมคลัง" ออกจาก "ไม่มีของ AVAILABLE"',()=>{
 const out=S.read(grid(lot('RM-1','95%','8'),lot('RM-1','95%','2',undefined,{lot:'L2'}),lot('RM-2','98%','9','HOLD',{lot:'L3'})),{readAt:AT});
 const link=(item,spec,uom='kg')=>({item,spec,uom,confirmed:true});
 assert.equal(S.balance(out.lots,link('RM-1','95%'),{known:out.known}),10,'รวมทุก lot AVAILABLE ของรายการเดียวกัน');
 assert.equal(S.balance(out.lots,link('RM-2','98%'),{known:out.known}),0,'ชีตมีรายการนี้ แต่ไม่มี lot AVAILABLE');
 assert.equal(S.balance(out.lots,link('RM-1','95%','g'),{known:out.known}),null,'หน่วยไม่ตรง = mapping ยังไม่ครบ');
 assert.equal(S.balance(out.lots,link('RM-9','95%'),{known:out.known}),null,'ไม่มีรายการนี้ในชีต');
 assert.equal(S.balance(out.lots,{item:'RM-1',spec:'95%',uom:'kg',confirmed:false},{known:out.known}),null,'reference ที่ยังไม่ยืนยันห้ามให้ยอด');
 assert.equal(S.balance(out.lots,null,{known:out.known}),null);
 const unknown=S.read(grid(lot('RM-1','95%','8'),lot('RM-1','95%','',undefined,{lot:'L2'})),{readAt:AT});
 assert.equal(S.balance(unknown.lots,link('RM-1','95%'),{known:unknown.known}),null,'มี lot ที่อ่านยอดไม่ได้ ทั้งรายการต้องเป็นไม่ทราบ');
});
test('ทางเข้าฝั่ง Apps Script ไม่ฝังรหัสไฟล์ และล้มพร้อมบอกเมื่อยังไม่ตั้งค่า',()=>{
 assert.throws(()=>S.readFromSheet({}),/Apps Script/,'เรียกนอก Apps Script ไม่ได้');
 const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../apps_script/StockOnhandSource.gs'),'utf8');
 assert.match(src,/if \(!id\) throw new Error\('ยังไม่ได้ตั้ง STOCK_ONHAND_SHEET_ID/,'ไม่มีค่าที่ตั้งไว้ต้องล้ม ไม่ใช่ใช้ค่าเริ่มต้น');
 assert.ok(!/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(src),'ต้องไม่มีลิงก์ไฟล์จริงฝังในโค้ด');
 assert.ok(!/['"][A-Za-z0-9_-]{25,}['"]/.test(src),'ต้องไม่มีสตริงที่หน้าตาเหมือนรหัสไฟล์ Drive ฝังในโค้ด');
 assert.ok(!/getDataRange\(\)\.getValues\(\)[\s\S]*getDataRange/.test(src.split('readFromSheet')[1]||''),'อ่านครั้งเดียวต่อการเรียก');
});
