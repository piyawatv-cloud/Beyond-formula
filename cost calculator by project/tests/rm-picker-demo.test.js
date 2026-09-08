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

const offer=(id='A',spec='95%')=>({id,name:'Synthetic',spec,link:{item:'RM-1',spec,uom:'kg',confirmed:true}});
test('multi RM keeps separate materials and merges same material lots without replacing price',()=>{
 const lines=[];const a=d.add(lines,'rd',offer());a.quantity='12';d.add(lines,'stock',row('L1'));d.add(lines,'stock',row('L2'));d.add(lines,'stock',row('L2'));d.add(lines,'rd',offer('B'));
 assert.equal(lines.length,1);assert.equal(a.quantity,'12');assert.equal(a.row.id,'A');assert.equal(a.lots.length,2);
 d.add(lines,'rd',offer('C','98%'));assert.equal(lines.length,2);
 d.add(lines,'rd',{id:'NEW',name:'Synthetic',spec:'95%'});assert.equal(lines.length,3);
});
test('multi RM explicit replacement preserves quantity and rejects different spec',()=>{
 const lines=[],a=d.add(lines,'rd',offer());a.quantity='3';d.replace(a,offer('B'));assert.equal(a.row.id,'B');assert.equal(a.quantity,'3');assert.throws(()=>d.replace(a,offer('C','98%')),/spec/);
});
test('multi RM revision is one immutable copy of the whole draft even after removal',()=>{
 const lines=[],revs=[];const a=d.add(lines,'rd',offer());a.quantity='3';d.add(lines,'rd',offer('C','98%'));const first=d.snapshot(lines,revs);
 a.quantity='4';d.replace(a,offer('B'));lines.pop();const second=d.snapshot(lines,revs);
 assert.equal(first.lines.length,2);assert.equal(first.lines[0].quantity,'3');assert.equal(first.lines[0].row.id,'A');assert.equal(second.revision,2);assert.equal(second.lines.length,1);assert.throws(()=>d.snapshot([],revs),/RM/);
});
