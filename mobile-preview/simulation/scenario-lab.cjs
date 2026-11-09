'use strict';
// Test-only bridge from the existing preview model to an injected transport.
// Roles are fixtures, not authenticated identities. State and deduplication are in memory.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createLab}=require('./push-lab.cjs');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const model=source.match(/<script id="model">([\s\S]*?)<\/script>/);
if(!model)throw Error('preview model missing');
const context={module:{exports:{}},Date};vm.runInNewContext(model[1],context);
const m=context.module.exports;
function createScenario(transport){
 const state=m.initialState(),events=new Map(),lab=createLab(transport);
 function register(device){
  if(!device||!m.can(device.user,'chat'))throw Error('unknown fixture user');
  lab.register({id:device.id,user:device.user,allowedJobs:m.visible(state,device.user).map(j=>j.id)});
 }
 async function perform(input){
  if(!input||typeof input.id!=='string'||!input.id||typeof input.actor!=='string'||typeof input.jobId!=='string'||!['chat','update'].includes(input.kind)||typeof input.text!=='string'||!input.text.trim())throw Error('invalid test event');
  const fingerprint=JSON.stringify([input.actor,input.jobId,input.kind,input.text]);const previous=events.get(input.id);
  if(previous&&previous.fingerprint!==fingerprint)throw Error('event ID conflict');
  if(!previous){
   if(input.kind==='chat')m.send(state,input.actor,input.jobId,input.text);else m.edit(state,input.actor,input.jobId,{notes:input.text});
   events.set(input.id,{fingerprint});
  }
  return lab.deliver({id:input.id,actor:input.actor,jobId:input.jobId,kind:input.kind});
 }
 return {state,register,revoke:lab.revoke,perform};
}
module.exports={createScenario};
