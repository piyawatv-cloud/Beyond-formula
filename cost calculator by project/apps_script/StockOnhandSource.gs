// StockOnhandSource — อ่านชีต Stock onhand ของ Stock Inventory เข้าสู่ calculator
// เจ้าของระบบสั่งต่อสายตรง 2026-09-09 · โดเมนเดียวใช้ร่วมทั้ง Apps Script และเบราว์เซอร์
//
// ข้อยืนยันของเจ้าของที่โค้ดนี้ต้องรักษา
//   1. อ่าน "คงเหลือ" ตรง ๆ ห้ามหัก Reserve ซ้ำ (workflow ปัจจุบันตัดออกไปแล้ว)
//   2. เห็นและเลือกใช้ได้เฉพาะ status = AVAILABLE
//   3. ยอดที่อ่านไม่ได้ต้องเป็น "ไม่ทราบ" (null) ห้ามกลายเป็นศูนย์ เพราะศูนย์แปลว่าของหมด
//   4. ผูกกับข้อเสนอด้วย reference item/spec/UOM ที่ยืนยันแล้วเท่านั้น ห้ามเดาจากชื่อคล้ายกัน
//   5. มี stock ไม่เท่ากับจองของได้ และไม่ใช่ฐานราคา
var StockOnhandSource = (function () {
  'use strict';
  // สถานะเดียวที่นับเป็นของที่ใช้ได้ · ค่าอื่นถูกกันออกพร้อมนับจำนวนไว้ ไม่หายเงียบ
  var AVAILABLE = 'AVAILABLE';
  // หัวคอลัมน์ที่ยืนยันแล้วอยู่ใน REGISTRY (UOM · คงเหลือ · Location · status)
  // ชื่ออื่นเป็นทางเลือกสำรองของหัวตารางที่พบในชีตชุดเดียวกัน ไม่ใช่การเดาความหมายใหม่
  var COLUMNS = {
    item:     ['New Code', 'Item Code', 'Code', 'รหัสสินค้า', 'รหัส'],
    oldItem:  ['Old Code', 'รหัสเดิม'],
    name:     ['Trade name', 'Item Name', 'Description', 'ชื่อสินค้า', 'ชื่อ'],
    spec:     ['Spec', 'Specification', 'สเปก', 'สเปค'],
    qty:      ['คงเหลือ', 'On Hand', 'Onhand', 'Balance', 'Qty'],
    uom:      ['UOM', 'Unit', 'หน่วย'],
    status:   ['status', 'Status', 'สถานะ'],
    location: ['Location', 'Loc', 'ที่จัดเก็บ'],
    lot:      ['Lot', 'Lot No', 'ล็อต'],
    expiry:   ['Exp. date', 'Expiry', 'Exp', 'วันหมดอายุ'],
    category: ['Category', 'หมวด', 'ประเภท']
  };
  // ขาดคอลัมน์เหล่านี้ = อ่านไม่ได้เลย ต้องล้มพร้อมบอกชื่อ ไม่ใช่คืนรายการว่างให้เข้าใจผิดว่าไม่มีของ
  var REQUIRED = ['item', 'qty', 'uom', 'status'];

  function text(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function norm(v) { return text(v).toLowerCase().replace(/\s+/g, ' '); }
  // ยอมรับ 1,234.5 และ "12 kg" ไม่ได้ (หน่วยอยู่คนละคอลัมน์) · ว่าง/อ่านไม่ออก = null ไม่ใช่ 0
  function quantity(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : null;
    var s = text(v).replace(/,/g, '');
    if (!s) return null;
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function findHeader(headerRow) {
    var map = {}, seen = {};
    headerRow.forEach(function (cell, index) {
      var key = norm(cell);
      if (key && seen[key] === undefined) seen[key] = index;
    });
    Object.keys(COLUMNS).forEach(function (field) {
      for (var i = 0; i < COLUMNS[field].length; i++) {
        var at = seen[norm(COLUMNS[field][i])];
        if (at !== undefined) { map[field] = at; return; }
      }
    });
    var missing = REQUIRED.filter(function (f) { return map[f] === undefined; });
    if (missing.length) throw new Error('ชีต Stock onhand ขาดคอลัมน์: ' + missing.map(function (f) { return COLUMNS[f][0]; }).join(' · '));
    return map;
  }
  // grid = ทั้งชีตรวมหัวตาราง · options.readAt = เวลาที่อ่านต้นทางจริง (บังคับ ห้ามให้โดเมนตั้งเอง)
  function read(grid, options) {
    var opts = options || {};
    var readAt = text(opts.readAt);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(readAt) || isNaN(new Date(readAt).getTime()))
      throw new Error('ต้องระบุเวลาที่อ่านต้นทาง (readAt) แบบ ISO — ห้ามกำหนดความสดของข้อมูลขึ้นเอง');
    var rows = Array.isArray(grid) ? grid : [];
    var headerAt = -1;
    for (var r = 0; r < rows.length; r++) {
      var cells = (rows[r] || []).map(text);
      if (!cells.join('')) continue;
      try { findHeader(cells); headerAt = r; break; } catch (e) { /* ยังไม่ใช่แถวหัวตาราง */ }
    }
    if (headerAt < 0) findHeader((rows[0] || []).map(text)); // โยนข้อความที่บอกว่าขาดคอลัมน์อะไร
    var map = findHeader((rows[headerAt] || []).map(text));
    var cell = function (row, field) { return map[field] === undefined ? '' : text(row[map[field]]); };
    var lots = [], skipped = [], statuses = {}, known = [];
    rows.slice(headerAt + 1).forEach(function (raw, index) {
      var row = raw || [], sheetRow = headerAt + 2 + index;
      var item = cell(row, 'item');
      if (!item && !row.filter(function (v) { return text(v); }).length) return; // แถวว่างสนิท
      if (!item) { skipped.push({ row: sheetRow, reason: 'ไม่มีรหัสสินค้า' }); return; }
      var seenKey = [item, cell(row, 'spec'), cell(row, 'uom')].join('|');
      if (known.indexOf(seenKey) < 0) known.push(seenKey);
      var status = cell(row, 'status');
      statuses[status || '(ว่าง)'] = (statuses[status || '(ว่าง)'] || 0) + 1;
      if (status.toUpperCase() !== AVAILABLE) { skipped.push({ row: sheetRow, reason: 'สถานะ ' + (status || 'ว่าง') + ' ไม่ใช่ ' + AVAILABLE }); return; }
      var uom = cell(row, 'uom');
      if (!uom) { skipped.push({ row: sheetRow, reason: 'ไม่มีหน่วย' }); return; }
      var lot = cell(row, 'lot'), location = cell(row, 'location');
      lots.push({
        // คีย์ประกอบจากคอลัมน์ที่มีจริงในแถวนี้ · sourceRow ไว้ให้ไล่กลับไปที่ชีตได้
        id: [item, cell(row, 'spec'), uom, lot, location].join('|'),
        item: item, oldItem: cell(row, 'oldItem'), name: cell(row, 'name'),
        spec: cell(row, 'spec'), uom: uom, lot: lot, location: location,
        expiry: cell(row, 'expiry'), status: AVAILABLE,
        // ถ้าชีตไม่มีคอลัมน์หมวด ต้องเป็น null ห้ามเดาว่าเป็น RM
        category: map.category === undefined ? null : cell(row, 'category') || null,
        qty: quantity(row[map.qty]),
        sourceRow: sheetRow
      });
    });
    // คีย์ซ้ำ = แยกสองแถวออกจากกันไม่ได้ ต้องบอก ไม่ใช่รวมยอดเงียบ ๆ
    var seen = {}, duplicates = [];
    lots.forEach(function (l) { if (seen[l.id]) duplicates.push({ rows: [seen[l.id], l.sourceRow], id: l.id }); else seen[l.id] = l.sourceRow; });
    return {
      lots: lots, skipped: skipped, duplicates: duplicates, readAt: readAt,
      // ทุกรายการที่ชีตรู้จัก ไม่ว่าสถานะใด — ให้ผู้เรียกแยก "ของหมด" ออกจาก "ยังไม่เชื่อมคลัง" ได้
      known: known,
      summary: {
        rows: Math.max(0, rows.length - headerAt - 1), available: lots.length, skipped: skipped.length,
        unknownQuantity: lots.filter(function (l) { return l.qty === null; }).length,
        duplicates: duplicates.length, statuses: statuses, headerRow: headerAt + 1
      }
    };
  }
  function refKey(r) { return [text(r.item), text(r.spec), text(r.uom)].join('|'); }
  // ยอดของ reference ที่ยืนยันแล้วหนึ่งรายการ
  //   null = ยังชี้ไม่ถึงรายการคลังใดเลย (mapping ยังไม่ครบ) หรือมียอดที่อ่านไม่ได้
  //   0    = มีรายการนั้นในคลังจริง แต่ไม่มี lot ที่ AVAILABLE
  // options.known = คีย์ item|spec|uom ทุกรายการที่พบในชีตไม่ว่าสถานะใด ใช้แยกสองกรณีข้างบน
  function balance(lots, link, options) {
    if (!link || link.confirmed !== true) return null;
    var key = refKey(link), rows = lots || [];
    var known = options && options.known ? options.known : rows.map(refKey);
    if (known.indexOf(key) < 0) return null;
    var matched = rows.filter(function (l) { return refKey(l) === key; });
    if (matched.some(function (l) { return typeof l.qty !== 'number' || !isFinite(l.qty) || l.qty < 0; })) return null;
    return matched.reduce(function (total, l) { return total + l.qty; }, 0);
  }
  // ---- ทางเข้าฝั่ง Apps Script (API) ----
  // ไม่ฝัง id/ชื่อแท็บในโค้ด · อ่านจาก Script Properties ที่ผู้ดูแลตั้งไว้ ไม่มีค่า = ล้มพร้อมบอก
  function readFromSheet(config) {
    if (typeof SpreadsheetApp === 'undefined') throw new Error('readFromSheet ใช้ได้เฉพาะฝั่ง Apps Script');
    var cfg = config || {};
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var id = cfg.spreadsheetId || (props && props.getProperty('STOCK_ONHAND_SHEET_ID'));
    var tab = cfg.tabName || (props && props.getProperty('STOCK_ONHAND_TAB')) || 'Stock onhand';
    if (!id) throw new Error('ยังไม่ได้ตั้ง STOCK_ONHAND_SHEET_ID — ต้องให้ผู้ดูแลตั้งค่าก่อน ไม่ฝังรหัสไฟล์ในโค้ด');
    var sheet = SpreadsheetApp.openById(id).getSheetByName(tab);
    if (!sheet) throw new Error('ไม่พบแท็บ ' + tab + ' ในไฟล์ที่ตั้งค่าไว้');
    return read(sheet.getDataRange().getValues(), { readAt: new Date().toISOString() });
  }
  return { read: read, balance: balance, refKey: refKey, readFromSheet: readFromSheet, COLUMNS: COLUMNS, REQUIRED: REQUIRED, AVAILABLE: AVAILABLE };
})();
if (typeof module !== 'undefined') module.exports = StockOnhandSource;
