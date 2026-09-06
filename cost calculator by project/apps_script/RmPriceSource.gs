// RmPriceSource — อ่านตารางราคา RM ต้นฉบับโดยตรง
//
// ออกแบบจากข้อมูลจริง 2026-09-06: ตารางราคามี Name · Supplier · Price/kg · MOQ
// และ **ไม่มีคอลัมน์รหัสสาร** ส่วนตาราง RD-Code ไม่มีราคา ชื่อสองฝั่งตรงกันเพียง
// 3 จาก 158 แม้จับคู่แบบหลวมที่สุด จึงเป็นคนละชุดรายการ ไม่ใช่ปัญหารูปแบบชื่อ
//
// เจ้าของระบบสั่งว่าจัดซื้อต้องลงข้อมูลแบบเดิม ระบบจึงปรับเข้าหาแหล่ง ไม่ใช่บังคับ
// ให้แหล่งเปลี่ยน ตัวตนวัสดุจึงประกอบจาก ผู้ขาย + ชื่อ ซึ่งวัดแล้วว่าเสถียร:
// 44 กลุ่มที่มีหลายแถว มี 43 กลุ่มที่เป็น Tier จริง (MOQ ต่างกัน) ซ้ำจริงเพียง 1
//
// ทุกค่าที่ระบบเติมให้เองจะถูกทำเครื่องหมายไว้เสมอ ไม่มีการเดาแบบเงียบ
var RmPriceSource = (function () {
  'use strict';
  var MASS = {kg:1, g:0.001, mg:0.000001};
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function norm(v) {
    return text(v).toLowerCase().replace(/[®™()\[\]{}.,\-_\/\\%]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // ตัวตนที่คงที่ข้ามการนำเข้าแต่ละรอบ ต้องได้ค่าเดิมเสมอเมื่อชื่อและผู้ขายเดิม
  function materialKey(supplier, name) {
    var base = norm(supplier) + '|' + norm(name);
    var hash = 0;
    for (var i = 0; i < base.length; i++) { hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0; }
    return 'RMS-' + (hash >>> 0).toString(36).toUpperCase();
  }
  function priceOf(raw) {
    // รูปแบบที่พบจริง: ตัวเลขล้วน · N/kg · N thb/kg · N baht — ทั้งหมดเป็นราคาต่อกิโลกรัม
    var s = text(raw).replace(/,/g, '');
    var m = s.match(/^(?:thb\s*|฿\s*)?(\d+(?:\.\d+)?)\s*(?:(?:thb|baht|บาท)?\s*\/?\s*(kg|kilo|กก\.?|กิโล)?)?\.?$/i);
    if (!m) return null;
    var n = Number(m[1]);
    return isFinite(n) && n > 0 ? n : null;
  }
  function moqOf(raw) {
    var s = text(raw).replace(/,/g, '').replace(/^moq\s*/i, '').replace(/^repack\s+moq\s*/i, '');
    // ช่วง เช่น 1-10 kg — ใช้ขอบล่างเพราะ MOQ หมายถึงปริมาณต่ำสุดที่สั่งได้
    // และทำเครื่องหมายไว้ให้ Procurement ยืนยัน ไม่ใช่รับไปเงียบ ๆ
    var range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*([a-zA-Zก-๙]+)?\.?$/);
    if (range) {
      var unit = (range[3] || 'kg').toLowerCase();
      if (!MASS[unit]) return null;
      var lo = Number(range[1]), hi = Number(range[2]);
      if (!(hi > lo)) return null;                       // 10-1 หรือ 5-5 อ่านไม่ได้ ไม่เดา
      return {quantity:lo, unit:unit, fromRange:true, rangeUpper:hi};
    }
    var one = s.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Zก-๙]+)?\.?$/);
    if (!one) return null;
    var u = (one[2] || '').toLowerCase();
    if (u === '') return {quantity:Number(one[1]), unit:'kg', assumedUnit:true};
    if (!MASS[u]) return null;
    return {quantity:Number(one[1]), unit:u};
  }
  // rows = ตารางราคา · codes = ตาราง RD-Code (ไม่บังคับ) · options.priceValidDays = อายุราคา
  function build(rows, codes, options) {
    var opts = options || {};
    var validDays = opts.priceValidDays;
    var asOf = text(opts.asOf);
    var codeByName = {};
    (codes || []).forEach(function (c) {
      var k = norm(c['Ingredients Name']);
      if (k && !codeByName[k]) codeByName[k] = text(c['RD-Code']);
    });
    var groups = {}, skipped = [];
    (rows || []).forEach(function (row, index) {
      var name = text(row['Name']), supplier = text(row['Supplier']);
      var rawPrice = text(row['Price/kg']), rawMoq = text(row['MOQ']);
      if (!name) return;                                   // แถวว่าง ไม่ใช่ข้อผิดพลาด
      if (!rawPrice) { skipped.push({row:index + 2, reason:'ยังไม่มีราคา'}); return; }
      // ไม่มีผู้ขาย = ระบุตัวตนไม่ได้ ถ้าเดาให้เป็น "ไม่ระบุ" สองแถวคนละเจ้าจะยุบเป็น
      // วัสดุตัวเดียวแล้วเอาราคาสองเจ้ามาเรียงเป็นบันไดราคาเดียว ซึ่งซื้อจริงไม่ได้
      if (!supplier) { skipped.push({row:index + 2, reason:'ไม่มีชื่อผู้ขาย ระบุตัวตนวัสดุไม่ได้'}); return; }
      var price = priceOf(rawPrice);
      if (price === null) { skipped.push({row:index + 2, reason:'อ่านราคาไม่ได้'}); return; }
      var moq = moqOf(rawMoq);
      if (moq === null) { skipped.push({row:index + 2, reason:rawMoq ? 'อ่าน MOQ ไม่ได้ หรือหน่วยไม่ใช่น้ำหนัก' : 'ไม่มี MOQ'}); return; }
      var key = materialKey(supplier, name);
      if (!groups[key]) groups[key] = {materialId:key, name:name, supplier:supplier,
        rdCode:codeByName[norm(name)] || null, offers:[]};
      groups[key].offers.push({price:price, moq:moq, remark:text(row['Remark']),
        fn:text(row['Function']), sourceRow:index + 2});
    });
    var offers = [], materials = 0;
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      materials++;
      // Tier เรียงตาม MOQ จากน้อยไปมาก เพื่อให้หมายเลข Tier คงที่ทุกรอบการนำเข้า
      g.offers.sort(function (a, b) { return a.moq.quantity - b.moq.quantity || a.price - b.price; });
      g.offers.forEach(function (o) {
        var notes = [];
        if (o.moq.fromRange) notes.push('MOQ_FROM_RANGE');
        if (o.moq.assumedUnit) notes.push('MOQ_UNIT_ASSUMED_KG');
        // รหัสผูกกับปริมาณขั้นต่ำ ไม่ใช่ลำดับที่เรียงได้ การเติมแถวราคาแบ่งขายเข้ามา
        // ใหม่จึงไม่ทำให้รหัสของ Tier เดิมเลื่อน ซึ่งเคยทำให้การรับรอง spec ไปเกาะราคาผิดตัว
        var moqKg = o.moq.quantity * MASS[o.moq.unit];
        var slug = String(Math.round(moqKg * 1000)) + 'G';
        offers.push({
          id: key + '-' + slug, version: 1, tierId: o.moq.quantity + ' ' + o.moq.unit,
          materialId: key, rdCode: g.rdCode,
          name: g.name, vendor: g.supplier, vendorId: g.supplier || 'ไม่ระบุผู้ขาย',
          group: '', spec: '', currency: 'THB',
          price: o.price, priceUnit: 'kg', priceBasisQuantity: 1,
          moq: o.moq.quantity, moqUnit: o.moq.unit,
          // ขนาดสั่งเพิ่มคือ "ขนาดบรรจุ" ซึ่งเป็นคนละเรื่องกับ MOQ และต้นฉบับไม่มี
          // การเติมให้เท่ากับ MOQ ทำให้เงินซื้อและของเหลือบวมเกินจริงเมื่อ MOQ 100
          // แต่บรรจุถุงละ 25 จึงเว้นว่างไว้ให้เห็นว่ายังไม่ครบ ตามกฎห้ามเดาแทนคน
          increment: null, incrementUnit: o.moq.unit,
          // ราคาช่วงใช้ได้เฉพาะในช่วงนั้น เก็บขอบบนไว้ให้ตัดสินใจ ไม่ทิ้ง
          maxOrderQuantity: o.moq.rangeUpper === undefined ? null : o.moq.rangeUpper,
          leadTimeDays: null, specApproved: null,
          validUntil: validDays && asOf ? addDays(asOf, validDays) : '',
          // เลขแถวขยับทุกครั้งที่เรียงหรือแทรกชีต จึงไม่ใช่ตัวอ้างอิงที่นิ่ง
          evidenceRef: 'PriceOfRM:' + key + '-' + slug,
          sourceRow: o.sourceRow,
          status: 'review',
          condition: o.remark,
          notes: notes.concat(validDays && asOf ? ['VALIDITY_FROM_POLICY'] : [])
        });
      });
    });
    return {offers:offers, skipped:skipped,
      summary:{rows:(rows || []).length, materials:materials, offers:offers.length,
        skipped:skipped.length, withRdCode:offers.filter(function (o) { return !!o.rdCode; }).length,
        needMoqConfirm:offers.filter(function (o) { return o.notes.indexOf('MOQ_FROM_RANGE') >= 0; }).length,
        needIncrement:offers.length}};
  }
  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + Number(days));
    return d.toISOString().slice(0, 10);
  }
  return {build:build, materialKey:materialKey, priceOf:priceOf, moqOf:moqOf, addDays:addDays};
})();
if (typeof module !== 'undefined') module.exports = RmPriceSource;
