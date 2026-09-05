// RmCatalogBuild — ประกอบแคตตาล็อกสำหรับเครื่องคำนวณจากตารางใน RD Data Center
//
// รวมสามตาราง: แคตตาล็อกสาร (RD-Code เป็นตัวตน) · ตารางจับคู่ราคา · หลักฐานราคา
// และเติม Lead Time จากตารางสารที่เสนอเมื่อจับคู่ได้
//
// หลักที่ยึด
//   - RD-Code เป็นเจ้าของตัวตนวัสดุ ไม่สร้างรหัสใหม่ ไม่เดาจากชื่อ
//   - ทุก Tier ถูกส่งออกเป็นคนละข้อเสนอ ไม่คัดเหลือ max หรือ min
//   - แถวที่ข้อมูลไม่ครบยัง "ออก" มาพร้อมรายการที่ขาด เพื่อให้เห็นว่ามีสารอยู่
//     แต่ตั้ง status ไม่ให้ผ่านเกณฑ์ จึงคิดต้นทุนไม่ได้ ตามที่เจ้าของระบบยืนยัน
var RmCatalogBuild = (function () {
  'use strict';
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function norm(v) {
    return text(v).toLowerCase().replace(/[®™()\[\]{}.,\-_\/\\%]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Lead Time ในต้นทางเป็นข้อความอิสระ เช่น "7-14 วัน" หรือ
  // "ปกติมี stock แต่ถ้า stock หมดรอของ 7-14 วัน" — ใช้ค่าสูงสุดเพื่อไม่ให้ประเมินต่ำไป
  function leadTimeDays(raw) {
    var s = text(raw);
    if (s === '') return null;
    var nums = s.match(/\d+/g);
    if (!nums) return null;
    var days = nums.map(Number).filter(function (n) { return n > 0 && n <= 365; });
    if (!days.length) return null;
    return Math.max.apply(null, days);
  }
  function indexByName(rows, nameKey, valueKey) {
    var map = {};
    (rows || []).forEach(function (row) {
      var key = norm(row[nameKey]);
      if (!key) return;
      var days = leadTimeDays(row[valueKey]);
      if (days === null) return;
      // เจอหลายรายการชื่อเดียวกัน ใช้ค่าสูงสุดเพื่อความปลอดภัย
      map[key] = map[key] === undefined ? days : Math.max(map[key], days);
    });
    return map;
  }
  // input: {catalog, priceMap, offered} แต่ละตัวเป็น array ของ object ที่คีย์ตรงกับหัวคอลัมน์
  function build(input, options) {
    var opts = options || {};
    var mapper = opts.mapper || (typeof RmSourceMap !== 'undefined' ? RmSourceMap : null);
    if (!mapper) throw new Error('ต้องมี RmSourceMap');
    var leadIndex = indexByName(input.offered, 'Offered Ingredient', 'Lead Time');
    var byCode = {};
    (input.catalog || []).forEach(function (row) { if (text(row['RD-Code'])) byCode[text(row['RD-Code'])] = row; });
    var offers = [], skipped = [];
    (input.priceMap || []).forEach(function (row) {
      var code = text(row['RD-Code']);
      var master = byCode[code] || {};
      var rawPrice = text(row['Price Tiers (Raw)']), rawMoq = text(row['MOQ / Qty']);
      if (code === '') { skipped.push({code:code, reason:'ไม่มี RD-Code'}); return; }
      if (rawPrice === '' && rawMoq === '') { skipped.push({code:code, reason:'ยังไม่มีราคา'}); return; }
      var mapped = mapper.normalisePair(rawMoq, rawPrice);
      if (!mapped.usable) { skipped.push({code:code, reason:mapped.notes.join(', ')}); return; }
      var sourceName = text(row['Price-source Ingredient (editable)']) || text(row['Master Ingredient']);
      var lead = leadIndex[norm(sourceName)];
      if (lead === undefined) lead = leadIndex[norm(row['Master Ingredient'])];
      var count = Math.min(mapped.moq.length, mapped.price.length);
      for (var i = 0; i < count; i++) {
        var moqNum = Number((mapped.moq[i].match(/[\d.]+/) || [])[0]);
        var priceNum = Number((mapped.price[i].match(/[\d.]+/) || [])[0]);
        var unit = (mapped.moq[i].match(/[a-zA-Z]+/) || ['kg'])[0].toLowerCase();
        offers.push({
          id: code + '-T' + (i + 1),
          version: 1,
          materialId: code,                       // RD-Code เป็นเจ้าของตัวตน
          tierId: 'T' + (i + 1),
          vendorId: text(row['Price-source Supplier (editable)']) || text(row['Master Supplier']),
          name: text(master['Ingredient Name']) || text(row['Master Ingredient']),
          group: text(master['Category']),
          spec: '',
          vendor: text(row['Price-source Supplier (editable)']) || text(row['Master Supplier']),
          currency: 'THB',
          price: Number.isFinite(priceNum) ? priceNum : null,
          priceUnit: 'kg',
          priceBasisQuantity: 1,
          moq: Number.isFinite(moqNum) ? moqNum : null,
          moqUnit: unit,
          increment: null,                        // ไม่มีในต้นทาง
          incrementUnit: unit,
          leadTimeDays: lead === undefined ? null : lead,
          validUntil: '',                         // ไม่มีในต้นทาง
          evidenceRef: text(row['Source']) || text(row['Match Evidence']),
          specApproved: null,                     // ไม่มีในต้นทาง
          status: text(master['Price Status']) === 'READY' ? 'confirmed' : 'review',
          priceDate: text(row['Price Date']),
          notes: mapped.notes.join(', ')
        });
      }
    });
    // เติมรายการที่ขาดให้แต่ละข้อเสนอ เพื่อให้เห็นว่าติดอะไร
    var REQUIRED = [['price','ราคา'],['moq','MOQ'],['increment','ขนาดสั่งเพิ่ม'],
      ['leadTimeDays','Lead Time'],['validUntil','วันหมดอายุราคา'],['evidenceRef','เลขอ้างอิง'],
      ['specApproved','การรับรอง spec'],['vendorId','รหัสผู้ขาย']];
    offers.forEach(function (offer) {
      offer.missing = REQUIRED.filter(function (pair) {
        var v = offer[pair[0]];
        return v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v));
      }).map(function (pair) { return pair[1]; });
      offer.usable = offer.missing.length === 0 && offer.status === 'confirmed';
    });
    return {offers:offers, skipped:skipped,
      summary:{materials:Object.keys(byCode).length, offers:offers.length,
        usable:offers.filter(function (o) { return o.usable; }).length,
        skipped:skipped.length, withLeadTime:offers.filter(function (o) { return o.leadTimeDays !== null; }).length}};
  }
  return {build:build, leadTimeDays:leadTimeDays};
})();
if (typeof module !== 'undefined') module.exports = RmCatalogBuild;
