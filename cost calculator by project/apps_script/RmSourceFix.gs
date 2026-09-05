// RmSourceFix — ปรับรูปแบบข้อความ MOQ/ราคาใน RD Data Center ให้ใช้ '/' อย่างเดียว
//
// เจ้าของระบบสั่งให้แก้ต้นทาง 2026-09-05 สคริปต์นี้ให้ "คน" เป็นผู้รัน ไม่ใช่ agent
// และออกแบบให้ปลอดภัยตามลำดับนี้
//   1. previewSourceFix() ไม่เขียนอะไรเลย รายงานว่าจะเปลี่ยนแถวไหนบ้าง — รันอันนี้ก่อนเสมอ
//   2. applySourceFix()   สำรองค่าเดิมลงแท็บใหม่ก่อน แล้วจึงเขียนเฉพาะสองคอลัมน์ที่ระบุ
//
// หลักที่ยึด
//   - แตะเฉพาะคอลัมน์ MOQ/ราคาในแท็บที่ระบุ ไม่แตะแท็บอื่น สูตร หรือรูปแบบ
//   - แถวที่ตัวแปลงยังไม่มั่นใจ จะ "ไม่ถูกแตะ" และถูกรายงานให้คนตัดสิน
//   - รันซ้ำได้ ค่าที่ตรงอยู่แล้วจะถูกข้าม จึงไม่เกิดการเขียนซ้ำซ้อน
//   - สำรองค่าเดิมทุกครั้งพร้อมเวลาและผู้รัน ย้อนกลับได้ด้วย restoreFromBackup()
var RmSourceFix = (function () {
  'use strict';
  var MOQ_HEADER = 'MOQ / Qty';
  var PRICE_HEADER = 'Price Tiers (Raw)';
  var BACKUP_PREFIX = '_backup_rawtiers_';

  function findHeaderRow(values) {
    for (var r = 0; r < Math.min(values.length, 30); r++) {
      var row = values[r].map(function (c) { return String(c).trim(); });
      if (row.indexOf(MOQ_HEADER) >= 0 && row.indexOf(PRICE_HEADER) >= 0) {
        return {row:r, moq:row.indexOf(MOQ_HEADER), price:row.indexOf(PRICE_HEADER)};
      }
    }
    return null;
  }
  // คืนรายการการเปลี่ยนแปลงที่ "จะ" เกิดขึ้น โดยไม่เขียนอะไรทั้งสิ้น
  function plan(sheet) {
    var values = sheet.getDataRange().getValues();
    var head = findHeaderRow(values);
    if (!head) throw new Error('ไม่พบหัวคอลัมน์ "' + MOQ_HEADER + '" และ "' + PRICE_HEADER + '" ในแท็บนี้');
    var changes = [], skipped = [], unchanged = 0;
    for (var r = head.row + 1; r < values.length; r++) {
      var rawMoq = String(values[r][head.moq] === null ? '' : values[r][head.moq]).trim();
      var rawPrice = String(values[r][head.price] === null ? '' : values[r][head.price]).trim();
      if (rawMoq === '' && rawPrice === '') continue;
      var mapped = RmSourceMap.normalisePair(rawMoq, rawPrice);
      // ไม่แตะแถวที่ยังตีความไม่ชัด ปล่อยให้คนตัดสิน
      if (!mapped.usable) {
        skipped.push({row:r + 1, moq:rawMoq, price:rawPrice, notes:mapped.notes.join(', ')});
        continue;
      }
      if (mapped.normalisedMoq === rawMoq && mapped.normalisedPrice === rawPrice) { unchanged++; continue; }
      changes.push({row:r + 1, moqFrom:rawMoq, moqTo:mapped.normalisedMoq,
        priceFrom:rawPrice, priceTo:mapped.normalisedPrice, notes:mapped.notes.join(', ')});
    }
    return {header:head, changes:changes, skipped:skipped, unchanged:unchanged, total:values.length - head.row - 1};
  }
  function report(result) {
    var lines = ['ตรวจแล้ว ' + result.total + ' แถว',
      '  จะเปลี่ยนรูปแบบ : ' + result.changes.length,
      '  ตรงอยู่แล้ว     : ' + result.unchanged,
      '  ไม่แตะ (ให้คนดู): ' + result.skipped.length];
    result.changes.slice(0, 20).forEach(function (c) {
      lines.push('  แถว ' + c.row + '  MOQ ' + JSON.stringify(c.moqFrom) + ' -> ' + JSON.stringify(c.moqTo)
        + '  |  ราคา ' + JSON.stringify(c.priceFrom) + ' -> ' + JSON.stringify(c.priceTo));
    });
    if (result.changes.length > 20) lines.push('  … อีก ' + (result.changes.length - 20) + ' แถว');
    result.skipped.slice(0, 20).forEach(function (s) {
      lines.push('  ไม่แตะ แถว ' + s.row + '  (' + s.notes + ')');
    });
    if (result.skipped.length > 20) lines.push('  … ไม่แตะอีก ' + (result.skipped.length - 20) + ' แถว');
    return lines.join('\n');
  }
  function backup(spreadsheet, sheet, result, stamp) {
    var name = BACKUP_PREFIX + stamp;
    if (spreadsheet.getSheetByName(name)) throw new Error('มีแท็บสำรองชื่อ ' + name + ' อยู่แล้ว');
    var target = spreadsheet.insertSheet(name);
    var rows = [['SourceSheet', 'Row', 'MOQ (เดิม)', 'Price Tiers (เดิม)', 'MOQ (ใหม่)', 'Price Tiers (ใหม่)', 'RunAt', 'RunBy']];
    var by = '';
    try { by = Session.getActiveUser().getEmail() || ''; } catch (e) { by = 'identity not available'; }
    result.changes.forEach(function (c) {
      rows.push([sheet.getName(), c.row, c.moqFrom, c.priceFrom, c.moqTo, c.priceTo, stamp, by]);
    });
    target.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    target.hideSheet();
    return target;
  }
  function apply(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error('ไม่พบแท็บ ' + sheetName);
    var result = plan(sheet);
    if (!result.changes.length) return 'ไม่มีอะไรต้องเปลี่ยน\n' + report(result);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
    backup(spreadsheet, sheet, result, stamp);
    // เขียนทีละเซลล์เฉพาะสองคอลัมน์ที่ระบุ ไม่แตะช่วงอื่นเลย
    result.changes.forEach(function (c) {
      sheet.getRange(c.row, result.header.moq + 1).setValue(c.moqTo);
      sheet.getRange(c.row, result.header.price + 1).setValue(c.priceTo);
    });
    SpreadsheetApp.flush();
    return 'แก้แล้ว ' + result.changes.length + ' แถว · สำรองไว้ที่แท็บ ' + BACKUP_PREFIX + stamp + '\n' + report(result);
  }
  function restore(spreadsheet, backupSheetName, sheetName) {
    var backupSheet = spreadsheet.getSheetByName(backupSheetName);
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!backupSheet || !sheet) throw new Error('ไม่พบแท็บสำรองหรือแท็บปลายทาง');
    var values = backupSheet.getDataRange().getValues();
    var head = findHeaderRow(sheet.getDataRange().getValues());
    if (!head) throw new Error('ไม่พบหัวคอลัมน์ในแท็บปลายทาง');
    var restored = 0;
    for (var i = 1; i < values.length; i++) {
      sheet.getRange(values[i][1], head.moq + 1).setValue(values[i][2]);
      sheet.getRange(values[i][1], head.price + 1).setValue(values[i][3]);
      restored++;
    }
    SpreadsheetApp.flush();
    return 'คืนค่าเดิมแล้ว ' + restored + ' แถว';
  }
  return {plan:plan, report:report, apply:apply, restore:restore,
    MOQ_HEADER:MOQ_HEADER, PRICE_HEADER:PRICE_HEADER, BACKUP_PREFIX:BACKUP_PREFIX};
})();

// ---- ฟังก์ชันที่คนกดรันจากเมนู Apps Script ----
// แก้ชื่อแท็บให้ตรงกับแท็บหลักฐานราคา แล้วรัน previewSourceFix ก่อนเสมอ
var RM_FIX_SHEET_NAME = 'ตั้งชื่อแท็บหลักฐานราคาที่นี่';
function previewSourceFix() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RM_FIX_SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบแท็บ ' + RM_FIX_SHEET_NAME + ' — แก้ค่า RM_FIX_SHEET_NAME ก่อน');
  var text = 'ทดลองเท่านั้น ยังไม่เขียนอะไร\n' + RmSourceFix.report(RmSourceFix.plan(sheet));
  Logger.log(text);
  return text;
}
function applySourceFix() {
  var text = RmSourceFix.apply(SpreadsheetApp.getActiveSpreadsheet(), RM_FIX_SHEET_NAME);
  Logger.log(text);
  return text;
}
if (typeof module !== 'undefined') module.exports = RmSourceFix;
