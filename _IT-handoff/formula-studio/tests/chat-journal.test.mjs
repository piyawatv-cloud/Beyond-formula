import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {actualBrowser,browserValue,waitForDocument} from './helpers/chat-journal-browser.mjs';

// These checks run the actual asset against native Chromium transactions. Faults
// are injected at the IDB boundary, retaining native commit/abort/isolation.
test('shared journal native durability and immutable storage contract',async t=>{
 const asset=await readFile(new URL('../runtime/assets/fs-chat-journal.js',import.meta.url),'utf8').catch(()=> '');
 const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/asset.js'?'application/javascript':'text/html');res.end(req.url==='/asset.js'?asset:'<!doctype html><script src="/asset.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await actualBrowser(t,origin);if(!browser)return;
 const run=expression=>browserValue(browser,expression);
 assert.equal(await run('typeof window.__fsChatJournal'),'object','adapter exposes the agreed API');
 const fresh=async()=>{const b=await browser.newPage(origin);return b;};
 await t.test('read-only absent database stays absent and synchronous reads require verification',async()=>{
  assert.equal(await run('(()=>{try{__fsChatJournal.verifiedItems();return false}catch(e){return e.message==="chat-journal-not-ready"}})()'),true);
  assert.deepEqual(await run('__fsChatJournal.load()'),{items:[],raws:[],receipts:[]});
  assert.deepEqual(await run('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
 });
 await t.test('one bulk transaction retains 3229 items and exact raw Unicode strings, deduplicates and clones',async()=>{
  const result=await run(`(async()=>{window.txWrites=0;const native=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')txWrites++;return native.apply(this,args)};
   window.originalRaw=' { "z":1,"a":"🧪\\ud800" }\\n';window.batch={items:Array.from({length:3229},(_,i)=>({key:'fs_chat_journal_v2:'+i,raw:JSON.stringify({kind:'pending',identity:'synthetic',jobId:'A1',message:{uid:String(i),text:'ไทย🧪'}})})),raws:[{sourceKey:'fs_chats',raw:originalRaw},{sourceKey:'event',raw:'{malformed\\n'},{sourceKey:'event',raw:'\\ud800'},{sourceKey:'event',raw:'\\udfff'}],receipts:['synthetic-receipt']};
   const [a,b]=await Promise.all([__fsChatJournal.preserve(batch),__fsChatJournal.preserve(batch)]);const writes=txWrites;const items=__fsChatJournal.verifiedItems();items[0].value.kind='mutated';a.raws[0].raw='mutated';
   return {count:b.items.length,raws:b.raws.map(r=>r.raw),receipt:__fsChatJournal.verifiedReceipt('synthetic-receipt'),writes,unmutated:__fsChatJournal.verifiedItems()[0].value.kind==='pending',state:__fsChatJournal.status().state};})()`);
  assert.equal(result.count,3229);assert.equal(result.writes,1);assert.equal(result.receipt,true);assert.equal(result.unmutated,true);assert.equal(result.state,'ready');
  assert.ok(result.raws.includes('{malformed\n'));assert.ok(result.raws.includes('\ud800'));assert.ok(result.raws.includes('\udfff'));
  await assert.rejects(run(`__fsChatJournal.preserve({items:[{key:batch.items[0].key,raw:'{"kind":"opaque"}'}]})`),/chat-journal-collision/);
  await run('__fsChatJournal.load()');assert.equal(await run('__fsChatJournal.verifiedItems().length'),3229);
 });
 await t.test('two independent handles serialize immutable same-key and distinct-key writes',async()=>{
  const b=await fresh();
  const aRun=run(`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:race',raw:'{"kind":"opaque","raw":"a"}'}]})`);
  const bRun=browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:race',raw:'{"kind":"opaque","raw":"b"}'}]})`);
  const results=await Promise.allSettled([aRun,bRun]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  await Promise.all([run(`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:distinct-a',raw:'{}'}]})`),browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:distinct-b',raw:'{}'}]})`)]);
  assert.equal((await run('__fsChatJournal.snapshot()')).items.length,3232);
 });
 await t.test('retire requires exact existing item and retains raw archive',async()=>{
  await assert.rejects(run(`__fsChatJournal.retireExact('fs_chat_journal_v2:0','{}')`),/chat-journal-collision/);
  await run('__fsChatJournal.retireExact(batch.items[0].key,batch.items[0].raw)');
  const snap=await run('__fsChatJournal.snapshot()');assert.equal(snap.items.some(i=>i.key==='fs_chat_journal_v2:0'),false);assert.ok(snap.raws.some(r=>r.sourceKey==='fs_chat_journal_v2:0'&&r.raw.includes('ไทย')));
 });
 for(const stage of ['archive','postdelete'])await t.test(stage+' readback failure retains exact independently durable evidence',async()=>{
  const b=await fresh(),key='fs_chat_journal_v2:retire-'+stage,raw=' {"kind":"opaque","raw":"original 🧪"}\\n';
  await browserValue(b,`__fsChatJournal.preserve({items:[{key:${JSON.stringify(key)},raw:${JSON.stringify(raw)}}]})`);
  await browserValue(b,`(()=>{const native=IDBDatabase.prototype.transaction;window.writes=0;IDBDatabase.prototype.transaction=function(...args){const tx=native.apply(this,args);if(args[1]==='readwrite')writes++;if(args[1]==='readonly'&&writes>=${stage==='archive'?1:2}){const get=tx.objectStore.bind(tx);tx.objectStore=function(n){const store=get(n),all=store.getAll.bind(store);store.getAll=function(){const r=all();r.addEventListener('success',()=>Object.defineProperty(r,'result',{value:[]}));return r};return store}}return tx}})()`);
  await assert.rejects(browserValue(b,`__fsChatJournal.retireExact(${JSON.stringify(key)},${JSON.stringify(raw)})`),/chat-journal-readback/);
  assert.equal(await browserValue(b,'__fsChatJournal.status().state'),'failed');
  const snapshot=await run('__fsChatJournal.snapshot()');assert.equal(snapshot.items.some(row=>row.key===key),stage==='archive');assert.ok(snapshot.raws.some(row=>row.sourceKey===key&&row.raw===raw));
 });
 await t.test('delete transaction abort keeps pending item and its already verified raw archive',async()=>{
  const b=await fresh(),key='fs_chat_journal_v2:delete-abort',raw='{"kind":"opaque","raw":"retain"}';
  await browserValue(b,`__fsChatJournal.preserve({items:[{key:${JSON.stringify(key)},raw:${JSON.stringify(raw)}}]})`);
  await browserValue(b,`(()=>{const native=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=native.apply(this,args),get=tx.objectStore.bind(tx);tx.objectStore=function(n){const store=get(n),del=store.delete.bind(store);store.delete=function(key){const r=del(key);r.addEventListener('success',()=>tx.abort());return r};return store};return tx}})()`);
  await assert.rejects(browserValue(b,`__fsChatJournal.retireExact(${JSON.stringify(key)},${JSON.stringify(raw)})`),/chat-journal-abort/);
  const snapshot=await run('__fsChatJournal.snapshot()');assert.ok(snapshot.items.some(row=>row.key===key&&row.raw===raw));assert.ok(snapshot.raws.some(row=>row.sourceKey===key&&row.raw===raw));
 });
 const faults=[
  ['success then abort',`const add=store.add.bind(store);store.add=function(value){const r=add(value);r.addEventListener('success',()=>tx.abort());return r}`, 'chat-journal-abort'],
  ['quota',`store.add=function(){throw new DOMException('private payload must not leak','QuotaExceededError')}`, 'chat-journal-quota'],
 ];
 for(const [name,patch,code] of faults)await t.test(name+' never installs uncommitted evidence',async()=>{
  const b=await fresh();await browserValue(b,`(()=>{const native=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=native.apply(this,args);if(args[1]==='readwrite'){const get=tx.objectStore.bind(tx);tx.objectStore=function(n){const store=get(n);${patch};return store}}return tx}})()`);
  await assert.rejects(browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:fault',raw:'{}'}]})`),new RegExp(code));
  assert.equal(await browserValue(b,'__fsChatJournal.status().state'),'failed');
  assert.equal(await browserValue(b,'(()=>{try{__fsChatJournal.verifiedItems();return false}catch(e){return true}})()'),true);
 });
 await t.test('strict durability unsupported hint falls back only for TypeError',async()=>{
  const b=await fresh();await browserValue(b,`(()=>{const native=IDBDatabase.prototype.transaction;window.strictAttempts=0;IDBDatabase.prototype.transaction=function(...args){if(args[2]){strictAttempts++;throw new TypeError('unsupported options')}return native.apply(this,args)}})()`);
  await browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:strict',raw:'{}'}]})`);assert.equal(await browserValue(b,'strictAttempts'),1);
 });
 await t.test('a generic transaction failure is never retried with weaker durability',async()=>{
  const b=await fresh();await browserValue(b,`(()=>{window.attempts=0;IDBDatabase.prototype.transaction=function(){attempts++;throw new DOMException('private payload','UnknownError')}})()`);
  await assert.rejects(browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:generic-error',raw:'{}'}]})`),/chat-journal-storage/);assert.equal(await browserValue(b,'attempts'),1);
 });
 await t.test('never-completing transaction times out even after native commit; late evidence is not readiness',async()=>{
  const b=await fresh();await browserValue(b,`(()=>{const timer=setTimeout;window.setTimeout=(fn,ms)=>timer(fn,ms>9000&&ms<=10000?40:ms);const native=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=native.apply(this,args);if(args[1]==='readwrite')tx.addEventListener('complete',event=>event.stopImmediatePropagation());return tx}})()`);
  await assert.rejects(browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:late-commit',raw:'{}'}]})`),/chat-journal-timeout/);assert.equal(await browserValue(b,'__fsChatJournal.status().state'),'failed');
  assert.ok((await run('__fsChatJournal.snapshot()')).items.some(item=>item.key==='fs_chat_journal_v2:late-commit'));
 });
 await t.test('caller mutation cannot change the captured batch and focus reload finds missed writes',async()=>{
  const b=await fresh();await browserValue(b,`(()=>{window.captured={items:[{key:'fs_chat_journal_v2:captured',raw:'{"kind":"opaque","raw":"original"}'}]};window.writing=__fsChatJournal.preserve(captured);captured.items[0].raw='{"kind":"opaque","raw":"new"}';return writing})()`);
  await run(`window.dispatchEvent(new Event('focus'));__fsChatJournal.load()`);assert.equal(await run(`__fsChatJournal.verifiedItems().find(e=>e.key==='fs_chat_journal_v2:captured').value.raw`),'original');
 });
 await t.test('readback mismatch fails closed after native commit',async()=>{
  const b=await fresh();await browserValue(b,`(()=>{const native=IDBDatabase.prototype.transaction;window.written=false;IDBDatabase.prototype.transaction=function(...args){const tx=native.apply(this,args);if(args[1]==='readwrite')written=true;if(args[1]==='readonly'&&written){const get=tx.objectStore.bind(tx);tx.objectStore=function(n){const store=get(n),all=store.getAll.bind(store);store.getAll=function(){const r=all();r.addEventListener('success',()=>Object.defineProperty(r,'result',{value:[]}));return r};return store}}return tx}})()`);
  await assert.rejects(browserValue(b,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:readback',raw:'{}'}]})`),/chat-journal-readback/);
  assert.equal(await browserValue(b,'__fsChatJournal.status().state'),'failed');
 });
 for(const [name,patch,code] of [
  ['unavailable',`Object.defineProperty(window,'indexedDB',{value:null})`,'unavailable'],
  ['open error',`indexedDB.open=function(){const r={};setTimeout(()=>r.onerror&&r.onerror(),0);return r}`,'open'],
  ['blocked',`indexedDB.open=function(){const r={};setTimeout(()=>r.onblocked&&r.onblocked(),0);return r}`,'blocked'],
  ['timeout and late success',`const real=setTimeout;window.setTimeout=(fn,ms)=>real(fn,ms>9000&&ms<=10000?30:ms);indexedDB.open=function(){const r={};real(()=>r.onsuccess&&r.onsuccess(),60);return r}`,'timeout'],
 ])await t.test(name+' has static error and no readiness',async()=>{
  const b=await fresh();await browserValue(b,patch+';true');await assert.rejects(browserValue(b,'__fsChatJournal.load()'),new RegExp('chat-journal-'+code));await browserValue(b,'new Promise(r=>setTimeout(r,100))');assert.equal(await browserValue(b,'__fsChatJournal.status().state'),'failed');
 });
 await t.test('corrupt existing raw digest is unreadable evidence, never a ready empty index',async()=>{
  await run(`new Promise((resolve,reject)=>{const r=indexedDB.open('fs_chat_fallback_v1');r.onsuccess=()=>{const db=r.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').add({id:'raw:'+('0'.repeat(64)),version:1,type:'raw',sourceKey:'synthetic',raw:'retained original'});tx.oncomplete=()=>{db.close();resolve(true)};tx.onabort=()=>reject(Error('fixture'))}})`);
  await assert.rejects(run('__fsChatJournal.load()'),/chat-journal-invalid/);assert.equal(await run('__fsChatJournal.status().state'),'failed');
 });
 await t.test('read-only incompatible existing database is not upgraded or treated as empty',async()=>{
  await run(`new Promise((resolve,reject)=>{const r=indexedDB.open('fs_chat_fallback_v1',2);r.onupgradeneeded=()=>r.result.createObjectStore('synthetic-other');r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(Error('fixture'))})`);
  await assert.rejects(run('__fsChatJournal.load()'),/chat-journal-schema/);assert.deepEqual(await run('indexedDB.databases().then(dbs=>dbs.map(db=>({name:db.name,version:db.version})))'),[{name:'fs_chat_fallback_v1',version:2}]);
 });
});

for(const options of [{keyPath:'wrong',autoIncrement:false},{keyPath:'id',autoIncrement:true}])test('existing v1 incompatible store '+JSON.stringify(options)+' rejects all adapter operations without modifying schema or data',async t=>{
 const asset=await readFile(new URL('../runtime/assets/fs-chat-journal.js',import.meta.url),'utf8');
 const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/asset.js'?'application/javascript':'text/html');res.end(req.url==='/asset.js'?asset:'<!doctype html><script src="/asset.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const browser=await actualBrowser(t,'http://127.0.0.1:'+server.address().port);if(!browser)return;
 const run=expression=>browserValue(browser,expression);
 await run(`new Promise((resolve,reject)=>{const request=indexedDB.open('fs_chat_fallback_v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('entries',${JSON.stringify(options)});request.onsuccess=()=>{request.result.close();resolve(true)};request.onerror=()=>reject(Error('fixture'))})`);
 await run(`(()=>{window.schemaWrites=0;window.schemaUpgrades=0;const native=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')schemaWrites++;return native.apply(this,args)};const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(...args){const request=open(...args);request.addEventListener('upgradeneeded',()=>schemaUpgrades++);return request}})()`);
 for(const [name,expression] of [
  ['load','__fsChatJournal.load()'],
  ['preserve',`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:incompatible',raw:'{}'}]})`],
  ['retireExact',`__fsChatJournal.retireExact('fs_chat_journal_v2:incompatible','{}')`],
 ])await t.test(name+' rejects incompatible schema and keeps synchronous reads closed',async()=>{
  await assert.rejects(run(expression),/chat-journal-schema/);
  assert.deepEqual(await run('__fsChatJournal.status()'),{state:'failed',code:'chat-journal-schema'});
  assert.equal(await run('(()=>{try{__fsChatJournal.verifiedItems();return false}catch(e){return e.message==="chat-journal-not-ready"}})()'),true);
  assert.equal(await run('(()=>{try{__fsChatJournal.verifiedReceipt("missing");return false}catch(e){return e.message==="chat-journal-not-ready"}})()'),true);
 });
 const untouched=await run(`new Promise((resolve,reject)=>{const request=indexedDB.open('fs_chat_fallback_v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('entries','readonly'),store=tx.objectStore('entries'),all=store.getAll();tx.oncomplete=()=>{const result={version:db.version,keyPath:store.keyPath,autoIncrement:store.autoIncrement,rows:all.result,writes:schemaWrites,upgrades:schemaUpgrades};db.close();resolve(result)};tx.onabort=()=>reject(Error('fixture'))};request.onerror=()=>reject(Error('fixture'))})`);
 assert.deepEqual(untouched,{version:1,...options,rows:[],writes:0,upgrades:0});
});


test('observational journal snapshots preserve owner publication and fail closed across native overlaps',async t=>{
 const asset=await readFile(new URL('../runtime/assets/fs-chat-journal.js',import.meta.url),'utf8');
 const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/asset.js'?'application/javascript':'text/html');res.end(req.url==='/asset.js'?asset:'<!doctype html><script src="/asset.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const origin='http://127.0.0.1:'+server.address().port,browser=await actualBrowser(t,origin);if(!browser)return;
 const run=expression=>browserValue(browser,expression);
 assert.deepEqual(await run('__fsChatJournal.snapshot()'),{items:[],raws:[],receipts:[]});
 assert.equal(await run('__fsChatJournal.status().state'),'idle','observation cannot initialize an owner index');
 assert.deepEqual(await run('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
 await run(`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:owner',raw:' {"kind":"opaque","raw":"original"} '}],receipts:['owner-receipt']})`);
 // Hold delivery of one actual completed scan, never its request success or
 // native commit. The adapter must remain pending until completion is delivered.
 await run(`(()=>{const native=IDBDatabase.prototype.transaction;window.holdScan=false;IDBDatabase.prototype.transaction=function(...args){const tx=native.apply(this,args),get=tx.objectStore.bind(tx);let scanned=false;tx.objectStore=function(name){const store=get(name),all=store.getAll.bind(store);store.getAll=function(){scanned=true;return all()};return store};tx.addEventListener('complete',event=>{if(scanned&&holdScan){holdScan=false;event.stopImmediatePropagation();window.releaseScan=()=>tx.oncomplete(event)}});return tx}})()`);
 const hold=async expression=>{await run(`window.releaseScan=null;window.holdScan=true;window.observing=${expression};true`);await run(`new Promise((resolve,reject)=>{const end=Date.now()+3000;const tick=()=>releaseScan?resolve(true):Date.now()>end?reject(Error('scan not held')):setTimeout(tick,5);tick()})`);};
 await t.test('in-flight observation cannot close the owner index after load resolves',async()=>{
  await hold('__fsChatJournal.snapshot()');
  try {assert.equal(await run('__fsChatJournal.status().state'),'ready');
  assert.equal(await run('__fsChatJournal.verifiedItems()[0].raw'),' {"kind":"opaque","raw":"original"} ');
  assert.equal(await run('__fsChatJournal.verifiedReceipt("owner-receipt")'),true);
  } finally {await run('releaseScan();observing');}
 });
 await t.test('observation sees sibling bytes without publishing them until explicit load',async()=>{
  const sibling=await browser.newPage(origin);
  await browserValue(sibling,`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:sibling',raw:'{"kind":"opaque","raw":"sibling"}'}]})`);
  const observation=await run('__fsChatJournal.snapshot()');assert.equal(observation.items.length,2);
  assert.equal(await run('__fsChatJournal.verifiedItems().length'),1,'observation does not declare the owner index freshly loaded');
  await run('__fsChatJournal.load()');assert.equal(await run('__fsChatJournal.verifiedItems().length'),2);
 });
 for(const operation of ['load','preserve','retire'])await t.test('observation and '+operation+' serialize exact evidence without changing publication ownership',async()=>{
  await hold('__fsChatJournal.snapshot()');
  const expression=operation==='load'?'__fsChatJournal.load()':operation==='preserve'?`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:queued',raw:'{}'}]})`:`__fsChatJournal.retireExact('fs_chat_journal_v2:queued','{}')`;
  await run(`window.ownerOperation=${expression};window.afterObservation=__fsChatJournal.snapshot();true`);
  await run('releaseScan();Promise.all([observing,ownerOperation,afterObservation])');
  const result=await run('({state:__fsChatJournal.status().state,items:__fsChatJournal.verifiedItems()})');
  assert.equal(result.state,'ready');
  assert.equal(result.items.some(row=>row.key==='fs_chat_journal_v2:queued'),operation==='preserve');
  if(operation==='retire')assert.ok((await run('__fsChatJournal.snapshot()')).raws.some(row=>row.sourceKey==='fs_chat_journal_v2:queued'&&row.raw==='{}'));
 });
 await t.test('failed observation closes the index and later successful observation cannot reopen it',async()=>{
  await run(`window.nativeOpen=indexedDB.open;indexedDB.open=function(){throw Error('synthetic read fault')}`);
  await assert.rejects(run('__fsChatJournal.snapshot()'),/chat-journal-storage/);
  await run('indexedDB.open=nativeOpen');
  assert.equal(await run('__fsChatJournal.status().state'),'failed');
  assert.equal((await run('__fsChatJournal.snapshot()')).items.length,2);
  assert.equal(await run('__fsChatJournal.status().state'),'failed');
  assert.equal(await run('(()=>{try{__fsChatJournal.verifiedItems();return false}catch(e){return e.message==="chat-journal-not-ready"}})()'),true);
  await run('__fsChatJournal.load()');assert.equal(await run('__fsChatJournal.status().state'),'ready');
 });
 await t.test('standalone native focus refreshes missed sibling entries through explicit owner load',async()=>{
  const sibling=await browser.newPage(origin);
  await run('window.observedFocus=0;window.addEventListener("focus",()=>observedFocus++);true');
  await sibling.send('Page.bringToFront');
  await browserValue(sibling,`__fsChatJournal.preserve({receipts:['native-focus-receipt']})`);
  assert.equal(await run('__fsChatJournal.verifiedReceipt("native-focus-receipt")'),false);
  await browser.send('Page.bringToFront');
  await run(`new Promise((resolve,reject)=>{const end=Date.now()+3000;const tick=()=>observedFocus&&__fsChatJournal.status().state==='ready'&&__fsChatJournal.verifiedReceipt('native-focus-receipt')?resolve(true):Date.now()>end?reject(Error('native focus did not reload')):setTimeout(tick,10);tick()})`);
 });
 await t.test('owner readonly refresh retains only completed evidence until its fresh result resolves',async()=>{
  const sibling=await browser.newPage(origin);
  await browserValue(sibling,`__fsChatJournal.preserve({receipts:['new-owner-read-receipt']})`);
  await hold('__fsChatJournal.load()');
  try {assert.equal(await run('__fsChatJournal.status().state'),'ready');assert.equal(await run('__fsChatJournal.verifiedReceipt("owner-receipt")'),true);assert.equal(await run('__fsChatJournal.verifiedReceipt("new-owner-read-receipt")'),false,'old absence is not fresh completeness');}
  finally {await run('releaseScan();observing');}
  assert.equal(await run('__fsChatJournal.verifiedReceipt("new-owner-read-receipt")'),true);
  for(const operation of [`__fsChatJournal.preserve({items:[{key:'fs_chat_journal_v2:owner-mutating',raw:'{}'}]})`,`__fsChatJournal.retireExact('fs_chat_journal_v2:owner-mutating','{}')`]) {
   await hold(operation);
   try {assert.equal(await run('__fsChatJournal.status().state'),'loading');assert.equal(await run('(()=>{try{__fsChatJournal.verifiedReceipt("owner-receipt");return false}catch(e){return true}})()'),true,'mutating operation keeps the index closed');}
   finally {await run('releaseScan();observing');}
  }
 });
 await t.test('failed owner read closes old evidence and a late timed-out scan cannot reopen it',async()=>{
  await run(`window.nativeOpen=indexedDB.open;indexedDB.open=function(){throw Error('synthetic owner read fault')}`);
  await assert.rejects(run('__fsChatJournal.load()'),/chat-journal-storage/);await run('indexedDB.open=nativeOpen');
  assert.equal(await run('__fsChatJournal.status().state'),'failed');await run('__fsChatJournal.snapshot()');assert.equal(await run('__fsChatJournal.status().state'),'failed');
  await run('__fsChatJournal.load()');
  await run('window.observationTimer=setTimeout;window.setTimeout=(fn,ms)=>observationTimer(fn,ms>9000&&ms<=10000?100:ms)');
  await hold('__fsChatJournal.load()');await assert.rejects(run('observing'),/chat-journal-timeout/);
  await run('window.setTimeout=observationTimer;releaseScan();Promise.resolve()');assert.equal(await run('__fsChatJournal.status().state'),'failed');
  await hold('__fsChatJournal.load()');
  try {assert.equal(await run('__fsChatJournal.status().state'),'loading','without verified evidence the owner read remains closed');}
  finally {await run('releaseScan();observing');}
 });
 await t.test('timed-out observation and its late completion never reopen the closed index',async()=>{
  await run('window.observationTimer=setTimeout;window.setTimeout=(fn,ms)=>observationTimer(fn,ms>9000&&ms<=10000?100:ms)');
  await hold('__fsChatJournal.snapshot()');
  await assert.rejects(run('observing'),/chat-journal-timeout/);
  await run('window.setTimeout=observationTimer;releaseScan();Promise.resolve()');
  assert.equal(await run('__fsChatJournal.status().state'),'failed');
  await run('__fsChatJournal.snapshot()');assert.equal(await run('__fsChatJournal.status().state'),'failed');
  await run('__fsChatJournal.load()');assert.equal(await run('__fsChatJournal.status().state'),'ready');
 });
 await t.test('versionchange during observation invalidates owner evidence and rejects late publication',async()=>{
  await hold('__fsChatJournal.snapshot()');
  await run(`new Promise((resolve,reject)=>{const r=indexedDB.open('fs_chat_fallback_v1',2);r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(Error('synthetic upgrade'))})`);
  assert.equal(await run('__fsChatJournal.status().state'),'idle');
  await assert.rejects(run('releaseScan();observing'),/chat-journal-stale/);
  assert.equal(await run('__fsChatJournal.status().state'),'failed');
  assert.equal(await run('(()=>{try{__fsChatJournal.verifiedItems();return false}catch(e){return true}})()'),true);
 });

});

// A delayed document deterministically exposes the initial about:blank boundary.
test('native page helper waits for intended document before adapter assertions',async t=>{
 const asset=await readFile(new URL('../runtime/assets/fs-chat-journal.js',import.meta.url),'utf8');
 const server=createServer((req,res)=>{
  if(req.url==='/asset.js'){res.setHeader('content-type','application/javascript');res.end(asset);return;}
  setTimeout(()=>{res.setHeader('content-type','text/html');res.end('<!doctype html><script src="/asset.js"></script>');},400);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const intended='http://127.0.0.1:'+server.address().port+'/delayed';
 const browser=await actualBrowser(t,intended);if(!browser)return;
 const state=await browserValue(browser,'({url:location.href,ready:document.readyState,api:typeof window.__fsChatJournal,scripts:Array.from(document.scripts,s=>s.src)})');
 t.diagnostic('target_document='+JSON.stringify({intended,...state}));
 assert.equal(state.url,intended);assert.equal(state.ready,'complete');assert.equal(state.api,'object');
 const fresh=await browser.newPage(intended+'?fresh');
 assert.deepEqual(await browserValue(fresh,'({url:location.href,ready:document.readyState,api:typeof window.__fsChatJournal})'),{url:intended+'?fresh',ready:'complete',api:'object'});
});


test('intended document bound diagnoses a wrong document and does not mask missing or broken assets',async t=>{
 const server=createServer((req,res)=>{if(req.url==='/missing.js'){res.writeHead(404);res.end('');return;}if(req.url==='/broken.js'){res.setHeader('content-type','application/javascript');res.end('throw new Error("synthetic broken asset")');return;}res.setHeader('content-type','text/html');res.end('<!doctype html><script src="'+(req.url==='/broken'?'/broken.js':'/missing.js')+'"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const origin='http://127.0.0.1:'+server.address().port,browser=await actualBrowser(t,'about:blank');if(!browser)return;
 await assert.rejects(waitForDocument(browser,origin+'/never-navigated',60),error=>error.message.includes('Intended document did not complete:')&&error.message.includes('about:blank')&&error.message.includes('never-navigated'));
 for(const path of ['/missing','/broken']){
  const page=await browser.newPage(origin+path);
  assert.equal(await browserValue(page,'location.href'),origin+path);
  await assert.rejects((async()=>assert.equal(await browserValue(page,'typeof window.__fsChatJournal'),'object','adapter must really load'))(),/adapter must really load/);
 }
});
