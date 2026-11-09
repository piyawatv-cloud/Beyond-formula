'use strict';
// Compare existing source functions with synthetic input; no regulatory assertion.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const model=fs.readFileSync(path.join(root,'mobile-preview/index.html'),'utf8').match(/<script id="model">([\s\S]*?)<\/script>/)[1];
const mobile={module:{exports:{}}};vm.createContext(mobile);vm.runInContext(model,mobile);
function readLegacy(file,purity){
 const source=fs.readFileSync(file,'utf8');const start=source.indexOf('function getRows() {'),end=source.indexOf('// ========== GENERATE DASHBOARD',start);
 assert.ok(start>=0&&end>start,'legacy function not found');
 const inputs=[{value:'สารสมมติ'}, {}, {value:'ต้นทางสมมติ'}, {}, {value:'หมายเหตุ'}],numbers=[{value:'100'},{value:purity}];
 const row={querySelectorAll:selector=>selector==='input'?inputs:numbers,querySelector:()=>({classList:{contains:()=>false}})};
 const ctx={document:{querySelectorAll:()=>[row]},checkFDA:()=>({status:'synthetic'})};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return ctx.getRows()[0];
}
for(const file of [path.join(root,'index.html'),path.join(root,'_IT-handoff/formula-studio/app/index.html')]){
 for(const [purity,legacy,preview] of [['50',50,50],['0',100,0],['',100,null]]){
  const row=readLegacy(file,purity);assert.equal(row.actual,legacy);assert.equal(mobile.module.exports.ingredientActual('100',purity),preview);
 }
}
console.log('PASS: synthetic comparison reproduces purity 0 and blank differences in both local legacy copies');
console.log('LIMIT: simulated DOM and stubbed FDA; deployed baseline, business rule and regulatory status remain unverified');
