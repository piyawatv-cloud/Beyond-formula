'use strict';
// Test harness only: original handoff functions, synthetic DOM and reference data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.FORMULA_LEGACY_PAGE||path.resolve(__dirname,'../../_IT-handoff/formula-studio/app/index.html'),'utf8');
const a=source.indexOf('function checkFDA('),b=source.indexOf('// ========== STATE',a);
const c=source.indexOf('function getRows() {'),d=source.indexOf('// ========== GENERATE DASHBOARD',c);
if(a<0||b<=a||c<0||d<=c)throw Error('legacy calculator unavailable');
function derive(rows){
 const elements=rows.map(r=>({querySelectorAll:q=>q==='input'?[{value:r.name},{},{value:r.o},{},{value:r.note}]:[{value:String(r.w)},{value:String(r.p)}],querySelector:()=>({classList:{contains:()=>r.hero}})}));
 const context={document:{querySelectorAll:()=>elements},THAI_FDA_DB:[{keywords:['Synthetic'],name:'synthetic fixture',maxActualMg:55,unit:'mg',status:'fixture',ref:'fixture only',overNote:'fixture only'}]};
 vm.createContext(context);vm.runInContext(source.slice(a,b)+'\n'+source.slice(c,d),context);return JSON.parse(JSON.stringify(context.getRows()));
}
module.exports={derive};
