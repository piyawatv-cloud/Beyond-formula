'use strict';
// Keep the standalone Apps Script adapters and the single-file browser identical.
// Run after domain edits; the parity test rejects drift. No business rule lives here.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),files=['RmSourceMap.gs','RmCatalogBuild.gs'];
const start='// COST_RM_SOURCE_DOMAIN_START',end='// COST_RM_SOURCE_DOMAIN_END';
function expected(){return start+'\n'+files.map(name=>fs.readFileSync(path.join(root,'cost calculator by project/apps_script',name),'utf8').trim()).join('\n\n')+'\n'+end;}
if(require.main===module){
 const file=path.join(root,'index.html'),html=fs.readFileSync(file,'utf8');
 const block=expected(),pattern=/\/\/ COST_RM_SOURCE_DOMAIN_START[\s\S]*?\/\/ COST_RM_SOURCE_DOMAIN_END/;
 const result=pattern.test(html)?html.replace(pattern,()=>block):html.replace('// COST_CALCULATOR_CORE_START',()=>block+'\n\n// COST_CALCULATOR_CORE_START');
 if(result===html&&!html.includes(block))throw Error('Browser insertion marker missing');
 fs.writeFileSync(file,result);
}
module.exports={expected};
