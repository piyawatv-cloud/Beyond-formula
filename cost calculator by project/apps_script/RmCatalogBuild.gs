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
  function positive(v) { var s=text(v);return s!=='' && /^\d+(?:\.\d+)?$/.test(s) && Number(s)>0?Number(s):null; }
  function approved(v) { return v===true || text(v).toUpperCase()==='TRUE'; }
  function date(v) {
    if(v && typeof v.toISOString==='function')return Number.isFinite(v.getTime())?v.toISOString().slice(0,10):'';
    if(typeof v==='number')return Number.isFinite(v)&&v>0&&v<2958466?new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10):'';
    var s=text(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:'';
  }
  // Same exclusion vocabulary as RmData.normalize; source mapping must inspect
  // all evidence columns, including notes not otherwise mapped to a cost field.
  function excludedEvidence(value) {
    if(typeof value==='string')return /ยกเลิก|ยังไม่เคยซื้อ|ไม่ผ่าน\s*อย\.?|cancelled|canceled|never purchased|regulatory fail/i.test(value);
    if(value && typeof value==='object')return Object.keys(value).some(function(key){return excludedEvidence(value[key]);});
    return false;
  }
  // Only documented day forms are supported. Weeks/months and prose with
  // unrelated numbers remain unresolved; extracting every digit understated LT.
  function leadTimeDays(raw) {
    var s=text(raw).replace(/\s+/g,' '), match;
    if(/^\d+$/.test(s)) {var numeric=Number(s);return numeric>0&&numeric<=365?numeric:null;}
    match=s.match(/^(?:LT\s*|ปกติมี stock แต่ถ้า stock หมดรอของ\s*)?(\d+)(?:\s*-\s*(\d+))?\s*วัน$/i);
    if(!match)return null;
    var lower=Number(match[1]),upper=match[2]?Number(match[2]):lower;
    return lower>0&&upper>=lower&&upper<=365?upper:null;
  }
  function indexByName(rows, nameKey, valueKey) {
    var map = Object.create(null);
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
    var asOf=opts.asOf===undefined?new Date().toISOString().slice(0,10):date(opts.asOf);
    if(!asOf)throw new Error('AS_OF_DATE_REQUIRED');
    var mapper = opts.mapper || (typeof RmSourceMap !== 'undefined' ? RmSourceMap : null);
    if (!mapper) throw new Error('ต้องมี RmSourceMap');
    var leadIndex = indexByName(input.offered, 'Offered Ingredient', 'Lead Time');
    var byCode=Object.create(null),masterCounts=Object.create(null),priceCounts=Object.create(null);
    (input.catalog || []).forEach(function(row){var code=text(row['RD-Code']);if(code){masterCounts[code]=(masterCounts[code]||0)+1;byCode[code]=row;}});
    (input.priceMap || []).forEach(function(row){var code=text(row['RD-Code']);if(code)priceCounts[code]=(priceCounts[code]||0)+1;});
    var offers = [], skipped = [];
    (input.priceMap || []).forEach(function (row) {
      var code = text(row['RD-Code']);
      var master = byCode[code] || {};
      var rawPrice = text(row['Price Tiers (Raw)']), rawMoq = text(row['MOQ / Qty']);
      if (code === '') { skipped.push({code:code, reason:'ไม่มี RD-Code'}); return; }
      if(masterCounts[code]>1 || priceCounts[code]>1){skipped.push({code:code,reason:'AMBIGUOUS_RD_CODE: '+(masterCounts[code]>1?'catalog':'priceMap')});return;}
      if (rawPrice === '' && rawMoq === '') { skipped.push({code:code, reason:'ยังไม่มีราคา'}); return; }
      var mapped = mapper.normalisePair(rawMoq, rawPrice);
      if (!mapped.usable) { skipped.push({code:code, reason:mapped.notes.join(', ')}); return; }
      var blocked=excludedEvidence(master)||excludedEvidence(row),priceDate=date(row['Price Date']);
      var sourceReasons=[];
      if(blocked)sourceReasons.push('EXCLUDED_STATUS');
      if(!priceDate)sourceReasons.push('MISSING_OR_INVALID_PRICE_DATE');
      else if(priceDate>asOf)sourceReasons.push('FUTURE_PRICE_DATE');
      if(priceDate && date(row['Price Valid Until']) && date(row['Price Valid Until'])<priceDate)sourceReasons.push('INVALID_PRICE_DATE_RANGE');
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
          scope: {type:'central'},
          price: Number.isFinite(priceNum) ? priceNum : null,
          priceUnit: 'kg',
          priceBasisQuantity: 1,
          moq: Number.isFinite(moqNum) ? moqNum : null,
          moqUnit: unit,
          increment: positive(row['Order Increment (kg)']),
          incrementUnit: 'kg',
          leadTimeDays: lead === undefined ? null : lead,
          validUntil: date(row['Price Valid Until']),
          evidenceRef: text(row['Source']) || text(row['Match Evidence']),
          specApproved: text(row['Spec Approved'])===''?null:approved(row['Spec Approved']),
          // Local-source readiness is not evidence of authenticated Procurement
          // confirmation. A03 remains owned by the separate confirmation adapter.
          status: text(master['Price Status']) === 'READY' && sourceReasons.length===0 ? 'confirmed' : 'review',
          confirmationBasis: 'local-source-ready',
          procurementConfirmationVerified: false,
          excluded: blocked,
          sourceReasons: sourceReasons.slice(),
          priceDate: priceDate,
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
      offer.missing=offer.missing.concat(offer.sourceReasons);
      if(offer.specApproved===false)offer.missing.push('การรับรอง spec');
      if(offer.validUntil && offer.validUntil<asOf)offer.missing.push('ราคาหมดอายุ');
      offer.usable = offer.missing.length === 0 && offer.status === 'confirmed' && offer.specApproved===true;
    });
    return {offers:offers, skipped:skipped,
      summary:{materials:Object.keys(byCode).length, offers:offers.length,
        usable:offers.filter(function (o) { return o.usable; }).length,
        skipped:skipped.length, withLeadTime:offers.filter(function (o) { return o.leadTimeDays !== null; }).length}};
  }
  // Shared workbook discovery used by both browser and offline conversion. Scan
  // all rows: a repeated matching header is ambiguous, not a row to silently skip.
  function findTable(sheets, required) {
    var candidates=[];
    (sheets || []).forEach(function(sheet){
      if(!sheet || !Array.isArray(sheet.grid))throw new Error('INVALID_SHEET_GRID');
      sheet.grid.forEach(function(row,index){
        if(!Array.isArray(row))return;
        var header=row.map(text);
        if(!required.every(function(name){return header.indexOf(name)>=0;}))return;
        var present=header.filter(function(name){return name!=='';});
        if(present.some(function(name,i){return present.indexOf(name)!==i;}))throw new Error('AMBIGUOUS_HEADER: '+required.join(', '));
        var rows=sheet.grid.slice(index+1).filter(function(cells){return Array.isArray(cells)&&cells.some(function(value){return text(value)!=='';});}).map(function(cells){
          var mapped=Object.create(null);
          header.forEach(function(name,i){if(name)mapped[name]=cells[i]===undefined?'':cells[i];});
          return mapped;
        });
        candidates.push({sheet:text(sheet.name),headerRow:index+1,header:header,rows:rows});
      });
    });
    if(candidates.length>1)throw new Error('AMBIGUOUS_TABLE: '+required.join(', '));
    return candidates.length?candidates[0]:null;
  }
  function fromSheets(sheets, options) {
    if(!Array.isArray(sheets))throw new Error('INVALID_SHEETS');
    var priceMap=findTable(sheets,['RD-Code','Price Tiers (Raw)']);
    if(!priceMap)throw new Error('ไม่พบตารางจับคู่ราคา: RD-Code, Price Tiers (Raw)');
    var catalog=findTable(sheets,['RD-Code','Ingredient Name']);
    var offered=findTable(sheets,['Offered Ingredient','Lead Time']);
    var result=build({catalog:catalog?catalog.rows:[],priceMap:priceMap.rows,offered:offered?offered.rows:[]},options);
    function info(table){return table?{sheet:table.sheet,headerRow:table.headerRow,rowCount:table.rows.length}:null;}
    result.tables={priceMap:info(priceMap),catalog:info(catalog),offered:info(offered)};
    return result;
  }
  return {build:build, fromSheets:fromSheets, findTable:findTable, leadTimeDays:leadTimeDays};
})();
if (typeof module !== 'undefined') module.exports = RmCatalogBuild;
