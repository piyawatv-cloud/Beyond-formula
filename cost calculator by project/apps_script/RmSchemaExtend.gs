// RmSchemaExtend — แทรกสามคอลัมน์ที่เครื่องคำนวณต้องใช้แต่ต้นทางยังไม่มี
//
//   ขนาดสั่งเพิ่ม (Order Increment) · วันหมดอายุราคา (Price Valid Until) · การรับรอง spec (Spec Approved)
//
// เจ้าของระบบสั่งให้แทรก 2026-09-05 · **ให้คนเป็นผู้รัน ไม่ใช่ agent**
//   1. previewSchemaExtend() ไม่เขียนอะไร บอกว่าจะเพิ่มคอลัมน์ไหนที่ตำแหน่งใด
//   2. applySchemaExtend()   เพิ่มคอลัมน์ต่อท้าย พร้อมหัวตารางและ data validation
//
// ต่อท้ายเสมอ ไม่แทรกกลาง เพื่อไม่ให้ index ของคอลัมน์เดิมขยับ ซึ่งจะทำให้สูตรและ
// สคริปต์ที่อ้างตำแหน่งคอลัมน์พังทั้งไฟล์
var RmSchemaExtend = (function () {
  'use strict';
  var COLUMNS = [
    {header:'Order Increment (kg)', note:'ขนาดที่สั่งเพิ่มได้ทีละ เช่น 1 หรือ 25 — ต้องมากกว่า 0', kind:'number'},
    {header:'Price Valid Until',    note:'ราคามีผลถึงวันไหน รูปแบบ YYYY-MM-DD',                   kind:'date'},
    {header:'Spec Approved',        note:'RD รับรอง spec แล้วหรือยัง',                            kind:'boolean'}
  ];
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function headerRow(values, mustHave) {
    for (var r = 0; r < Math.min(values.length, 30); r++) {
      var row = values[r].map(text);
      var ok = true;
      for (var i = 0; i < mustHave.length; i++) if (row.indexOf(mustHave[i]) < 0) ok = false;
      if (ok) return {row:r, cells:row};
    }
    return null;
  }
  function plan(sheet, mustHave) {
    var values = sheet.getDataRange().getValues();
    var head = headerRow(values, mustHave || ['RD-Code']);
    if (!head) throw new Error('ไม่พบหัวตารางที่คาดไว้ในแท็บนี้');
    var existing = head.cells, additions = [], present = [];
    var nextCol = existing.length;
    COLUMNS.forEach(function (col) {
      if (existing.indexOf(col.header) >= 0) { present.push(col.header); return; }
      nextCol += 1;
      additions.push({header:col.header, note:col.note, kind:col.kind, column:nextCol});
    });
    return {headerRow:head.row + 1, existingColumns:existing.length,
      additions:additions, alreadyPresent:present, dataRows:values.length - head.row - 1};
  }
  function report(result) {
    var lines = ['หัวตารางอยู่แถว ' + result.headerRow + ' · มี ' + result.existingColumns + ' คอลัมน์ · ข้อมูล ' + result.dataRows + ' แถว'];
    if (result.alreadyPresent.length) lines.push('  มีอยู่แล้ว ไม่เพิ่มซ้ำ: ' + result.alreadyPresent.join(', '));
    if (!result.additions.length) lines.push('  ไม่มีอะไรต้องเพิ่ม');
    result.additions.forEach(function (a) {
      lines.push('  เพิ่มคอลัมน์ที่ ' + a.column + ': "' + a.header + '"  — ' + a.note);
    });
    return lines.join('\n');
  }
  function apply(sheet, mustHave) {
    var result = plan(sheet, mustHave);
    if (!result.additions.length) return 'ไม่มีอะไรต้องเพิ่ม\n' + report(result);
    result.additions.forEach(function (a) {
      // ต่อท้ายเท่านั้น คอลัมน์เดิมไม่ขยับ
      if (sheet.getMaxColumns() < a.column) sheet.insertColumnsAfter(sheet.getMaxColumns(), a.column - sheet.getMaxColumns());
      var headerCell = sheet.getRange(result.headerRow, a.column);
      headerCell.setValue(a.header);
      headerCell.setNote(a.note);
      if (result.dataRows > 0) {
        var body = sheet.getRange(result.headerRow + 1, a.column, result.dataRows, 1);
        // ช่วยกันกรอกผิดตั้งแต่ต้นทาง แต่ไม่เติมค่าให้ — ค่าว่างแปลว่ายังไม่มีข้อมูล
        if (a.kind === 'boolean') {
          body.setDataValidation(SpreadsheetApp.newDataValidation()
            .requireValueInList(['TRUE', 'FALSE'], true).setAllowInvalid(false).build());
        } else if (a.kind === 'date') {
          body.setNumberFormat('yyyy-mm-dd');
          body.setDataValidation(SpreadsheetApp.newDataValidation()
            .requireDate().setAllowInvalid(false).build());
        } else {
          body.setDataValidation(SpreadsheetApp.newDataValidation()
            .requireNumberGreaterThan(0).setAllowInvalid(false).build());
        }
      }
    });
    SpreadsheetApp.flush();
    return 'เพิ่มแล้ว ' + result.additions.length + ' คอลัมน์ · ยังไม่มีค่าในช่อง ต้องกรอกเอง\n' + report(result);
  }
  return {plan:plan, report:report, apply:apply, COLUMNS:COLUMNS};
})();

// ---- ฟังก์ชันที่คนกดรัน ----
var RM_SCHEMA_SHEET_NAME = 'ตั้งชื่อแท็บจับคู่ราคาที่นี่';
function previewSchemaExtend() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RM_SCHEMA_SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบแท็บ ' + RM_SCHEMA_SHEET_NAME);
  var t = 'ทดลองเท่านั้น ยังไม่เขียนอะไร\n' + RmSchemaExtend.report(RmSchemaExtend.plan(sheet));
  Logger.log(t); return t;
}
function applySchemaExtend() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RM_SCHEMA_SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบแท็บ ' + RM_SCHEMA_SHEET_NAME);
  var t = RmSchemaExtend.apply(sheet);
  Logger.log(t); return t;
}
if (typeof module !== 'undefined') module.exports = RmSchemaExtend;
