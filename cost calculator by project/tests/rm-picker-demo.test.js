'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../docs/prototypes/rm-picker.js');
const row=(id,status='AVAILABLE',extra={})=>({id,item:'RM-1',category:'RM',status,qty:8,uom:'kg',spec:'95%',lot:id,...extra});
test('RM prototype only exposes exact AVAILABLE RM rows, including direct selection guard',()=>{
 const rows=[row('yes'),row('hold','HOLD'),row('missing',undefined,{status:null}),row('lower','available'),row('pk','AVAILABLE',{category:'PK'})];
 assert.deepEqual(d.visible(rows).map(r=>r.id),['yes']);
 assert.throws(()=>d.chooseStock(rows,'hold'),/AVAILABLE/);
 assert.equal(d.chooseStock(rows,'yes').id,'yes');
});
test('RM prototype uses onhand as supplied and never subtracts Reserve',()=>{
 assert.equal(d.balance([row('a','AVAILABLE',{reserve:7}),row('b','AVAILABLE',{qty:2})],{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),10);
});
test('RM prototype does not match names, unconfirmed links, incompatible spec or UOM',()=>{
 const rows=[row('a'),row('b','AVAILABLE',{qty:500,uom:'g'}),row('c','AVAILABLE',{qty:99,spec:'98%'})];
 assert.equal(d.balance(rows,null),null);
 assert.equal(d.balance(rows,{item:'RM-1',spec:'95%',uom:'kg',confirmed:false}),null);
 assert.equal(d.balance(rows,{item:'RM-1',spec:'95%',uom:'kg',confirmed:true}),8);
});
test('RM prototype unknown quantities remain unknown; unavailable lots contribute nothing',()=>{
 const link={item:'RM-1',spec:'95%',uom:'kg',confirmed:true};
 assert.equal(d.balance([row('a','HOLD')],link),0);
 assert.equal(d.balance([row('a','AVAILABLE',{qty:null})],link),null);
 assert.equal(d.balance([row('a','AVAILABLE',{qty:-1})],link),null);
});
