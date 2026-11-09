'use strict';
// Synthetic data only. Calls unmodified functions from each local legacy copy.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {renderRecord,sentinel}=require('./legacy-render-fixture.cjs');
const root=path.resolve(__dirname,'../..');
function makeLegacy(file){
 const source=fs.readFileSync(file,'utf8');
 const fa=source.indexOf('function checkFDA('),fb=source.indexOf('// ========== STATE',fa);
 const ra=source.indexOf('function getRows() {'),rb=source.indexOf('// ========== GENERATE DASHBOARD',ra);
 assert.ok(fa>=0&&fb>fa&&ra>=0&&rb>ra,'legacy functions found');
 let w='100',p='50',name='TEST_SYNTHETIC';
 const inputs=[{get value(){return name}},{},{value:'synthetic'}, {},{value:''}];
 const numbers=[{get value(){return w}},{get value(){return p}}];
 const row={querySelectorAll:q=>q==='input'?inputs:numbers,querySelector:()=>({classList:{contains:()=>false}})};
 const context={document:{querySelectorAll:()=>[row]},THAI_FDA_DB:[{keywords:['TEST_SYNTHETIC'],name:'synthetic fixture',maxActualMg:55,unit:'mg',status:'synthetic',ref:'fixture only',overNote:'fixture only'}]};
 vm.createContext(context);vm.runInContext(source.slice(fa,fb)+'\n'+source.slice(ra,rb),context);
 return {run:()=>JSON.parse(JSON.stringify(context.getRows()[0])),setWeight:value=>{w=value},setName:value=>{name=value}};
}
for(const file of [path.join(root,'index.html'),path.join(root,'_IT-handoff/formula-studio/app/index.html')]){
 const legacy=makeLegacy(file),before=legacy.run();assert.equal(before.w,100);assert.equal(before.actual,50);assert.equal(before.fda.status,'ok');
 legacy.setWeight('120');const after=legacy.run();assert.equal(after.w,120);assert.equal(after.actual,60);assert.equal(after.fda.status,'over');
 assert.throws(()=>renderRecord({id:'A00001',customer:'Synthetic',rows:[after],allConcepts:[],allBenefits:[],allSP:[],cons:[]}),new RegExp(sentinel));
 legacy.setName('not-in-fixture');assert.equal(legacy.run().fda.status,'unknown');
}
console.log('PASS: both local legacy copies derive numeric rows and synthetic status together and reach the handoff table');
console.log('LIMIT: mock DOM and mock reference list; this is not an FDA result or a deployed baseline');
