'use strict';
// Minimal synthetic DOM, loads the actual renderer from the unverified handoff.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(process.env.FORMULA_LEGACY_PAGE||path.resolve(__dirname,'../../_IT-handoff/formula-studio/app/index.html'),'utf8');
const start=html.indexOf('function renderDashboard(d){');
const end=html.indexOf('// ========== USER SYSTEM',start);
if(start<0||end<=start)throw Error('handoff renderer was not found');
const sentinel='fixture reached formula row append';
function renderRecord(record){
 const elements=new Map();
 const element=()=>({textContent:'',innerHTML:'',className:'',appendChild(){throw Error(sentinel)}});
 const context={document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement(){return element()}},oseaCls:()=>'',fmtSize:()=>'',fmtUW:()=>'',esc:String,jobWarningHTML:()=>''};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 return context.renderDashboard(record);
}
module.exports={renderRecord,sentinel};
