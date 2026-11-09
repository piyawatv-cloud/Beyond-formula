'use strict';
// Executes the handoff renderer against synthetic records. No network or database.
const assert=require('node:assert/strict');
const {renderRecord,sentinel}=require('./legacy-render-fixture.cjs');
const {prepareSave}=require('./runtime-job-save.js');
const data=row=>prepareSave({id:'A00001',baseline:null,changes:{customer:'Synthetic',rows:[row],allConcepts:[],allBenefits:[],allSP:[],cons:[]}}).p_data;
const fda={cls:'synthetic',icon:'?',tip:'synthetic'};
const render=row=>renderRecord(data(row));
assert.throws(()=>render({name:'synthetic',w:'100',p:'50',actual:50}),/fda|cls/,'missing FDA object must not look compatible');
assert.throws(()=>render({name:'synthetic',w:'100',p:'50',actual:50,fda}),/toFixed/,'numeric text must not look compatible');
assert.throws(()=>render({name:'synthetic',w:100,p:50,actual:null,fda}),/toFixed/,'missing calculated amount must not look compatible');
assert.throws(()=>render({name:'synthetic',w:100,p:50,actual:50,fda}),new RegExp(sentinel),'valid synthetic row reaches the legacy table');
console.log('PASS: original handoff renderer exposes three mobile row incompatibilities with synthetic records');
console.log('LIMIT: renderer fragment only; no complete workflow or production baseline confirmed');
