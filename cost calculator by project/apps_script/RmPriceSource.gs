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
  // เกินเพดานนี้มักเกิดจากวางราคาต่อถุงลงช่องราคาต่อกิโล แต่ actives บางตัวแพงจริง
  // จึงติดธงให้ Procurement ตรวจ ไม่ทิ้งแถว การทิ้งทำให้สารหายไปจากแคตตาล็อกเงียบ ๆ
  var PRICE_MAX_PER_KG = 100000;
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function norm(v) {
    // ไม่ตัด % ออก เพราะ "Acid 50%" กับ "Acid 50" เป็นคนละความเข้มข้น
    // เดิมตัดทิ้งแล้วสองตัวยุบเป็นวัสดุเดียว ชื่อของตัวหลังหายไปและราคากลายเป็น Tier ของตัวแรก
    return text(v).toLowerCase().replace(/[®™()\[\]{}.,\-_\/\\]/g, ' ')
      .replace(/\s*%/g, '%')                          // "50 %" กับ "50%" คือตัวเดียวกัน
      .replace(/\s+/g, ' ').trim();
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
    // หน่วยน้ำหนักจะยอมรับได้ก็ต่อเมื่อมี "/" หรือคำบอกสกุลเงินนำหน้า มิฉะนั้น "25 kg"
    // ซึ่งเป็นค่าของคอลัมน์ MOQ จะถูกอ่านเป็นราคา 25 เมื่อคอลัมน์สลับกัน ต่ำกว่าจริง 50 เท่า
    var m = s.match(/^(?:thb\s*|฿\s*)?(\d+(?:\.\d+)?)\s*(?:(?:thb|baht|บาท)\s*)?(?:\/\s*(?:kg|kilo|กก\.?|กิโล))?\.?$/i);
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
      if (!Object.prototype.hasOwnProperty.call(MASS, unit)) return null;
      var lo = Number(range[1]), hi = Number(range[2]);
      if (!(lo > 0) || !(hi > lo)) return null;          // 10-1 · 5-5 · 0-10 อ่านไม่ได้ ไม่เดา
      // ช่วงที่ไม่มีหน่วยก็เดาว่าเป็นกิโลกรัมเหมือนกัน จึงต้องติดเครื่องหมายด้วย
      var r = {quantity:lo, unit:unit, fromRange:true, rangeUpper:hi};
      if (!range[3]) r.assumedUnit = true;
      return r;
    }
    var one = s.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Zก-๙]+)?\.?$/);
    if (!one) return null;
    var u = (one[2] || '').toLowerCase();
    var q = Number(one[1]);
    if (!(q > 0)) return null;                           // MOQ ศูนย์ไม่มีความหมาย
    if (u === '') return {quantity:q, unit:'kg', assumedUnit:true};
    if (!Object.prototype.hasOwnProperty.call(MASS, u)) return null;
    return {quantity:q, unit:u};
  }
  // rows = ตารางราคา · codes = ตาราง RD-Code (ไม่บังคับ) · options.priceValidDays = อายุราคา
  function build(rows, codes, options) {
    var opts = options || {};
    // ต้องเป็นตัวเลขและวันที่ที่ใช้ได้จริง มิฉะนั้น addDays จะโยน RangeError ทิ้งทั้งการนำเข้า
    // หรือแย่กว่านั้นคือติดป้ายว่าใช้นโยบายแล้วทั้งที่ไม่มีวันหมดอายุติดไปเลย
    var days = Number(opts.priceValidDays);
    var rawAsOf = text(opts.asOf);
    var validPolicy = isFinite(days) && days > 0 && /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf)
      && !isNaN(new Date(rawAsOf + 'T00:00:00Z').getTime());
    var validDays = validPolicy ? days : null;
    var asOf = validPolicy ? rawAsOf : '';
    var codeByName = {};
    (codes || []).forEach(function (c) {
      var k = norm(c['Ingredients Name']);
      if (k && !codeByName[k]) codeByName[k] = text(c['RD-Code']);
    });
    var groups = {}, skipped = [];
    (rows || []).forEach(function (row, index) {
      var name = text(row['Name']), supplier = text(row['Supplier']);
      var rawPrice = text(row['Price/kg']), rawMoq = text(row['MOQ']);
      // แถวว่างสนิทข้ามได้ แต่แถวที่มีราคาหรือผู้ขายแล้วไม่มีชื่อ ต้องนับไว้
      // มิฉะนั้น offers + skipped จะไม่เท่ากับจำนวนแถว แล้วไล่ตรวจไม่ได้ว่าหายไปไหน
      if (!name) {
        if (rawPrice || supplier || rawMoq) skipped.push({row:index + 2, reason:'ไม่มีชื่อสาร'});
        return;
      }
      if (!rawPrice) { skipped.push({row:index + 2, reason:'ยังไม่มีราคา'}); return; }
      // ไม่มีผู้ขาย = ระบุตัวตนไม่ได้ ถ้าเดาให้เป็น "ไม่ระบุ" สองแถวคนละเจ้าจะยุบเป็น
      // วัสดุตัวเดียวแล้วเอาราคาสองเจ้ามาเรียงเป็นบันไดราคาเดียว ซึ่งซื้อจริงไม่ได้
      if (!supplier) { skipped.push({row:index + 2, reason:'ไม่มีชื่อผู้ขาย ระบุตัวตนวัสดุไม่ได้'}); return; }
      var price = priceOf(rawPrice);
      if (price === null) {
        // แยกให้ชัดว่าอ่านไม่ออก กับคอลัมน์สลับกันมา เพราะวิธีแก้คนละอย่าง
        var looksMass = /^\s*\d+(?:\.\d+)?\s*(kg|g|mg|kilo|กก\.?|กิโล|กรัม)\s*\.?$/i.test(rawPrice);
        skipped.push({row:index + 2,
          reason:looksMass ? 'ช่องราคาเป็นหน่วยน้ำหนัก คอลัมน์อาจสลับกับ MOQ' : 'อ่านราคาไม่ได้'});
        return;
      }
      var moq = moqOf(rawMoq);
      if (moq === null) { skipped.push({row:index + 2, reason:rawMoq ? 'อ่าน MOQ ไม่ได้ หรือหน่วยไม่ใช่น้ำหนัก' : 'ไม่มี MOQ'}); return; }
      var key = materialKey(supplier, name);
      if (!groups[key]) groups[key] = {materialId:key, name:name, supplier:supplier,
        rdCode:codeByName[norm(name)] || null, offers:[]};
      groups[key].offers.push({price:price, moq:moq, remark:text(row['Remark']),
        fn:text(row['Function']), sourceRow:index + 2});
    });
    var offers = [], materials = 0, conflicts = [];
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      materials++;
      // Tier เรียงตาม MOQ จากน้อยไปมาก เพื่อให้หมายเลข Tier คงที่ทุกรอบการนำเข้า
      // เรียงตามน้ำหนักจริง ไม่ใช่ตัวเลขดิบ มิฉะนั้น 500 g จะไปอยู่หลัง 25 kg
      var ug = function (m) { return Math.round(m.moq.quantity * MASS[m.moq.unit] * 1e6); };
      g.offers.sort(function (a, b) { return ug(a) - ug(b) || a.price - b.price; });
      // แถวที่ MOQ หนักเท่ากันคือ Tier เดียวกัน แม้เขียนคนละหน่วย ("1 kg" กับ "1000 g")
      // ราคาเท่ากันคือแถวซ้ำ ยุบได้ · ราคาต่างกันคือต้นฉบับกำกวม ตัดสินแทนไม่ได้
      // ทั้งสองกรณีห้ามออกเป็นสองข้อเสนอ เพราะรหัสจะชนกันแล้วตัวนำเข้าปฏิเสธทั้งไฟล์
      var byMass = {}, order = [];
      g.offers.forEach(function (o) {
        var k = String(ug(o));
        if (!byMass[k]) { byMass[k] = []; order.push(k); }
        byMass[k].push(o);
      });
      order.forEach(function (k) {
        var same = byMass[k];
        var prices = same.map(function (x) { return x.price; })
          .filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (prices.length > 1) {
          conflicts.push({materialId:key, name:g.name, supplier:g.supplier,
            tierId:same[0].moq.quantity + ' ' + same[0].moq.unit,
            // เรียงตามเลขแถวเพื่อให้ไล่เปิดชีตตามลำดับได้ ไม่ใช่ตามลำดับที่บังเอิญเรียงราคา
            rows:same.map(function (x) { return x.sourceRow; }).sort(function (a, b) { return a - b; }),
            reason:'MOQ น้ำหนักเท่ากันแต่ราคาไม่ตรงกัน ต้องให้ Procurement ชี้ว่าใช้แถวไหน'});
          same.map(function (x) { return x.sourceRow; }).sort(function (a, b) { return a - b; })
            .forEach(function (r) {
              skipped.push({row:r, reason:'ราคาขัดแย้งกับอีกแถวที่ MOQ เท่ากัน'});
            });
          return;
        }
        var o = same[0], dupRows = same.slice(1).map(function (x) { return x.sourceRow; });
        var notes = [];
        if (o.moq.fromRange) notes.push('MOQ_FROM_RANGE');
        if (o.moq.assumedUnit) notes.push('MOQ_UNIT_ASSUMED_KG');
        if (o.price > PRICE_MAX_PER_KG) notes.push('PRICE_ABOVE_PLAUSIBLE_RANGE');
        if (dupRows.length) notes.push('DUPLICATE_ROWS:' + dupRows.join('+'));
        // รหัสผูกกับปริมาณขั้นต่ำอย่างเดียว ไม่ผูกลำดับแถวและไม่ผูกราคา
        // ผูกลำดับ = เติมแถวแบ่งขายแล้วรหัส Tier เดิมเลื่อน การรับรอง spec ไปเกาะผิดตัว
        // ผูกราคา = ผู้ขายขยับราคาแล้วรหัสเปลี่ยน การรับรองที่ทำไว้หลุดทั้งชุด
        // หน่วยไมโครกรัมเพื่อไม่ให้ MOQ ที่เล็กกว่ากรัมยุบเป็นศูนย์เหมือนกันหมด
        var slug = k + 'UG';
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
          // เจ้าของระบบยืนยัน (2026-09-06): ขอบบนของช่วงคือเพดานที่ราคานี้ใช้ได้จริง
          // เครื่องคำนวณอ่านคู่ maxOrderQuantity/maxOrderUnit จึงต้องส่งหน่วยไปด้วย
          maxOrderQuantity: o.moq.rangeUpper === undefined ? null : o.moq.rangeUpper,
          maxOrderUnit: o.moq.rangeUpper === undefined ? '' : o.moq.unit,
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
    return {offers:offers, skipped:skipped, conflicts:conflicts,
      summary:{rows:(rows || []).length, materials:materials, offers:offers.length,
        skipped:skipped.length, conflicts:conflicts.length,
        pricesAboveRange:offers.filter(function (o) { return o.notes.indexOf('PRICE_ABOVE_PLAUSIBLE_RANGE') >= 0; }).length, withRdCode:offers.filter(function (o) { return !!o.rdCode; }).length,
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
