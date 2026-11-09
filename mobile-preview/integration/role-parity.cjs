'use strict';
// Diagnostic only: compares local synthetic UI to an unverified handoff snapshot.
// Never grants permissions or contacts a service.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const legacy=fs.readFileSync(path.join(root,'_IT-handoff/formula-studio/app/index.html'),'utf8');
const preview=fs.readFileSync(path.join(root,'mobile-preview/index.html'),'utf8');
const declaration=legacy.match(/const ROLES = (\{[\s\S]*?\n\});\nconst ROLE_KEYS/);
const model=preview.match(/<script id="model">([\s\S]*?)<\/script>/);
if(!declaration||!model)throw Error('role definitions not found');
const old=vm.runInNewContext('('+declaration[1]+')');
const sandbox={module:{exports:{}}};vm.runInNewContext(model[1]+'\nmodule.exports.__roles=roles;',sandbox);
const mobile=sandbox.module.exports.__roles;
const permissions=[['createData','create'],['editFormula','formula'],['chat','chat'],['export','export'],['closeJob','close'],['ownOnly','own']];
const parts=['pd','ra','rd','sales'];
const oldApproves=(permission,part)=>permission==='*'||Array.isArray(permission)&&permission.includes(part);
const mobileApproves=(permission,part)=>permission==='all'||permission===part;
const gaps=[];
for(const role of [...new Set([...Object.keys(old),...Object.keys(mobile)])].sort()){
 if(!old[role]||!mobile[role]){gaps.push(`${role}: ${!mobile[role]?'missing from mobile':'missing from handoff'}`);continue}
 const a=old[role].can,b=mobile[role];
 for(const [legacyKey,mobileKey] of permissions)if(Boolean(a[legacyKey])!==Boolean(b[mobileKey]))gaps.push(`${role}.${legacyKey}: handoff=${Boolean(a[legacyKey])} mobile=${Boolean(b[mobileKey])}`);
 for(const part of parts)if(oldApproves(a.approve,part)!==mobileApproves(b.approve,part))gaps.push(`${role}.approve.${part}: handoff=${oldApproves(a.approve,part)} mobile=${mobileApproves(b.approve,part)}`);
}
if(gaps.length){console.log('ROLE PARITY NOT MET (snapshot only):');gaps.forEach(gap=>console.log('- '+gap));process.exitCode=1}
else console.log('PASS: displayed role capabilities match local handoff snapshot');
console.log('LIMIT: local UI declarations only; no identity, per-user scope, gateway or production access tested');
