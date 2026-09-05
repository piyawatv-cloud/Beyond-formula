// RmSourceMap — ตัวแปลงข้อความดิบจาก RD Data Center ให้เป็นคู่ MOQ/ราคาที่อ่านได้
//
// แยกจาก RmData โดยตั้งใจ: RmData เป็นกฎของโดเมนที่ไม่ผูกกับแหล่งใด ส่วนไฟล์นี้
// เป็นความรู้เฉพาะรูปแบบการเขียนของแหล่งข้อมูลนี้ ตามที่ RM_IMPLEMENTATION กำหนดว่า
// physical source adapter ต้องเป็นคนแปลง ไม่ใช่ให้ core เดา
//
// กติกาที่เจ้าของระบบยืนยัน 2026-09-05
//   1. MOQ ที่เป็นตัวเลขเปล่า หมายถึงกิโลกรัม
//   2. จุลภาคที่ตามด้วยเลขสามหลักติดกันคือตัวคั่นหลักพัน นอกนั้นคือตัวคั่นรายการ
//      และถ้าตีความเป็นหลักพันแล้วได้ราคาสูงเกินเพดาน ให้ถือว่าเป็นตัวคั่นรายการ
//      ผลลัพธ์เขียนกลับเป็น '/' เพื่อไม่ให้สับสนอีก
//   3. ไม่เลือก Tier ให้เอง — ส่งทุก Tier ต่อไปให้ RD เลือก
var RmSourceMap = (function () {
  'use strict';
  var PRICE_MAX_PER_KG = 100000; // เพดานความน่าจะเป็นที่เจ้าของระบบให้ไว้
  var MASS = {kg:1, g:0.001, mg:0.000001};
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  // จุลภาคหลักพัน = มีตัวเลขติดซ้าย และตามด้วยเลขสามหลักพอดี ไม่มีช่องว่างคั่น
  function splitTokens(raw, treatAllCommasAsList) {
    var s = text(raw);
    if (!treatAllCommasAsList) s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
    return s.split(/\s*[\/,]\s*|\r?\n/).map(function (t) { return t.trim(); }).filter(function (t) { return t !== ''; });
  }
  function numberOf(token) {
    var m = text(token).match(/^([\d.]+)/);
    if (!m) return null;
    var n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // ราคาต่อกิโลที่สูงเกินเพดานแปลว่าตีความจุลภาคผิด
  function implausible(tokens) {
    return tokens.some(function (t) { var n = numberOf(t); return n !== null && n > PRICE_MAX_PER_KG; });
  }
  function normalisePair(rawMoq, rawPrice) {
    var notes = [];
    var moq = splitTokens(rawMoq, false), price = splitTokens(rawPrice, false);
    if (implausible(price) || implausible(moq)) {
      var altMoq = splitTokens(rawMoq, true), altPrice = splitTokens(rawPrice, true);
      if (!implausible(altPrice) && altMoq.length === altPrice.length) {
        moq = altMoq; price = altPrice;
        notes.push('COMMA_READ_AS_LIST_SEPARATOR');
      } else {
        notes.push('PRICE_ABOVE_PLAUSIBLE_CEILING');
      }
    }
    if (moq.length !== price.length) notes.push('TOKEN_COUNT_MISMATCH');
    // MOQ ตัวเลขเปล่า = kg ตามที่เจ้าของระบบยืนยัน แต่บันทึกไว้ว่าเติมหน่วยให้
    var moqOut = moq.map(function (t) {
      if (/^[\d.]+$/.test(t)) { notes.push('BARE_MOQ_ASSUMED_KG'); return t + ' kg'; }
      return t;
    });
    // ช่วง เช่น 1-10 ไม่ใช่ปริมาณสั่งซื้อขั้นต่ำ
    if (moqOut.some(function (t) { return /\d\s*-\s*\d/.test(t); })) notes.push('MOQ_IS_A_RANGE');
    // หน่วยที่ไม่ใช่น้ำหนักยังคิดกับปริมาณในสูตรไม่ได้
    var unitless = moqOut.concat(price).some(function (t) {
      var u = text(t).match(/[A-Za-zก-๙]+\.?$/);
      return !!u && !MASS[u[0].toLowerCase().replace(/\.$/, '')];
    });
    if (unitless) notes.push('NON_MASS_UNIT');
    return {
      moq: moqOut, price: price,
      // ข้อความที่เขียนกลับได้ ใช้ '/' อย่างเดียวเพื่อไม่ให้กำกวมอีก
      normalisedMoq: moqOut.join(' / '), normalisedPrice: price.join(' / '),
      changed: moqOut.join(' / ') !== text(rawMoq) || price.join(' / ') !== text(rawPrice),
      notes: notes.filter(function (n, i, a) { return a.indexOf(n) === i; }),
      // อ่านได้ก็ต่อเมื่อไม่มีข้อสังเกตที่ต้องให้คนตัดสิน
      usable: notes.filter(function (n) { return n !== 'BARE_MOQ_ASSUMED_KG' && n !== 'COMMA_READ_AS_LIST_SEPARATOR'; }).length === 0
    };
  }
  return {normalisePair: normalisePair, PRICE_MAX_PER_KG: PRICE_MAX_PER_KG};
})();
if (typeof module !== 'undefined') module.exports = RmSourceMap;
