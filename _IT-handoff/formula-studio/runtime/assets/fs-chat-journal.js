/* Additive local recovery evidence. No network, UI, identity or replay policy.
 * Strict durability is requested where supported; it is a browser hint, not a
 * guarantee against clearing site data, hardware loss or an uncommitted write. */
(function () {
  'use strict';
  if (window.__fsChatJournal) return;
  var DB='fs_chat_fallback_v1', STORE='entries', TIMEOUT=10000;
  var index=null, state='idle', code='', listeners=new Set(), notifying=false;
  var tail=Promise.resolve(), flights=new Map(), epoch=0;
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function failure(reason) { return new Error('chat-journal-'+reason); }
  function status() { return {state:state,code:code}; }
  function change(next, reason) {
    state=next; code=reason || '';
    if (notifying) return;
    notifying=true;
    Promise.resolve().then(function () {
      notifying=false;
      listeners.forEach(function (fn) { try { fn(status()); } catch (_) {} });
    });
  }
  function reason(error) {
    if (error && /^chat-journal-[a-z-]+$/.test(error.message)) return error.message.slice(13);
    return error && error.name==='QuotaExceededError'?'quota':'storage';
  }
  async function digest(sourceKey,raw) {
    if (!window.crypto || !window.crypto.subtle) throw failure('crypto');
    // JSON serialization escapes lone UTF-16 surrogates before UTF-8 encoding.
    var bytes=new TextEncoder().encode(JSON.stringify([sourceKey,raw]));
    var hash=await window.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash)).map(function (n) {return n.toString(16).padStart(2,'0');}).join('');
  }
  function valid(record) {
    if (!record || record.version!==1 || typeof record.id!=='string') throw failure('invalid');
    if (record.type==='item' && typeof record.key==='string' && record.key.indexOf('fs_chat_journal_v2:')===0 && typeof record.raw==='string'
      && record.id==='item:'+record.key) return;
    if (record.type==='raw' && typeof record.sourceKey==='string' && typeof record.raw==='string' && /^raw:[a-f0-9]{64}$/.test(record.id)) return;
    if (record.type==='receipt' && typeof record.key==='string' && record.key && record.id==='receipt:'+record.key) return;
    throw failure('invalid');
  }
  function equal(a,b) {
    if (!a || a.version!==b.version || a.type!==b.type || a.id!==b.id) return false;
    return b.type==='raw'?a.sourceKey===b.sourceKey && a.raw===b.raw:b.type==='item'?a.key===b.key && a.raw===b.raw:a.key===b.key;
  }
  async function records(batch) {
    var result=[];
    (batch.items || []).forEach(function (entry) {result.push({id:'item:'+entry.key,version:1,type:'item',key:entry.key,raw:entry.raw});});
    for (var entry of batch.raws || []) result.push({id:'raw:'+await digest(entry.sourceKey,entry.raw),version:1,type:'raw',sourceKey:entry.sourceKey,raw:entry.raw});
    (batch.receipts || []).forEach(function (key) {result.push({id:'receipt:'+key,version:1,type:'receipt',key:key});});
    var unique=new Map();
    result.forEach(function (row) {valid(row);if (unique.has(row.id) && !equal(unique.get(row.id),row)) throw failure('collision');unique.set(row.id,row);});
    return Array.from(unique.values());
  }
  async function decode(rows) {
    var snapshot={items:[],raws:[],receipts:[]};
    for (var row of rows) {
      valid(row);
      if (row.type==='item') {
        var value; try {value=JSON.parse(row.raw);} catch (_) {value=null;}
        snapshot.items.push({key:row.key,raw:row.raw,value:value,backend:'indexeddb'});
      } else if (row.type==='raw') {
        if (row.id!=='raw:'+await digest(row.sourceKey,row.raw)) throw failure('invalid');
        snapshot.raws.push({sourceKey:row.sourceKey,raw:row.raw});
      } else snapshot.receipts.push(row.key);
    }
    return snapshot;
  }
  // The deadline covers opening, transaction completion and separate readback.
  // Late events close/abort their handles and can never install a ready index.
  function bounded(body,budget) {
    return new Promise(function (resolve,reject) {
      if (budget<=0) return reject(failure('timeout'));
      var active=true, handles=[], transactions=[];
      function close() {handles.forEach(function (db) {try {db.close();} catch (_) {}});}
      var timer=window.setTimeout(function () {
        if (!active) return;active=false;
        transactions.forEach(function (tx) {try {tx.abort();} catch (_) {}});close();reject(failure('timeout'));
      },budget);
      var op={active:function () {return active;},handles:handles,transactions:transactions};
      Promise.resolve().then(function () {return body(op);}).then(function (result) {
        if (!active) return;active=false;window.clearTimeout(timer);close();resolve(result);
      },function (error) {if (!active) return;active=false;window.clearTimeout(timer);close();reject(failure(reason(error)));});
    });
  }
  function open(op,write) {
    return new Promise(function (resolve,reject) {
      if (!window.indexedDB) return reject(failure('unavailable'));
      var request, absent=false, settled=false;
      function fail(error) {if (settled) return;settled=true;reject(error);}
      try {request=write?window.indexedDB.open(DB,1):window.indexedDB.open(DB);} catch (error) {return fail(failure(reason(error)));}
      request.onblocked=function () {fail(failure('blocked'));};
      request.onerror=function () {if (absent && !write) {settled=true;resolve(null);} else fail(failure('open'));};
      request.onupgradeneeded=function (event) {
        if (!op.active() || settled || !write || event.oldVersion!==0) {
          absent=!write && event.oldVersion===0;
          try {request.transaction.abort();} catch (_) {}
          if (!absent) fail(failure('schema'));
          return;
        }
        request.result.createObjectStore(STORE,{keyPath:'id'});
      };
      request.onsuccess=function () {
        var db=request.result;
        if (!op.active() || settled) {try {db.close();} catch (_) {}return;}
        if (db.version!==1 || !db.objectStoreNames.contains(STORE)) {db.close();return fail(failure('schema'));}
        try {
          var store=db.transaction(STORE,'readonly').objectStore(STORE);
          if (store.keyPath!=='id' || store.autoIncrement!==false) {db.close();return fail(failure('schema'));}
        } catch (error) {db.close();return fail(failure(reason(error)));}
        op.handles.push(db);db.onversionchange=function () {db.close();epoch++;index=null;change('idle','chat-journal-versionchange');};
        settled=true;resolve(db);
      };
    });
  }
  function transaction(db,mode,op,body) {
    return new Promise(function (resolve,reject) {
      if (!op.active()) return reject(failure('timeout'));
      var tx,result,failed;
      try {
        if (mode==='readwrite') {
          try {tx=db.transaction(STORE,mode,{durability:'strict'});}
          catch (error) {if (error.name!=='TypeError') throw error;tx=db.transaction(STORE,mode);}
        } else tx=db.transaction(STORE,mode);
        op.transactions.push(tx);
        tx.oncomplete=function () {if (failed) reject(failed);else resolve(result);};
        tx.onabort=function () {reject(failed || failure(tx.error && tx.error.name==='QuotaExceededError'?'quota':'abort'));};
        tx.onerror=function () {failed=failed || failure(tx.error && tx.error.name==='QuotaExceededError'?'quota':'transaction');};
        body(tx.objectStore(STORE),function (value) {result=value;},function (error) {failed=failed || failure(reason(error));try {tx.abort();} catch (_) {reject(failed);}});
      } catch (error) {failed=failure(reason(error));if (tx) try {tx.abort();} catch (_) {}reject(failed);}
    });
  }
  function scan(db,op) {
    if (!db) return Promise.resolve([]);
    return transaction(db,'readonly',op,function (store,set,fail) {
      var request=store.getAll();request.onsuccess=function () {set(request.result);};request.onerror=function () {fail(failure('read'));};
    });
  }
  function write(db,op,expected,retire) {
    return transaction(db,'readwrite',op,function (store,set,fail) {
      expected.forEach(function (row) {
        var get=store.get(row.id);
        get.onerror=function () {fail(failure('read'));};
        get.onsuccess=function () {
          try {
            if (get.result && !equal(get.result,row)) return fail(failure('collision'));
            if (!get.result) {var add=store.add(row);add.onerror=function () {fail(failure(add.error && add.error.name==='QuotaExceededError'?'quota':'write'));};}
          } catch (error) {fail(error);}
        };
      });
      if (retire) {
        var get=store.get('item:'+retire.key);
        get.onerror=function () {fail(failure('read'));};
        get.onsuccess=function () {
          try {
          if (get.result && get.result.raw!==retire.raw) return fail(failure('collision'));
          if (get.result) {var del=store.delete('item:'+retire.key);del.onerror=function () {fail(failure('write'));};}
          } catch (error) {fail(error);}
        };
      }
    });
  }
  function execute(key,body,publish) {
    var retainVerifiedRead=publish==='refresh';publish=publish!==false;
    if (flights.has(key)) return flights.get(key).then(clone);
    var queuedAt=Date.now();
    var promise=tail.then(function () {
      if (publish && !(retainVerifiedRead && state==='ready' && index)) {index=null;change('loading');}var generation=epoch;
      return bounded(body,Math.max(0,TIMEOUT-(Date.now()-queuedAt))).then(function (snapshot) {if (generation!==epoch) {index=null;change('failed','chat-journal-stale');throw failure('stale');}if (publish) {index=clone(snapshot);change('ready');}return clone(snapshot);},function (error) {index=null;change('failed',error.message);throw error;});
    });
    tail=promise.catch(function () {});flights.set(key,promise);
    promise.then(function () {flights.delete(key);},function () {flights.delete(key);});
    return promise.then(clone);
  }
  function load() {
    // A readonly refresh cannot erase already completed positive evidence.
    // Consumers needing fresh completeness must still await this result.
    return execute('load',async function (op) {return decode(await scan(await open(op,false),op));},'refresh');
  }
  // Recovery reads observe fresh durable bytes but do not own the synchronous
  // controller index. Its evidence remains as of the owner's last completed
  // load/write; only a new owner operation can publish newer evidence. An
  // observation failure still closes that index, and success cannot reopen it.
  function snapshot() {
    return execute('snapshot',async function (op) {return decode(await scan(await open(op,false),op));},false);
  }
  function preserve(batch) {
    var captured;try {captured=clone(batch || {});} catch (_) {return Promise.reject(failure('invalid'));}
    return execute('preserve:'+JSON.stringify(captured),async function (op) {
      var expected=await records(captured), db=await open(op,true);
      await write(db,op,expected);
      var rows=await scan(db,op), byId=new Map(rows.map(function (row) {return [row.id,row];}));
      expected.forEach(function (row) {if (!equal(byId.get(row.id),row)) throw failure('readback');});
      return decode(rows);
    });
  }
  function retireExact(key,raw) {
    return execute('retire:'+JSON.stringify([key,raw]),async function (op) {
      if (typeof key!=='string' || key.indexOf('fs_chat_journal_v2:')!==0 || typeof raw!=='string') throw failure('invalid');
      var expected=await records({raws:[{sourceKey:key,raw:raw}]}),db=await open(op,false);
      if (!db) return {items:[],raws:[],receipts:[]};
      var original=(await scan(db,op)).find(function (row) {return row.id==='item:'+key;});
      if (!original) return decode(await scan(db,op));
      if (original.raw!==raw) throw failure('collision');
      // Archive and independently verify the original before deleting pending.
      // A later refresh failure cannot undo a completed deletion; the verified
      // immutable archive remains available and the index stays closed.
      await write(db,op,expected);
      var archived=await scan(db,op);
      if (!equal(archived.find(function (row) {return row.id===expected[0].id;}),expected[0])) throw failure('readback');
      await write(db,op,[],{key:key,raw:raw});
      var rows=await scan(db,op),byId=new Map(rows.map(function (row) {return [row.id,row];}));
      if (byId.has('item:'+key) || !equal(byId.get(expected[0].id),expected[0])) throw failure('readback');
      return decode(rows);
    }).then(function () {});
  }
  function verified() {if (state!=='ready' || !index) throw failure('not-ready');return index;}
  window.__fsChatJournal={version:1,load:load,preserve:preserve,verifiedItems:function () {return clone(verified().items);},
    verifiedReceipt:function (key) {return verified().receipts.indexOf(key)!==-1;},retireExact:retireExact,snapshot:snapshot,status:status,
    subscribe:function (fn) {listeners.add(fn);return function () {listeners.delete(fn);};}};
  window.addEventListener('focus',function () {
    // The installed delegated controller already owns a fresh focus cycle.
    // Standalone recovery/legacy shells still refresh through this listener.
    if (window.__fsJobSync && window.__fsJobSync.installed && window.__fsJobSync.ready
      && typeof window.__fsRuntimeBoot==='function' && typeof window.sbPull==='function' && typeof window.sbReq==='function') return;
    load().catch(function () {});
  });
}());
