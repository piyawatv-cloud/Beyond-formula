// Exports reference data + golden test vectors from the WEB app (index.html = source of truth).
//   node tools/export-web-data.mjs          write app/src/main/assets/web_data.json and test golden file
//   node tools/export-web-data.mjs --check  exit 1 if either file differs from what the web would produce
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const html = fs.readFileSync(path.resolve(root, '../../index.html'), 'utf8');

function slice(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  if (s < 0) throw new Error('marker not found: ' + startMarker);
  const e = html.indexOf(endMarker, s);
  if (e < 0) throw new Error('end not found for: ' + startMarker);
  return html.slice(s, e + endMarker.length);
}
const evalConst = (name, src) => new Function(src.replace(new RegExp('^const ' + name + ' = '), 'return ').replace(/;\s*$/, ';'))();

const fdaSrc = slice('const THAI_FDA_DB = [', '\n];');
const idbSrc = slice('const IDB = {', '\n};');
const kbSrc = slice('const CONCEPT_KB = {', '\n};');
const checkSrc = slice('function checkFDA(', '\n}\n');

const THAI_FDA_DB = evalConst('THAI_FDA_DB', fdaSrc);
const IDB = evalConst('IDB', idbSrc);
const CONCEPT_KB = evalConst('CONCEPT_KB', kbSrc);
const checkFDA = new Function('THAI_FDA_DB', checkSrc + '\nreturn checkFDA;')(THAI_FDA_DB);

const data = { fda: THAI_FDA_DB, idb: IDB, kb: CONCEPT_KB };

// golden vectors: real checkFDA output for every keyword at several amounts + unknown names
const fdaCases = [];
for (const e of THAI_FDA_DB) {
  const amounts = [0.5, e.maxActualMg, e.maxActualMg * 1.5 + 0.25];   // below / at / above the limit
  e.keywords.forEach((kw, i) => amounts.forEach(a => {
    fdaCases.push({ name: kw, mg: a, out: checkFDA(kw, a) });
    if (i === 0) {                                   // case-insensitive + substring match, first keyword only
      fdaCases.push({ name: kw.toUpperCase(), mg: a, out: checkFDA(kw.toUpperCase(), a) });
      fdaCases.push({ name: 'x ' + kw + ' y', mg: a, out: checkFDA('x ' + kw + ' y', a) });
    }
  }));
}
['', 'zzz-not-an-ingredient', 'น้ำเปล่า'].forEach(n => fdaCases.push({ name: n, mg: 10, out: checkFDA(n, 10) }));

// golden vectors for the generateDash concept logic (web lines: allBenefits/allSP/suggestedTarget/defaults)
function derive(allConcepts, claims, target) {
  let allBenefits = [], allSP = [], suggested = '';
  allConcepts.forEach(c => { const kb = CONCEPT_KB[c]; if (kb) { allBenefits.push(...kb.benefits); allSP.push(...kb.sp); if (!suggested) suggested = kb.target; } });
  claims.forEach(c => { if (!allBenefits.includes(c)) allBenefits.push(c); });
  if (allBenefits.length === 0) allBenefits = ['เสริมสุขภาพโดยรวม', 'ต้านอนุมูลอิสระ', 'บำรุงร่างกาย'];
  if (allSP.length === 0) allSP = ['สูตร Premium Grade', 'คัดสรรวัตถุดิบคุณภาพ', 'ผ่านมาตรฐาน GMP'];
  return { allBenefits, allSP, finalTarget: target || suggested || 'ผู้ใหญ่ทุกเพศ อายุ 18 ปีขึ้นไป' };
}
const ks = Object.keys(CONCEPT_KB);
const deriveCases = [];
const combos = [[], ['custom-only'], ...ks.map(k => [k]), [ks[0], ks[1]], [ks[1], ks[0], 'custom']];
for (const concepts of combos) for (const claims of [[], ['ข้อความของฉัน'], [CONCEPT_KB[ks[0]].benefits[0]]]) for (const target of ['', 'กลุ่มที่พิมพ์เอง'])
  deriveCases.push({ concepts, claims, target, out: derive(concepts, claims, target) });

const golden = { fda: fdaCases, derive: deriveCases };
const files = [
  [path.join(root, 'app/src/main/assets/web_data.json'), JSON.stringify(data)],
  [path.join(root, 'app/src/test/resources/web_golden.json'), JSON.stringify(golden)],
];
if (process.argv.includes('--check')) {
  let bad = false;
  for (const [f, text] of files) {
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text) { console.error('OUT OF SYNC with web:', path.relative(root, f)); bad = true; }
  }
  if (bad) { console.error('Run: node tools/export-web-data.mjs  (then re-run tests)'); process.exit(1); }
  console.log('in sync with web index.html');
} else {
  for (const [f, text] of files) fs.writeFileSync(f, text);
  console.log(`fda entries: ${THAI_FDA_DB.length}, idb: ${Object.keys(IDB).length}, concepts: ${ks.length}, fda cases: ${fdaCases.length}, derive cases: ${deriveCases.length}`);
}
