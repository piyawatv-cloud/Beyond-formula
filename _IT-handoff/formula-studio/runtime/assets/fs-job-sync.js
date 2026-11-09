/* Durable job saves for the sealed legacy application. No fetch override, schema
 * replacement, or cached-row seeding. Server acknowledgement is per saved value. */
(function () {
  'use strict';
  if (window.__fsJobSync && window.__fsJobSync.installed) return;
  var KEY = 'fs_job_outbox_v1:';
  var RECORD_CACHE_OMISSIONS = 'fs_record_cache_omissions_v1';
  var actor = '', sessionEmail = '', queue = {}, confirmed = {}, last = {}, storageError = false, storageProblem = '', receipts = {}, notices = {};
    var visibleHistoryIdentity = '', visibleIdentity = '', visibleGeneration = 0;
  var chatRecoveryBlocked = false, chatQuotaRecovered = false, chatSaveFailureEpoch = 0, chatStorageEventPause=null, chatPauseFailureEpoch=0;
  function invalidateChatStoragePause() {chatStorageEventPause=null;chatPauseFailureEpoch++;}
  // Fresh central revocations quarantine existing parent drafts in their exact
  // private journals until a complete authorized hydration permits replay.
  var revokedCentralRecords = Object.create(null), lastVerifiedParentIds = null;
  function parentScopeBlocked(id) {
    if (!delegatedRuntime) return false;
    var pending=queue[id];
    // A sibling may deliver its first journal after the scope read. Its
    // acknowledged baseline proves this is an existing parent, not a create.
    if (lastVerifiedParentIds && !lastVerifiedParentIds[id] && pending && pending.expected && !unknownExpected(pending.expected)) revokedCentralRecords[id]=true;
    return own(revokedCentralRecords,id);
  }
  var generatorActivities = {}, generatorTransaction = false;
  // Additive durable fallback for the one case where the legacy immutable
  // localStorage journal cannot be written because the browser is full.
  // It deliberately never migrates, rewrites, or clears legacy keys.
  var FALLBACK_DB = 'fs_job_fallback_v1', FALLBACK_STORE = 'journals', FALLBACK_INDEX = 'fs_job_fallback_index_v1:';
  var fallback = {}, fallbackStaging = {}, generatorCompletions = {}, recoveryFocusRequested = false;
  var pendingChatOpen = null, readOnlyChatRooms=Object.create(null);
  var flushing = null, installed = false, delegatedRuntime = false, blockedLegacy = false, suppressed = {}, suppressedRecords = {}, deferredUsers = {}, pushingOwner = null, legacyRecoveryBusy = {}, recoveryDiagnostic = null;
  // The Activities page remains an audit log. It must not become a second
  // central-save status dashboard or issue a background request every minute.
  var integrityEnabled = false;
  var integrity = {owner:'', status:'unknown', checkedAt:null, items:[], counts:{}}, integrityBusy = null, integrityLastAttempt = 0, integrityPanel = null, integrityEpoch = 0;
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var verifiedRecordCache = Object.create(null);
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function json(x) { return stableStr(x); }
  function clearConfirmedChatCache(identity) {
    if (!identity) return false;
    try {
      if (localStorage.getItem('fs_chat_cache_owner_v1')!==identity && !(chatAdapter() && visibleHistoryIdentity===identity)) return false;
      if (!preserveUnclassifiedChatCache(identity,confirmedChatData,[])) return false;
      writeChatCache('[]');
      return true;
    } catch (_) { return false; }
  }
  var CHAT_JOURNAL = 'fs_chat_journal_v2:', confirmedChatData = Object.create(null);
  var chatBatch=null, chatWaiting={items:[],raws:[],receipts:[]}, chatBarrier=null, chatInFlight=null, chatRawIndex=[], chatEntryIndex=Object.create(null), chatGeneratedRaw=null;
  var resumeChatDurability=function () {};
  function chatGeneration() { return {visible:visibleGeneration,session:window.__fsSessionGeneration,owner:currentUser}; }
  function sameChatGeneration(g) { return g.visible===visibleGeneration && g.session===window.__fsSessionGeneration && g.owner===currentUser; }
  function chatAdapter() { return window.__fsChatJournal; }
  function rememberChatSnapshot(snapshot) {chatRawIndex=snapshot.raws.map(function (r) {return {sourceKey:r.sourceKey,raw:r.raw};});chatEntryIndex=Object.create(null);snapshot.items.forEach(function (entry) {chatEntryIndex[entry.key]=entry;});}
  function archivedChatRaw(sourceKey,raw) { return chatRawIndex.some(function (r) {return r.sourceKey===sourceKey && r.raw===raw;}); }
  function captureChatRaw(sourceKey,raw) {
    if (!chatBatch || !chatAdapter() || typeof raw!=='string') return;
    if (sourceKey==='fs_chats' && raw===chatGeneratedRaw) return;
    if (!archivedChatRaw(sourceKey,raw)) chatBatch.raws.push({sourceKey:sourceKey,raw:raw});
  }
  function chatItemEntry(item) {
    var value=clone(item);
    return {key:CHAT_JOURNAL+sha256RecordData(value),raw:JSON.stringify(value),value:value};
  }
  function verifiedChatEntry(key) {
    var adapter=chatAdapter();
    if (!adapter) return null;
    if (adapter.status().state!=='ready') throw new Error('chat-journal-not-ready');
    return chatEntryIndex[key] || null;
  }
  function putChatItem(item) {
    var entry=chatItemEntry(item), key=entry.key, old=localStorage.getItem(key);
    var fallback=chatBatch && chatAdapter() && chatAdapter().status().state!=='ready'?null:verifiedChatEntry(key);
    if (old && old!==entry.raw) {
      if (json(JSON.parse(old))!==json(entry.value)) throw new Error('chat recovery identity collision');
      entry.raw=old;
    }
    if (fallback && fallback.raw!==entry.raw) {
      if (json(fallback.value)!==json(entry.value)) throw new Error('chat recovery identity collision');
      if (old && old!==fallback.raw) captureChatRaw(key,old);
      entry.raw=fallback.raw;
    }
    if (chatBatch) {chatBatch.items.push({key:key,raw:entry.raw});return key;}
    if (old===entry.raw || fallback) return key;
    localStorage.setItem(key,entry.raw);
    if (localStorage.getItem(key)!==entry.raw) throw new Error('chat recovery readback failed');
    return key;
  }
  function chatJournalItems() {
    var keys=[], result=[], byKey=Object.create(null);
    for (var i=0;i<localStorage.length;i++) {var key=localStorage.key(i);if (key && key.indexOf(CHAT_JOURNAL)===0) keys.push(key);}
    function include(entry) {
      var value=JSON.parse(entry.raw);
      if (!value || entry.key!==CHAT_JOURNAL+sha256RecordData(value)) throw new Error('chat recovery entry invalid');
      if (byKey[entry.key]) {
        if (byKey[entry.key].raw!==entry.raw && json(byKey[entry.key].value)!==json(value)) throw new Error('chat recovery identity collision');
        if (byKey[entry.key].raw!==entry.raw) byKey[entry.key].fallbackRaw=entry.raw;
        // A copy on both backends must retire both only after exact ACK.
        if (entry.backend==='indexeddb') byKey[entry.key].fallback=true;
        return;
      }
      entry.value=value;byKey[entry.key]=entry;result.push(entry);
    }
    keys.sort().forEach(function (key) {var raw=localStorage.getItem(key);if (raw) include({key:key,raw:raw,backend:'localstorage'});});
    if (chatAdapter()) chatAdapter().verifiedItems().forEach(include);
    return result;
  }
  function mergeChatBatch(target,batch) {
    ['items','raws','receipts'].forEach(function (kind) {
      (batch[kind] || []).forEach(function (entry) {
        if (!target[kind].some(function (old) {return kind==='receipts'?old===entry:kind==='items'?old.key===entry.key && old.raw===entry.raw:old.sourceKey===entry.sourceKey && old.raw===entry.raw;})) target[kind].push(entry);
      });
    });
  }
  function settleChatWaiting(batch) {
    ['items','raws','receipts'].forEach(function (kind) {
      chatWaiting[kind]=chatWaiting[kind].filter(function (entry) {return !batch[kind].some(function (old) {return kind==='receipts'?old===entry:kind==='items'?old.key===entry.key && old.raw===entry.raw:old.sourceKey===entry.sourceKey && old.raw===entry.raw;});});
    });
  }
  // An event only captures evidence. The active owner drains one captured
  // batch; later arrivals defer that read attempt rather than racing a second
  // writer or treating incomplete local work as lost server authority.
  var CHAT_DEFERRED={deferred:'chat-evidence'};
  function hasChatWaiting() {return !!(chatWaiting.items.length || chatWaiting.raws.length || chatWaiting.receipts.length);}
  function assertChatWaitingSettled(generation,saveEpoch) {
    if (!sameChatGeneration(generation)) throw new Error('trusted session changed');
    assertChatSaveAttempt(saveEpoch);
    if (hasChatWaiting() || chatBarrier || chatInFlight) throw CHAT_DEFERRED;
  }
  async function drainChatWaiting(identity,generation,saveEpoch) {
    var barrier=chatBarrier, failureEpoch=chatPauseFailureEpoch;
    if (barrier) {
      var outcome=await barrier;
      if (outcome===false || failureEpoch!==chatPauseFailureEpoch) throw new Error('pending chat recovery could not be saved');
      assertChatSaveAttempt(saveEpoch);
      if (!sameChatGeneration(generation)) throw new Error('trusted session changed');
      if (outcome===CHAT_DEFERRED || chatBarrier && chatBarrier!==barrier) throw CHAT_DEFERRED;
    }
    if (hasChatWaiting()) {
      var captured=clone(chatWaiting);
      if (!await ensureChatDurability(captured,identity,generation)) throw new Error('pending chat recovery could not be saved');
      settleChatWaiting(captured);
    }
    assertChatWaitingSettled(generation,saveEpoch);
    // Only the owner that actually verified the remaining batch may clear its
    // recovery block. App readiness still needs the fresh scope/session checks.
    if (captured) chatRecoveryBlocked=false;
  }
  function collectChatBatch(work) {
    var previous=chatBatch, batch={items:[],raws:[],receipts:[]};chatBatch=batch;
    try {if (work()===false) throw new Error('unclassified legacy chat cache could not be preserved');}
    catch (error) {error.fsChatBatch=batch;throw error;}
    finally {chatBatch=previous;}
    var result={items:[],raws:[],receipts:[]};mergeChatBatch(result,batch);return result;
  }
  function verifyChatBatchSync(batch) {
    if (chatAdapter() && chatAdapter().status().state!=='ready') throw new Error('chat-journal-not-ready');
    batch.items.forEach(function (entry) {putChatItem(JSON.parse(entry.raw));});
    batch.receipts.forEach(function (key) {
      if (localStorage.getItem(key)==='copied' || chatAdapter() && chatAdapter().verifiedReceipt(key)) return;
      localStorage.setItem(key,'copied');
      if (localStorage.getItem(key)!=='copied') throw new Error('chat import receipt not durable');
    });
    if (batch.raws.some(function (r) {return !archivedChatRaw(r.sourceKey,r.raw);})) throw new Error('chat-durability-pending');
  }
  // All inputs are captured before the first await. Evidence may finish for an
  // old actor; it can never authorize that actor's replacement or readiness.
  async function ensureChatDurability(batch,identity,generation) {
    try {
      batch=clone(batch);generation={visible:generation.visible,session:generation.session,owner:generation.owner};
      var adapter=chatAdapter();
      if (adapter && adapter.status().state!=='ready') {
        rememberChatSnapshot(await adapter.load());
        if (!sameChatGeneration(generation)) return false;
      }
      try {verifyChatBatchSync(batch);}
      catch (error) {
        if (!quotaError(error) && error.message!=='chat-durability-pending') throw error;
        if (!adapter) throw error;
        var quota=quotaError(error);if (quota) chatQuotaRecovered=true;
        var snapshot=await adapter.preserve({items:quota?batch.items:[],raws:batch.raws,receipts:quota?batch.receipts:[]});rememberChatSnapshot(snapshot);
        if (!sameChatGeneration(generation)) return false;
        verifyChatBatchSync(batch);
      }
      if (!sameChatGeneration(generation)) return false;
      if (delegatedRuntime && identity && generation.owner===actor) {
        var fresh=await trustedSession(generation.owner);
        if (!sameChatGeneration(generation) || fresh.identity!==identity) return false;
      }
      return true;
    } catch (error) {invalidateChatStoragePause();chatConnectionFailure('chat-preserve',error);return false;}
  }
  function queueChatDurability(batch,identity) {
    mergeChatBatch(chatWaiting,batch);
    if (chatBarrier) return;
    // Own one complete batch, captured before any asynchronous read. Later
    // notifications remain waiting for a fresh owner attempt, not this barrier.
    var generation=chatGeneration(), captured=chatWaiting;
    chatWaiting={items:[],raws:[],receipts:[]};chatInFlight=captured;
    chatBarrier=Promise.resolve().then(async function () {
      if (chatAdapter() && chatAdapter().status().state!=='ready') {rememberChatSnapshot(await chatAdapter().load());if (!sameChatGeneration(generation)) return false;}
      return await ensureChatDurability(captured,identity,generation);
    }).catch(function (error) {invalidateChatStoragePause();chatConnectionFailure('chat-preserve',error);return false;}).then(function (ready) {
      if (ready!==true || !sameChatGeneration(generation)) {mergeChatBatch(chatWaiting,captured);invalidateChatStoragePause();return false;}
      chatInFlight=null;
      var deferred=hasChatWaiting();
      chatRecoveryBlocked=deferred;
      // One existing owner wake; its bounded drain owns the next batch. Never
      // mark unverified waiting evidence ready or recursively preserve it here.
      resumeChatDurability();
      return deferred ? CHAT_DEFERRED : true;
    }).finally(function () {chatBarrier=null;chatInFlight=null;});
  }
  function preserveChatWork(work,identity,stage) {
    if (chatBatch) return work()!==false;
    try {
      var batch=collectChatBatch(work);mergeChatBatch(batch,chatWaiting);if (chatInFlight) mergeChatBatch(batch,chatInFlight);
      try {verifyChatBatchSync(batch);chatRecoveryBlocked=false;return true;}
      catch (error) {
        if (quotaError(error) || error.message==='chat-durability-pending' || error.message==='chat-journal-not-ready') queueChatDurability(batch,identity);
        throw error;
      }
    } catch (error) {
      if (!quotaError(error) && error.message!=='chat-durability-pending' && error.message!=='chat-journal-not-ready') invalidateChatStoragePause();
      if (error.message==='chat-journal-not-ready' && error.fsChatBatch) queueChatDurability(error.fsChatBatch,identity);
      chatRecoveryBlocked=true;chatConnectionFailure(stage || 'chat-preserve',error);return false;
    }
  }
  function importLegacyPending(identity) {
    if (!preserveChatWork(function () {return collectLegacyPending(identity);},identity)) throw new Error('pending chat recovery could not be saved');
  }
  function collectLegacyPending(identity) {
    var sourceKey='fs_chat_pending_v1:'+encodeURIComponent(identity), raw=localStorage.getItem(sourceKey);
    if (!raw) return;
    captureChatRaw(sourceKey,raw);
    var rows=JSON.parse(raw);if (!Array.isArray(rows)) throw new Error('legacy pending chat journal invalid');
    rows.forEach(function (item) {
      if (!item || !item.jobId || !item.message || !item.message.uid) throw new Error('legacy pending chat item invalid');
      var value={kind:'pending',identity:identity,jobId:item.jobId,message:item.message};
      var marker='fs_chat_imported_v2:'+sha256RecordData(value);
      var copied=localStorage.getItem(marker)==='copied' || chatAdapter() && chatAdapter().verifiedReceipt(marker);
      // The retained v1 original plus exact current central data covers a
      // retired import. The receipt alone cannot suppress a missing item.
      if (!(copied && json(confirmedChatData[item.jobId+'|'+item.message.uid] || null)===json(item.message))) putChatItem(value);
      chatBatch.receipts.push(marker);
    });
  }
  function preserveUnclassifiedChatCache(identity, centralMessages, centralRooms, observedRaw) {
    // observedRaw is copied synchronously, including storage-event sole copies.
    var captured=observedRaw===undefined?localStorage.getItem('fs_chats'):observedRaw;
    return preserveChatWork(function () {return collectUnclassifiedChatCache(identity,centralMessages,centralRooms,captured);},identity);
  }
  function collectUnclassifiedChatCache(identity, centralMessages, centralRooms, observedRaw) {
    try {
      captureChatRaw('fs_chats',observedRaw);
      var knownPending=Object.create(null), knownRooms=Object.create(null);
      (centralRooms || []).forEach(function (row) {var data=clone(row.data || {});data.jobId=row.job_id;delete data.messages;knownRooms[row.job_id]=data;});
      chatJournalItems().forEach(function (entry) { var item=entry.value;
        if (item.kind==='pending') knownPending[json([item.jobId,item.message])]=true;
      });
      function split(raw) {
        var rooms;
        try { rooms=JSON.parse(raw); } catch (_) { putChatItem({kind:'opaque',raw:raw}); return; }
        if (!Array.isArray(rooms)) { putChatItem({kind:'opaque',raw:raw}); return; }
        rooms.forEach(function (room) {
          if (!room || !room.jobId || !Array.isArray(room.messages || [])) { putChatItem({kind:'opaque',data:room}); return; }
          var data=clone(room); delete data.messages;
          var roomConfirmed=knownRooms[room.jobId] && json(knownRooms[room.jobId])===json(data);
          if (!roomConfirmed) putChatItem({kind:'unclassified-room',jobId:room.jobId,data:data});
          (room.messages || []).forEach(function (message) {
            if (!message || typeof message !== 'object') { putChatItem({kind:'opaque',jobId:room.jobId,data:message}); return; }
            var central=message.uid && centralMessages && centralMessages[room.jobId+'|'+message.uid];
            if (!knownPending[json([room.jobId,message])] && !(central && json(central)===json(message))) {
              putChatItem({kind:'unclassified-message',jobId:room.jobId,message:message});
            }
          });
        });
      }
      var legacyKey='fs_chat_unclassified_recovery_v1', legacy=localStorage.getItem(legacyKey);
      if (legacy) {
        captureChatRaw(legacyKey,legacy);
        var backup=JSON.parse(legacy); if (!backup || typeof backup.raw!=='string') throw new Error('legacy chat backup invalid');
        if (!chatAdapter() || !archivedChatRaw(legacyKey,legacy)) split(backup.raw);
        // Retain this original envelope; it is never deleted for headroom.
      }
      var raw=observedRaw===undefined ? localStorage.getItem('fs_chats') : observedRaw;
      if (raw && raw!=='[]' && raw!==chatGeneratedRaw && (!chatAdapter() || !archivedChatRaw('fs_chats',raw))) {captureChatRaw('fs_chats',raw);split(raw);}
      return true;
    } catch (error) {if (error.message==='chat-journal-not-ready') throw error;chatConnectionFailure('chat-preserve',error);return false;}
  }
  function failChatSave(cacheWrite) {
    invalidateChatStoragePause();chatSaveFailureEpoch++;chatRecoveryBlocked=true;window.__fsCentralReady=false;
    if (cacheWrite) sbReady=false;
    return false;
  }
  function assertChatSaveAttempt(epoch) {
    // The sealed apply ignores saveChats' return. A later successful stash or
    // save cannot erase an earlier failure in this same apply/read attempt.
    if (epoch===chatSaveFailureEpoch) return;
    chatRecoveryBlocked=true;sbReady=false;window.__fsCentralReady=false;
    throw new Error('chat cache save failed');
  }
  function writeChatCache(encoded) {
    try {localStorage.setItem('fs_chats',encoded);chatGeneratedRaw=encoded;return true;}
    catch (error) {
      // Metadata-only quota may retain the older cache after every original
      // and pending item was checked by the caller's preservation barrier.
      if (quotaError(error) && chatAdapter() && chatAdapter().status().state==='ready' && !chatRecoveryBlocked) {chatQuotaRecovered=true;return true;}
      throw error;
    }
  }
  function retireChatEntry(entry) {
    if (chatAdapter()) {
      if (!archivedChatRaw(entry.key,entry.raw)) {
        queueChatDurability({items:[],raws:[{sourceKey:entry.key,raw:entry.raw}],receipts:[]},visibleIdentity);
        throw new Error('chat-durability-pending');
      }
      // IndexedDB deletion is completed only by the async authorized preflight.
      if (entry.backend==='indexeddb' || entry.fallback) return;
    }
    if (localStorage.getItem(entry.key)===entry.raw) localStorage.removeItem(entry.key);
  }
  function chatConnectionFailure(stage, error) {
    try {
      var reason='unknown';
      if (quotaError(error)) reason='quota-exceeded';
      else if (error && error.name==='SyntaxError') reason='local-json-invalid';
      else switch (error && error.message) {
        case 'chat-durability-pending': reason='durability-pending'; break;
        case 'chat-journal-not-ready': reason='journal-not-ready'; break;
        case 'chat-journal-abort': reason='fallback-abort'; break;
        case 'chat-journal-readback': reason='fallback-readback'; break;
        case 'chat-journal-quota': reason='fallback-quota'; break;
        case 'chat recovery entry invalid': reason='journal-entry-invalid'; break;
        case 'chat recovery readback failed': reason='journal-readback-failed'; break;
        case 'chat recovery identity collision': reason='journal-identity-collision'; break;
        case 'legacy pending chat journal invalid': case 'legacy pending chat item invalid': reason='legacy-import-invalid'; break;
        case 'chat import receipt not durable': reason='import-receipt-not-durable'; break;
        case 'legacy chat backup invalid': reason='legacy-backup-invalid'; break;
      }
      diag('', 'connection:'+stage, reason);
    } catch (_) {}
  }
  function stashPendingForIdentity(identity) {
    return preserveChatWork(function () {return collectPendingForIdentity(identity);},identity,'chat-stash');
  }
  function collectPendingForIdentity(identity) {
    if (!identity) return true;
    if (visibleHistoryIdentity !== identity || typeof localStorage === 'undefined') { chatRecoveryBlocked = true; return false; }
    try {
      importLegacyPending(identity);
      (typeof chats !== 'undefined' && Array.isArray(chats) ? chats : []).forEach(function (room) {
        (room.messages || []).forEach(function (message) {
          var uid = typeof msgUid === 'function' ? msgUid(room.jobId,message) : message.uid;
          var copy=clone(message); copy.uid=uid;
          if (uid && json(confirmedChatData[room.jobId+'|'+uid] || null)!==json(copy)) {
            putChatItem({kind:'pending',identity:identity,jobId:room.jobId,message:copy});
          }
        });
      });
      if (!chatBatch) chatRecoveryBlocked = false;
      if (!chatBatch && window.__fsChatRecovery) window.__fsChatRecovery.refresh();
      return true;
    } catch (error) { chatRecoveryBlocked = true; chatConnectionFailure('chat-stash',error); return false; }
  }
  function setRecoveryDiagnostic(id, choice, stage, outcome) {
    recoveryDiagnostic = {id:id, choice:choice, stage:stage, outcome:outcome};
  }
  // Report the first gate that stopped the user to the gateway log. The user
  // sees an alert or a badge; the operator used to see nothing. Fire-and-forget,
  // read-only on the server, deduplicated per job/stage/reason for a minute.
  var diagnosticSent = {}, forbiddenRetried = {};
  function diag(id, stage, reason, detail) {
    try {
      var key = [id || '', stage, reason].join('|'), now = Date.now();
      if (diagnosticSent[key] && now - diagnosticSent[key] < 60000) return;
      diagnosticSent[key] = now;
      if (typeof window.fetch !== 'function') return;
      var body = JSON.stringify({job:id || '', stage:String(stage), reason:String(reason), detail:String(detail || '').slice(0,200)});
      var result = window.fetch('/__formula/client-diagnostic', {method:'POST', credentials:'same-origin', keepalive:true, headers:{'content-type':'application/json'}, body:body});
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (_) {}
  }
  // A room requested while the baseline was still loading opens by itself
  // once the page is ready (within two minutes of the request); otherwise the
  // request is dropped quietly and the person simply clicks again.
  function openPendingChat() {
    var pending = pendingChatOpen;
    if (!pending) return false;
    if (Date.now() - pending.at > 120000) { pendingChatOpen = null; delete notices[pending.id]; return false; }
    if (typeof window.__fsRuntimeBoot === 'function' && (window.__fsCentralReady !== true || window.__fsPermissionReady !== true)) return false;
    pendingChatOpen = null; delete notices[pending.id];
    if (!ready(pending.id)) { diag(pending.id, 'gate:openChatRoom', readyReason(pending.id), 'after-wait'); return false; }
    diag(pending.id, 'gate:openChatRoom', 'opened-after-wait');
    try { if (typeof window.openChatRoom === 'function') window.openChatRoom(pending.id); } catch (_) { return false; }
    return true;
  }
  // The first condition of ready() that fails, named for the log.
  function readyReason(id) {
    var r = records.find(function (x) { return x.id === id; }), p = queue[id];
    if (!actor) return 'no-actor';
    if (storageError) return 'storage-error';
    if (typeof window.__fsRuntimeBoot === 'function' && window.__fsCentralReady !== true) return 'central-not-ready';
    if (typeof window.__fsRuntimeBoot === 'function' && window.__fsPermissionReady !== true) return 'permission-not-ready';
    // A queued revision names the actionable state; the legacy suppression
    // marker is a consequence of that same pending revision.
    if (p) return 'queued:' + (p.variants && p.variants.length && p.status !== 'forbidden' ? 'variants' : (p.status || 'pending'));
    if (legacyBlocked(id)) return 'legacy-blocked';
    if (!valid(r)) return r ? 'invalid-record' : 'not-in-local';
    if (!canSeeRecord(r)) return 'not-visible';
    if (!own(confirmed, id)) return 'not-confirmed';
    if (json(confirmed[id]) !== json(r)) return 'local-differs';
    return 'unknown';
  }
  function recordActivity(value) {
    if (!value || typeof value.detail !== 'string' || !/^[A-Z]+[0-9]{5}$/.test(value.job || '')) return false;
    if (value.cat === 'job') return /^(ติด|ถอด) Tag$/.test(value.action || '')
      || ['สร้างชุดข้อมูลใหม่','แก้ไขชุดข้อมูล'].indexOf(value.action || '') >= 0
      // The section editor writes the same immutable job change, but gives
      // its Activity a human-readable section suffix, for example
      // "แก้ไขชุดข้อมูล (รายละเอียดสินค้า)". It must remain in the exact
      // record-and-Activity acknowledgement transaction.
      || /^แก้ไขชุดข้อมูล \([^\r\n()]+\)$/.test(value.action || '');
    return value.cat === 'formula' && ['แก้สูตรในห้องแชท','แก้สูตรในห้องแชท (กดบันทึก)','เพิ่มสารในสูตร (แชท)','ลบสารออกจากสูตร (แชท)','แก้สูตร (PD Modify Data)','เพิ่มสารในสูตร (PD Modify Data)','ลบสารออกจากสูตร (PD Modify Data)'].indexOf(value.action || '') >= 0;
  }
  function activitiesOf(value) {
    var list = Array.isArray(value) ? value : value ? [value] : [];
    return list.filter(recordActivity);
  }
  function mergeActivities(left, right) {
    var result = activitiesOf(left).slice();
    activitiesOf(right).forEach(function (activity) {
      if (!result.some(function (candidate) { return json(candidate) === json(activity); })) result.push(activity);
    });
    return result;
  }
  function storageFailure(error) {
    invalidateChatStoragePause();storageError = true;
    var detail = error ? [error.name, error.message].filter(Boolean).join(' ') : String(error || '');
    if (/quota|exceeded/i.test(detail)) storageProblem = 'พื้นที่เก็บข้อมูลของเบราว์เซอร์ไม่พอ';
    else if (/invalid pending revision|unexpected token|json/i.test(detail)) storageProblem = 'ข้อมูลฉบับรอส่งในเบราว์เซอร์อ่านไม่ได้';
    else storageProblem = 'เบราว์เซอร์ไม่อนุญาตให้เก็บฉบับรอส่ง';
  }
  function storageRecoveryMessage() {
    return (storageProblem || 'บันทึกใบงานในเครื่องไม่สำเร็จ') + ' · ข้อมูลยังไม่ยืนยันในระบบกลาง กรุณาสำรองใบงานก่อนโหลดใหม่หรือปิดหน้านี้';
  }
  function activityPayload(value) {
    var list = Array.isArray(value) ? value : value == null ? [] : [value];
    return list.every(recordActivity);
  }
  function keepActivities(value, removed) {
    var left = activitiesOf(value), sent = activitiesOf(removed);
    sent.forEach(function (activity) {
      var i = left.findIndex(function (candidate) { return json(candidate) === json(activity); });
      if (i >= 0) left.splice(i,1);
    });
    return left;
  }
  function valid(r) {
    return !!r && typeof r === 'object' && !Array.isArray(r)
      && /^[A-Z]+[0-9]{5}$/.test(r.id || '') && Array.isArray(r.rows)
      && [r.customer, r.brand].some(function (v) { return typeof v === 'string' && v.trim(); });
  }
  function classifyRecoveryLookup(result, id) {
    if (!Array.isArray(result)) return {kind:'invalid'};
    if (result.length === 0) return {kind:'empty'};
    if (result.length !== 1) return {kind:'invalid'};
    var row=result[0];
    if (!row || row.id !== id || !valid(row.data) || row.data.id !== id || !canSeeRecord(row.data)) return {kind:'invalid'};
    return {kind:'server',row:row};
  }
  function unknownExpected(v) { return !!(v && v.__fsJobSyncUnknownBaseline === true); }
  function baseline() {
    last = {};
    records.forEach(function (r) { if (r && r.id) last[r.id] = json(r); });
  }
  function protectRemovedCopies(d) {
    if (!d.full || d.partial) return;
    var received = {};
    (d.rec || []).forEach(function (r) { received[r.id] = true; });
    var removed = records.filter(function (r) {
      return r && r.id && !received[r.id] && sbSnap.records[r.id] && !own(queue, r.id);
    });
    if (!removed.length) return;
    try {
      // The legacy history writer may prune again while applying other changed
      // rows. Keep a separate immutable copy outside that capped history first.
      removed.forEach(function (r) {
        var prefix = 'fs_job_recovery_v1:' + encodeURIComponent(actor) + ':' + r.id + ':';
        for (var n = 0; n < localStorage.length; n++) {
          var name = localStorage.key(n);
          if (!name || name.indexOf(prefix) !== 0) continue;
          try {
            var previous = JSON.parse(localStorage.getItem(name));
            if (previous && previous.version === 1 && previous.owner === actor && previous.id === r.id && json(previous.data) === json(r)) return;
          } catch (_) {} // Preserve an unreadable candidate rather than deleting it.
        }
        var value = JSON.stringify({version:1, owner:actor, id:r.id, data:clone(r), at:Date.now(), why:'before-full-pull-removal'});
        var key = prefix + nonce(), collision = 0;
        while (localStorage.getItem(key) !== null) {
          if (++collision > 100) throw new Error('recovery key collision');
          key = prefix + nonce() + ':' + collision;
        }
        localStorage.setItem(key, value);
        if (localStorage.getItem(key) !== value) throw new Error('immutable recovery copy not persisted');
      });
      removed.forEach(function (r) { bakRecord(clone(r), 'เก็บก่อนอัปเดตรายการใบงานจากระบบกลาง'); });
      saveRecBak();
      var saved = JSON.parse(localStorage.getItem(RECBAK_KEY) || '{}');
      if (!removed.every(function (r) {
        return Array.isArray(saved[r.id]) && saved[r.id].some(function (v) { return json(v.data) === json(r); });
      })) throw new Error('original copy not persisted');
    } catch (_) {
      if (typeof sbLastFull !== 'undefined') sbLastFull = 0;
      window.alert('เก็บสำเนาใบงานก่อนอัปเดตรายการไม่สำเร็จ จึงยังเก็บใบงานเดิมไว้ในหน้านี้ กรุณาสำรองข้อมูลก่อนโหลดใหม่หรือปิดหน้านี้');
      throw new Error('เก็บสำเนาใบงานไม่สำเร็จ จึงยังไม่อัปเดตรายการ');
    }
  }
  var tab = '', ownedKeys = {};
  function nonce() {
    return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  }
  try { tab = sessionStorage.getItem('fs_job_sync_tab_v1') || nonce(); sessionStorage.setItem('fs_job_sync_tab_v1',tab); }
  catch (_) { tab = nonce(); }
  function key() { return KEY + encodeURIComponent(actor) + ':'; }
  function quotaError(error) {
    // A message such as "quota" from a denied/blocked store is not enough:
    // only the browser's named quota condition may use the fallback route.
    return !!error && error.name === 'QuotaExceededError';
  }
  // "Read" state of chat rooms lives only in this browser (the sealed page
  // keeps c.seen out of the server payload on purpose) inside the one big
  // fs_chats key together with every message of every visible room. For a
  // role that sees all rooms that key is several MB, and the sealed
  // saveChats() swallows the quota error — the bell then rings on every room
  // after each reload (RD, 14 ต.ค. 2569). Keep the seen map in its own small
  // key per user and restore it into the chat objects after every load/pull.
  var SEEN_KEY = 'fs_chat_seen_v1:', SEEN_DB = 'fs_chat_seen_v1', SEEN_STORE = 'seen';
  // localStorage can be completely full (16:21 เชอรี่: even the small seen key
  // failed with quota-exceeded). IndexedDB has its own, far larger budget, so
  // the map is mirrored there and read back at startup; the in-memory cache
  // keeps the two sources merged for this page.
  var seenCache = {}, seenCacheUser = '', seenDbLoaded = false, seenDbUser = '', baselineWanted = null;
  function seenKey() { return SEEN_KEY + encodeURIComponent(currentUser || ''); }
  function seenMap(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function mergeSeen(target, source) {
    Object.keys(source || {}).forEach(function (id) {
      var at = Number(source[id]) || 0;
      if (at && (Number(target[id]) || 0) < at) target[id] = at;
    });
    return target;
  }
  function seenCacheFor() {
    if (seenCacheUser !== (currentUser || '')) { seenCache = {}; seenCacheUser = currentUser || ''; seenDbLoaded = false; }
    return seenCache;
  }
  function readSeen() {
    var map = {};
    try { map = mergeSeen(map, seenMap(JSON.parse(localStorage.getItem(seenKey()) || '{}'))); } catch (_) {}
    return mergeSeen(map, seenCacheFor());
  }
  function seenDbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB || typeof window.indexedDB.open !== 'function') { reject(new Error('IndexedDB unavailable')); return; }
      var request;
      try { request = window.indexedDB.open(SEEN_DB, 1); } catch (error) { reject(error); return; }
      request.onupgradeneeded = function (event) { var db = event.target.result; if (!db.objectStoreNames.contains(SEEN_STORE)) db.createObjectStore(SEEN_STORE); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }
  function seenDbWrite(user, map) {
    return seenDbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(SEEN_STORE, 'readwrite'); tx.objectStore(SEEN_STORE).put(map, user); } catch (error) { reject(error); return; }
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB write failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB write aborted')); };
        tx.oncomplete = function () { resolve(); };
      });
    });
  }
  function seenDbRead(user) {
    return seenDbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, request;
        try { tx = db.transaction(SEEN_STORE, 'readonly'); request = tx.objectStore(SEEN_STORE).get(user); } catch (error) { reject(error); return; }
        request.onerror = function () { reject(request.error || new Error('IndexedDB read failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB read aborted')); };
        tx.oncomplete = function () { resolve(seenMap(request.result)); };
      });
    });
  }
  // Load the durable map for the current user, then restore it into the rooms.
  // A baseline requested while this was still pending is decided afterwards.
  function loadSeen() {
    var user = currentUser || '';
    if (!user || (seenDbLoaded && seenDbUser === user)) return Promise.resolve(false);
    seenDbUser = user;
    return seenDbRead(user).then(function (map) {
      if ((currentUser || '') !== user) return false;
      mergeSeen(seenCacheFor(), map); seenDbLoaded = true;
      var changed = hydrateSeen();
      if (baselineWanted) { var error = baselineWanted; baselineWanted = null; if (baselineSeen(error)) changed = true; }
      if (changed && typeof renderChatMenu === 'function') { try { renderChatMenu(); } catch (_) {} }
      return changed;
    }).catch(function () { if ((currentUser || '') === user) seenDbLoaded = true; return false; });
  }
  function storeSeen(map) {
    mergeSeen(seenCacheFor(), map);
    var local = true;
    try { localStorage.setItem(seenKey(), JSON.stringify(map)); }
    catch (error) { local = false; diag('', 'chat-seen-storage', quotaError(error) ? 'quota-exceeded' : 'write-failed', 'indexeddb-fallback'); }
    var durable = seenDbWrite(currentUser || '', clone(map)).then(function () { return true; })
      .catch(function () { if (!local) diag('', 'chat-seen-storage', 'indexeddb-failed'); return local; });
    return durable;
  }
  function chatList() { return typeof chats !== 'undefined' && Array.isArray(chats) ? chats : []; }
  function hydrateSeen() {
    if (!currentUser) return false;
    var stored = readSeen(), changed = false;
    chatList().forEach(function (c) {
      if (!c || !c.jobId) return;
      var at = Number(stored[c.jobId]) || 0;
      if (!at) return;
      c.seen = c.seen || {};
      if ((Number(c.seen[currentUser]) || 0) < at) { c.seen[currentUser] = at; changed = true; }
    });
    return changed;
  }
  function persistSeen() {
    if (!currentUser) return true;
    var stored = readSeen(), changed = false;
    chatList().forEach(function (c) {
      var at = c && c.seen && Number(c.seen[currentUser]) || 0;
      if (at && (Number(stored[c.jobId]) || 0) < at) { stored[c.jobId] = at; changed = true; }
    });
    if (!changed) return true;
    storeSeen(stored);
    return true;
  }
  var chatStorageReported = 0;
  function reportChatStorage(error, size) {
    baselineSeen(error);
    if (Date.now() - chatStorageReported < 600000) return;
    chatStorageReported = Date.now();
    diag('', 'chat-storage', quotaError(error) ? 'quota-exceeded' : 'write-failed', 'fs_chats chars=' + size);
  }
  // A browser whose fs_chats write hits the quota never persisted any read
  // state, so every room rings after each reload and nothing can tell which
  // rooms were actually read (14 ต.ค. 2569: admin, pd and rd all reported
  // quota-exceeded with ~1.8M chars). The pre-incident state is unrecoverable;
  // the closest honest restore is "everything visible now counts as read,
  // from now on only new activity rings". Done once, only when the durable
  // seen map does not exist yet, and reported to the gateway log.
  function baselineSeen(error) {
    if (!currentUser || !quotaError(error)) return false;
    // "No durable map" is only known once IndexedDB has answered.
    if (!seenDbLoaded) { baselineWanted = error; return false; }
    // A map that already exists may still be the few rooms opened after the
    // storage fix landed while the other 130 keep ringing (17:00: admin, pd, rd
    // all had a partial map). The marker records that the one-time baseline
    // ran; rooms the user already read keep their own, possibly later, time.
    var current = readSeen();
    if (current.__baseline) return false;
    var now = typeof nowTs === 'function' ? nowTs() : Date.now(), stored = {}, count = 0;
    chatList().forEach(function (c) {
      if (!c || !c.jobId) return;
      var last = typeof chatLastTs === 'function' ? Number(chatLastTs(c)) || 0 : 0;
      var at = Math.max(now, last, c.seen && Number(c.seen[currentUser]) || 0, Number(current[c.jobId]) || 0);
      c.seen = c.seen || {}; c.seen[currentUser] = at; stored[c.jobId] = at; count++;
    });
    if (!count) return false;
    stored.__baseline = now;
    storeSeen(stored);
    diag('', 'chat-seen-baseline', 'quota-exceeded', 'rooms=' + count);
    if (typeof renderChatMenu === 'function') { try { renderChatMenu(); } catch (_) {} }
    return true;
  }
  // fs_chats is ~1.8M characters because every message of every visible room
  // is kept inside it, yet every message that central has acknowledged is
  // pulled back from fs_messages on the next full pull. When the write hits
  // the quota, store the rooms with only their not-yet-acknowledged messages;
  // nothing the server does not already hold is dropped. Also report what is
  // using the space, so the next decision is made on numbers.
  var slimReported = 0, compactReported = false;
  function storageProfile() {
    var sizes = {}, total = 0;
    try {
      for (var n = 0; n < localStorage.length; n++) {
        var name = localStorage.key(n), value = localStorage.getItem(name) || '';
        var group = /^fs_job_outbox_v1:/.test(name) ? 'outbox' : /^fs_job_recovery_v1:/.test(name) ? 'recovery' : /^fs_chat_seen_v1:/.test(name) ? 'seen' : /^fs_chat_pending_v1:/.test(name) ? 'chat-pending' : /^fs_chat_journal_v2:/.test(name) ? 'chat-journal' : /^fs_chat_imported_v2:/.test(name) ? 'chat-receipts' : /^fs_/.test(name) ? name : 'other';
        sizes[group] = (sizes[group] || 0) + value.length; total += value.length;
      }
    } catch (_) {}
    return Object.keys(sizes).sort(function (a, b) { return sizes[b] - sizes[a]; }).slice(0, 6).map(function (k) { return k + '=' + sizes[k]; }).join(' ') + ' total=' + total;
  }
  // The room store without the messages central already acknowledged. Those
  // messages come back from fs_messages on the next pull; only unsent ones
  // need the browser's copy. null when the acknowledgement map is not there yet.
  function slimChats() {
    if (typeof sbSnap === 'undefined' || !sbSnap || !sbSnap.msgs || typeof msgUid !== 'function') return null;
    return chatList().map(function (c) {
      if (!c || !Array.isArray(c.messages)) return c;
      var keep = c.messages.filter(function (m) { return !sbSnap.msgs[msgUid(c.jobId, m)]; });
      if (keep.length === c.messages.length) return c;
      var copy = {}; Object.keys(c).forEach(function (k) { copy[k] = c[k]; }); copy.messages = keep; return copy;
    });
  }
  function slimChatStore(before) {
    var slim = slimChats();
    if (!slim) return false;
    var encoded = '';
    try { encoded = JSON.stringify(slim); writeChatCache(encoded); }
    catch (error) {
      if (Date.now() - slimReported > 600000) { slimReported = Date.now(); diag('', 'chat-storage', 'slim-failed', storageProfile()); }
      return false;
    }
    if (Date.now() - slimReported > 600000) { slimReported = Date.now(); diag('', 'chat-storage', 'slimmed', 'fs_chats ' + before + '->' + encoded.length + ' ' + storageProfile()); }
    return true;
  }
  // After a deploy a tab left open keeps running the old asset (14 ต.ค. 2569:
  // every fix needed "please reload" by hand). The page carries the versions
  // it was served with (window.__fsAssetVersions, injected by the proxy);
  // compare them with /__formula/health every few minutes and when the tab
  // becomes visible. An idle page reloads itself; a page with unsent work, an
  // open modal, a focused field or a chat draft only shows a bar to reload
  // when ready, and is re-checked later. Never more than one reload per
  // version, and nothing is ever discarded.
  var VERSION_CHECK_MS = 5 * 60 * 1000, versionBusy = null, versionReloadFor = '', versionWatchStarted = false;
  function servedVersions() {
    var v = window.__fsAssetVersions;
    return v && typeof v === 'object' ? v : null;
  }
  function pageIdle() {
    if (Object.keys(queue).length || Object.keys(fallbackStaging).length || Object.keys(recTouched || {}).length) return false;
    if (typeof generatorTransaction !== 'undefined' && generatorTransaction) return false;
    if (!document) return true;
    var modal = document.getElementById('gModal');
    if (modal && !modal.hidden && !(modal.style && modal.style.display === 'none') && !(modal.classList && modal.classList.contains('hidden'))) return false;
    var active = document.activeElement, tag = active && String(active.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return false;
    // Walk the tree rather than query it: a draft in any textarea counts.
    var busy = false;
    (function walk(node, depth) {
      if (busy || !node || depth > 40) return;
      if (String(node.tagName || '').toUpperCase() === 'TEXTAREA' && String(node.value || '').trim()) { busy = true; return; }
      var children = node.children || [];
      for (var i = 0; i < children.length && !busy; i++) walk(children[i], depth + 1);
    })(document.body, 0);
    return !busy;
  }
  function versionBar(show, current, served) {
    if (!document || !document.body) return;
    var bar = document.getElementById('fsVersionBar');
    if (!show) { if (bar && bar.remove) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'fsVersionBar'; bar.setAttribute('role','status'); bar.setAttribute('aria-live','polite');
      bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:1101;box-sizing:border-box;max-width:calc(100vw - 24px);padding:10px 14px;border:1px solid #1d4ed8;border-radius:8px;background:#eff6ff;color:#1e3a8a;font:14px sans-serif;box-shadow:0 2px 8px #0002';
      var text = document.createElement('span'); text.id = 'fsVersionBarText'; bar.appendChild(text);
      var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-s btn-sm'; button.textContent = 'โหลดหน้าใหม่';
      button.style.cssText = 'min-height:36px;margin-left:8px;padding:6px 10px;border:1px solid #1d4ed8;border-radius:6px;background:white;color:#1e3a8a;cursor:pointer';
      button.onclick = function () { diag('', 'version-reload', 'manual', current + '->' + served); if (window.location && typeof window.location.reload === 'function') window.location.reload(); };
      bar.appendChild(button); document.body.appendChild(bar);
    }
    document.getElementById('fsVersionBarText').textContent = 'มีรุ่นใหม่ของ Formula · หน้านี้มีงานค้างจึงยังไม่โหลดใหม่ให้เอง กดเมื่อพร้อม';
  }
  async function checkVersion() {
    if (versionBusy) return versionBusy;
    versionBusy = (async function () {
      var served = servedVersions();
      if (!served || typeof window.fetch !== 'function') return 'unknown';
      var response, health;
      try {
        response = await window.fetch('/__formula/health', {method:'GET', credentials:'same-origin', cache:'no-store', headers:{Accept:'application/json'}});
        if (!response || !response.ok) return 'unavailable';
        health = await response.json();
      } catch (_) { return 'unavailable'; }
      var live = health && health.assets && typeof health.assets === 'object' ? health.assets : null;
      if (!live) return 'unknown';
      var changed = Object.keys(served).filter(function (route) { return live[route] && live[route] !== served[route]; });
      if (!changed.length) { versionBar(false); return 'current'; }
      var current = changed.map(function (r) { return served[r]; }).join(','), next = changed.map(function (r) { return live[r]; }).join(',');
      if (versionReloadFor === next) return 'reloading';
      if (pageIdle()) {
        versionReloadFor = next;
        diag('', 'version-reload', 'auto', current + '->' + next);
        if (window.location && typeof window.location.reload === 'function') window.location.reload();
        return 'reloading';
      }
      versionBar(true, current, next);
      diag('', 'version-reload', 'deferred', current + '->' + next);
      return 'deferred';
    })();
    try { return await versionBusy; } finally { versionBusy = null; }
  }
  function startVersionWatch() {
    if (versionWatchStarted || !servedVersions()) return;
    versionWatchStarted = true;
    try {
      if (typeof setInterval === 'function') { var timer = setInterval(function () { checkVersion(); }, VERSION_CHECK_MS); if (timer && typeof timer.unref === 'function') timer.unref(); }
      if (document && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkVersion(); });
    } catch (_) {}
  }
  function exact(left,right) { return json(left) === json(right); }
  function normalizedEmail(value) { return String(value || '').trim().toLowerCase(); }
  // The same name rule the gateway applies (storedJobOwner): exact createdBy,
  // or salesOwner/currentUser equal after the "15.Sales ..." prefix is dropped.
  function legacyOwner(r) {
    if (!r || !currentUser) return false;
    if (String(r.createdBy || '').trim() === String(currentUser).trim()) return true;
    var norm = typeof fsOwnerName === 'function' ? fsOwnerName
      : function (v) { return String(v || '').replace(/^\d+\./, '').replace(/^(Sales|MKT)\s*/i, '').replace(/^พี่/, '').trim().toLowerCase(); };
    var owner = norm(r.salesOwner), me = norm(currentUser);
    return !!owner && !!me && owner === me;
  }
  function trustedSessionEmail() {
    return normalizedEmail(sessionEmail || (window.__fsSessionIdentity && window.__fsSessionIdentity.email));
  }
  function trustedKey(session, owner) {
    if (!session || !session.authenticated || typeof session.name !== 'string' || session.name !== owner
      || typeof session.centralUserId !== 'string' || !session.centralUserId) return null;
    var email = normalizedEmail(session.email);
    return email
      ? json([session.name,session.centralUserId,session.role || '',email])
      : json([session.name,session.centralUserId,session.role || '']);
  }
  function legacyTrustedKey(session, owner) {
    if (!session || typeof session.name !== 'string' || session.name !== owner
      || typeof session.centralUserId !== 'string' || !session.centralUserId) return null;
    return json([session.name,session.centralUserId,session.role || '']);
  }
  function identityMatches(identity, session, owner) {
    return identity === trustedKey(session, owner)
      || (!normalizedEmail(session && session.email) && identity === legacyTrustedKey(session, owner));
  }
  function readWithinDeadline(operation, timeoutMs) {
    var timer;
    if (!delegatedRuntime) return operation();
    return Promise.race([operation(), new Promise(function (_, reject) {
      timer = setTimeout(function () { var error = new Error('central read timed out'); error.status = 408; reject(error); }, timeoutMs || 15000);
    })]).finally(function () { if (typeof clearTimeout==='function') clearTimeout(timer); });
  }
  async function trustedSession(owner) {
    // sbReq always prefixes /sb/rest/v1. The session gate intentionally lives
    // outside that REST gateway, so use the same direct same-origin route as
    // the session bridge instead of turning it into /sb/rest/v1/sb/session.
    var fetchSession = window.__fsSessionFetch || window.fetch;
    if (!fetchSession || typeof fetchSession !== 'function') throw new Error('trusted session unavailable');
    var read = await readWithinDeadline(async function () {
      var response=await fetchSession('/sb/session',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      return {response:response,data:await response.json().catch(function () { return {}; })};
    });
    var response=read.response, session=read.data;
    if (!response.ok || currentUser !== owner || actor !== owner) { var denied = new Error('trusted session changed'); denied.status = response.status; throw denied; }
    var identity = trustedKey(session,owner);
    if (!identity) throw new Error('trusted session unavailable');
    sessionEmail = normalizedEmail(session.email);
    if (sessionEmail) window.__fsSessionIdentity = {email:sessionEmail};
    return {owner:owner,identity:identity,name:session.name,role:session.role || '',email:sessionEmail,
      centralUserId:session.centralUserId,authenticated:true};
  }
  function idbOpen() {
    return new Promise(function(resolve,reject) {
      if (!window.indexedDB || typeof window.indexedDB.open !== 'function') { reject(new Error('IndexedDB unavailable')); return; }
      var request;
      try { request = window.indexedDB.open(FALLBACK_DB,1); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(FALLBACK_STORE)) db.createObjectStore(FALLBACK_STORE);
      };
      request.onerror = function() { reject(request.error || new Error('IndexedDB open failed')); };
      request.onsuccess = function() { resolve(request.result); };
    });
  }
  function idbWrite(db,key,value) {
    return new Promise(function(resolve,reject) {
      var tx;
      try { tx = db.transaction(FALLBACK_STORE,'readwrite'); tx.objectStore(FALLBACK_STORE).put(value,key); }
      catch (error) { reject(error); return; }
      tx.onerror = function() { reject(tx.error || new Error('IndexedDB write failed')); };
      tx.onabort = function() { reject(tx.error || new Error('IndexedDB write aborted')); };
      tx.oncomplete = function() { resolve(); };
    });
  }
  function idbRead(db,key) {
    return new Promise(function(resolve,reject) {
      var tx, request;
      try { tx = db.transaction(FALLBACK_STORE,'readonly'); request = tx.objectStore(FALLBACK_STORE).get(key); }
      catch (error) { reject(error); return; }
      request.onerror = function() { reject(request.error || new Error('IndexedDB read failed')); };
      tx.onerror = function() { reject(tx.error || new Error('IndexedDB read failed')); };
      tx.onabort = function() { reject(tx.error || new Error('IndexedDB read aborted')); };
      tx.oncomplete = function() { resolve(request.result); };
    });
  }
  function idbDeleteExact(db,key,expected) {
    return idbRead(db,key).then(function(value) {
      if (!value || !exact(value,expected)) throw new Error('fallback revision changed');
      return new Promise(function(resolve,reject) {
        var tx;
        try { tx=db.transaction(FALLBACK_STORE,'readwrite'); tx.objectStore(FALLBACK_STORE).delete(key); }
        catch (error) { reject(error); return; }
        tx.onerror=function(){ reject(tx.error || new Error('IndexedDB delete failed')); };
        tx.onabort=function(){ reject(tx.error || new Error('IndexedDB delete aborted')); };
        tx.oncomplete=function(){ resolve(); };
      });
    });
  }
  function finalizeActivities(value) {
    return activitiesOf(value).map(function(activity) {
      var final = clone(activity);
      if (typeof final.ts !== 'number') final.ts = typeof nowTs === 'function' ? nowTs() : Date.now();
      if (typeof final.uid !== 'string' || !final.uid) {
        if (typeof actUid !== 'function') throw new Error('activity identity unavailable');
        actUid(final);
      }
      if (typeof final.uid !== 'string' || !final.uid || typeof final.ts !== 'number') throw new Error('invalid activity identity');
      return final;
    });
  }
  function legacyConflict(snapshot) {
    for (var n=0;n<localStorage.length;n++) {
      var name=localStorage.key(n); if (!name || name.indexOf(key()) !== 0) continue;
      try {
        var item=JSON.parse(localStorage.getItem(name));
        if (item && item.id === snapshot.id && !exact([item.data,item.expected],[snapshot.data,snapshot.expected])) return true;
      } catch (_) { return true; }
    }
    return false;
  }
  function fallbackEntry(snapshot,session) {
    var revision = json([snapshot.data,snapshot.expected,snapshot.activities]);
    return {version:1,owner:actor,identity:session.identity,actor:{name:session.name,role:session.role,email:session.email},id:snapshot.id,tab:tab,revision:revision,
      data:clone(snapshot.data),expected:clone(snapshot.expected),activities:clone(snapshot.activities),recordAck:false,status:'fallback-verified'};
  }
  function fallbackKey(entry) { return entry.identity + ':' + entry.id + ':' + entry.tab + ':' + entry.revision; }
  function fallbackIndexKey() { return FALLBACK_INDEX + encodeURIComponent(actor); }
  function fallbackIndex() {
    try { var list=JSON.parse(sessionStorage.getItem(fallbackIndexKey()) || '[]'); return Array.isArray(list) ? list : []; }
    catch (_) { return []; }
  }
  function fallbackPendingFor(id) {
    if (fallback[id] || fallbackStaging[id]) return true;
    try {
      var raw = sessionStorage.getItem(fallbackIndexKey());
      if (raw === null) return false;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return true;
      if (list.some(function (item) { return !item || typeof item.id !== 'string' || typeof item.key !== 'string'; })) return true;
      return list.some(function (item) { return item.id === id; });
    } catch (_) { return true; }
  }
  function canOmitVerifiedRecord(id, data) {
    return !!id && !storageError && !queue[id] && !own(recTouched || {}, id) && !fallbackPendingFor(id)
      && json(records.find(function (row) { return row && row.id === id; }) || null) === json(data);
  }
  function readRecordCacheOmissions() {
    var raw = localStorage.getItem(RECORD_CACHE_OMISSIONS);
    if (raw === null) return [];
    var marker = JSON.parse(raw);
    if (!marker || marker.version !== 1 || !Array.isArray(marker.entries)) throw new Error('record cache omission marker invalid');
    var seen = Object.create(null);
    marker.entries.forEach(function (entry) {
      if (!entry || typeof entry.id !== 'string' || !/^[A-Z]+[0-9]{5}$/.test(entry.id)
        || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || own(seen,entry.id)) {
        throw new Error('record cache omission entry invalid');
      }
      seen[entry.id] = true;
    });
    return marker.entries;
  }
  function sha256RecordData(data) {
    var input = unescape(encodeURIComponent(json(data))), size = Math.ceil((input.length + 9) / 64) * 64;
    var bytes = new Uint8Array(size), view = new DataView(bytes.buffer), words = [];
    for (var i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i);
    bytes[input.length] = 0x80;
    view.setUint32(size - 4, input.length * 8, false);
    for (i = 0; i < size; i += 4) words.push(view.getUint32(i,false));
    var k = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
    var h = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225], w = new Array(64);
    function rotr(x,n) { return (x >>> n) | (x << (32-n)); }
    for (var offset = 0; offset < words.length; offset += 16) {
      for (i = 0; i < 16; i++) w[i] = words[offset+i] || 0;
      for (i = 16; i < 64; i++) { var x=w[i-15], y=w[i-2], s0=rotr(x,7)^rotr(x,18)^(x>>>3), s1=rotr(y,17)^rotr(y,19)^(y>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)|0; }
      var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],q=h[7];
      for (i = 0; i < 64; i++) { var S1=rotr(e,6)^rotr(e,11)^rotr(e,25), ch=(e&f)^(~e&g), t1=(q+S1+ch+k[i]+w[i])|0, S0=rotr(a,2)^rotr(a,13)^rotr(a,22), maj=(a&b)^(a&c)^(b&c), t2=(S0+maj)|0; q=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0; }
      h=[(h[0]+a)|0,(h[1]+b)|0,(h[2]+c)|0,(h[3]+d)|0,(h[4]+e)|0,(h[5]+f)|0,(h[6]+g)|0,(h[7]+q)|0];
    }
    return h.map(function (v) { return ('00000000'+(v>>>0).toString(16)).slice(-8); }).join('');
  }
  function writeRecordCacheOmissions(prior, entries) {
    var encoded = JSON.stringify({version:1,entries:entries});
    try {
      if (localStorage.getItem(RECORD_CACHE_OMISSIONS) !== prior) return false;
      localStorage.setItem(RECORD_CACHE_OMISSIONS,encoded);
      return localStorage.getItem(RECORD_CACHE_OMISSIONS) === encoded;
    } catch (_) {
      try { if (localStorage.getItem(RECORD_CACHE_OMISSIONS) === encoded) { if (prior === null) localStorage.removeItem(RECORD_CACHE_OMISSIONS); else localStorage.setItem(RECORD_CACHE_OMISSIONS,prior); } } catch (_) {}
      return false;
    }
  }
  function rememberRecordCacheOmission(id, data) {
    var prior, ids, encoded;
    try {
      prior = localStorage.getItem(RECORD_CACHE_OMISSIONS);
      ids = readRecordCacheOmissions();
      var entry = {id:id,sha256:sha256RecordData(data)}, index=ids.findIndex(function (item) { return item.id === id; });
      if (index >= 0 && ids[index].sha256 === entry.sha256) return true;
      if (index >= 0) ids[index] = entry; else ids.push(entry);
      encoded = JSON.stringify({version:1,entries:ids});
      if (!writeRecordCacheOmissions(prior,ids)) throw new Error('record cache omission marker write failed');
      return localStorage.getItem(RECORD_CACHE_OMISSIONS) === encoded;
    } catch (_) {
      return false;
    }
  }
  function forgetRecordCacheOmission(id) {
    var prior, entries;
    try { prior=localStorage.getItem(RECORD_CACHE_OMISSIONS); entries=readRecordCacheOmissions(); } catch (_) { return false; }
    var next=entries.filter(function (entry) { return entry.id !== id; });
    return next.length === entries.length || writeRecordCacheOmissions(prior,next);
  }
  function validRecordCacheRows(raw) {
    var rows;
    try { rows = JSON.parse(raw); } catch (_) { return null; }
    if (!Array.isArray(rows)) return null;
    var seen = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string'
        || !/^[A-Z]+[0-9]{5}$/.test(row.id) || own(seen,row.id)) return null;
      seen[row.id] = true;
    }
    return rows;
  }
  function writeRecordCacheRows(prior, rows) {
    var encoded;
    try { encoded = JSON.stringify(rows); } catch (_) { return false; }
    if (prior === encoded) return true;
    try {
      // Re-read immediately before replacement. localStorage has no compare-
      // and-swap, so any observed concurrent write aborts this compaction.
      if (localStorage.getItem('fs_records') !== prior) return false;
      localStorage.setItem('fs_records', encoded);
      if (localStorage.getItem('fs_records') !== encoded) throw new Error('record cache compaction readback mismatch');
      return true;
    } catch (_) {
      // A failing storage implementation can commit before throwing. Never
      // restore stale bytes over a newer sibling-tab write.
      try {
        if (localStorage.getItem('fs_records') === encoded) {
          if (prior === null) localStorage.removeItem('fs_records');
          else localStorage.setItem('fs_records', prior);
        }
      } catch (_) {}
      return false;
    }
  }
  function applyRecordCacheOmissions() {
    var prior, markerPrior, ids, rows;
    try {
      prior = localStorage.getItem('fs_records');
      if (prior === null) return false;
      markerPrior = localStorage.getItem(RECORD_CACHE_OMISSIONS);
      ids = readRecordCacheOmissions();
      rows = validRecordCacheRows(prior);
    } catch (_) {
      try { if (markerPrior !== null && localStorage.getItem(RECORD_CACHE_OMISSIONS) === markerPrior) localStorage.removeItem(RECORD_CACHE_OMISSIONS); } catch (_) {}
      return false;
    }
    if (!rows) return false;
    var removable = Object.create(null), retained=[], markerChanged=false;
    ids.forEach(function (entry) {
      var id=entry.id;
      if (queue[id] || own(recTouched || {}, id) || fallbackPendingFor(id)) { markerChanged=true; return; }
      var local = Array.isArray(records) && records.find(function (row) { return row && row.id === id; });
      var durable = rows.find(function (row) { return row.id === id; });
      // An omission survives reload only for the same canonical data revision.
      if (local && durable && sha256RecordData(local) === entry.sha256 && sha256RecordData(durable) === entry.sha256) {
        removable[id] = true; retained.push(entry);
      } else markerChanged=true;
    });
    if (markerChanged && !writeRecordCacheOmissions(markerPrior,retained)) return false;
    if (!Object.keys(removable).length) return true;
    return writeRecordCacheRows(prior, rows.filter(function (row) { return !removable[row.id]; }));
  }
  function compactVerifiedRecordCache() {
    if (!Object.keys(verifiedRecordCache).length || typeof records === 'undefined' || !Array.isArray(records)) return false;
    var prior, rows;
    try { prior = localStorage.getItem('fs_records'); rows = prior === null ? [] : validRecordCacheRows(prior); } catch (_) { return false; }
    if (!rows) return false;
    var removable = Object.create(null), proofIds = Object.keys(verifiedRecordCache);
    for (var i = 0; i < proofIds.length; i++) {
      var id = proofIds[i], matches = rows.filter(function (row) { return row.id === id; });
      var local = records.find(function (row) { return row && row.id === id; });
      if (!canOmitVerifiedRecord(id, local) || (matches.length && json(matches[0]) !== verifiedRecordCache[id])) {
        delete verifiedRecordCache[id];
        continue;
      }
      if (matches.length > 1) return false;
      if (!rememberRecordCacheOmission(id, local)) continue;
      removable[id] = true;
    }
    if (!Object.keys(removable).length) return false;
    return writeRecordCacheRows(prior, rows.filter(function (row) { return !removable[row.id]; }));
  }
  async function verifyCentralRecord(id, expectedData) {
    switchActor();
    var owner = actor, generation = visibleGeneration, snapshot;
    if (!owner || currentUser !== owner || typeof id !== 'string' || !/^[A-Z]+[0-9]{5}$/.test(id)) return false;
    try { snapshot = clone(expectedData); } catch (_) { return false; }
    if (!valid(snapshot) || snapshot.id !== id || !canOmitVerifiedRecord(id, snapshot)) return false;
    try {
      var before = await trustedSession(owner);
      if (!canOmitVerifiedRecord(id, snapshot)) return false;
      var result = await sbReq('fs_records?id=eq.' + encodeURIComponent(id) + '&select=id,data', {method:'GET'});
      if (currentUser !== owner || actor !== owner || generation !== visibleGeneration || !Array.isArray(result) || result.length !== 1) return false;
      var row = result[0];
      if (!row || row.id !== id || !valid(row.data) || row.data.id !== id || json(row.data) !== json(snapshot)) return false;
      var after = await trustedSession(owner);
      if (before.identity !== after.identity || !canOmitVerifiedRecord(id, snapshot)) return false;
      return true;
    } catch (_) { return false; }
  }
  function rememberFallback(entry,key) {
    try {
      var list=fallbackIndex().filter(function(item){ return item && item.key !== key; });
      list.push({id:entry.id,key:key,identity:entry.identity});
      var encoded=JSON.stringify(list); sessionStorage.setItem(fallbackIndexKey(),encoded);
      return sessionStorage.getItem(fallbackIndexKey()) === encoded;
    } catch (_) { return false; } // Without a same-actor locator, durable recovery is not ready.
  }
  function forgetFallbackIndex(key) {
    try { sessionStorage.setItem(fallbackIndexKey(),JSON.stringify(fallbackIndex().filter(function(item){return item && item.key !== key;}))); } catch (_) {}
  }
  async function resumeFallback(owner) {
    var list=fallbackIndex(); if (!list.length) return false;
    var session=await trustedSession(owner), identity=session.identity, db=await idbOpen(), restored=false;
    for (var n=0;n<list.length;n++) {
      var item=list[n]; if (!item || typeof item.key !== 'string') continue;
      // One stale/corrupt locator must not prevent later valid journals from
      // being restored. The caller still keeps the corrupt entry fail-closed;
      // this loop only isolates it from unrelated same-actor revisions.
      var entry;
      try { entry=await idbRead(db,item.key); } catch (_) { continue; }
      if (!entry || entry.owner !== owner || !identityMatches(entry.identity, session, owner) || entry.id !== item.id || fallbackKey(entry) !== item.key) continue;
      fallback[entry.id]={db:db,key:item.key,entry:entry,verified:true};
      if (!queue[entry.id] && valid(entry.data) && canSeeRecord(entry.data)) {
        queue[entry.id]={data:clone(entry.data),expected:clone(entry.expected),status:entry.status === 'conflict' ? 'conflict' : entry.recordAck ? 'activity-pending' : 'pending',activities:clone(entry.activities),keys:[],variants:[],fallback:item.key};
        if (!parentScopeBlocked(entry.id) && !records.some(function(r){return r.id===entry.id;})) records.push(clone(entry.data));
        // It was restored from an immutable durable revision, not edited in
        // this tab. Baseline it so sbPush cannot manufacture a new legacy copy.
        recTouched[entry.id]=1; last[entry.id]=json(entry.data); restored=true;
      }
    }
    return restored;
  }
  function stageFallback(snapshot) {
    var owner=actor, signature=json([snapshot.data,snapshot.expected,snapshot.activities]);
    if (fallbackStaging[snapshot.id]) return fallbackStaging[snapshot.id];
    snapshot = {id:snapshot.id,data:clone(snapshot.data),expected:clone(snapshot.expected),activities:finalizeActivities(snapshot.activities)};
    var replay = false;
    var staging = (async function() {
      try {
        var session=await trustedSession(owner);
        var entry=fallbackEntry(snapshot,session), entryKey=fallbackKey(entry), db=await idbOpen();
        await idbWrite(db,entryKey,entry);
        var readback=await idbRead(db,entryKey);
        if (currentUser !== owner || actor !== owner || !exact(readback,entry)) throw new Error('fallback readback mismatch');
        var pending=queue[snapshot.id];
        if (!pending || json([pending.data,pending.expected,activitiesOf(pending.activities || pending.activity)]) !== signature || legacyConflict(snapshot)) {
          entry.status='conflict';
          await idbWrite(db,entryKey,entry);
          if (!exact(await idbRead(db,entryKey),entry) || !rememberFallback(entry,entryKey)) throw new Error('fallback conflict locator not persisted');
          if (pending) pending.status='conflict';
          fallback[snapshot.id]={db:db,key:entryKey,entry:entry,verified:true};
          return false;
        }
        pending.activities=clone(entry.activities); delete pending.activity; pending.status='pending'; pending.fallback=entryKey;
        fallback[snapshot.id]={db:db,key:entryKey,entry:entry,verified:true};
        if (!rememberFallback(entry,entryKey)) throw new Error('fallback locator not persisted');
        delete generatorActivities[snapshot.id];
        replay = true;
        return true;
      } catch (error) {
        var pending=queue[snapshot.id]; if (pending) pending.status='fallback-failed';
        storageFailure(error); return false;
      } finally {
        delete fallbackStaging[snapshot.id];
        // A legacy push can run while IndexedDB is still committing. Once an
        // exact readback makes the fallback revision durable, enqueue another
        // ordinary push so that race never needs a reload or second click.
        if (replay && currentUser === owner && actor === owner && queue[snapshot.id]
          && queue[snapshot.id].fallback && typeof sbQueue === 'function') sbQueue();
        paint();
      }
    })();
    fallbackStaging[snapshot.id]=staging; return staging;
  }
  function allKeys(p) { return (p.keys || []).concat((p.variants || []).flatMap(function (v) { return v.keys || []; })); }
  function readOutbox() {
    var pending = {}, groups = {};
    for (var n=0; n<localStorage.length; n++) {
      var name = localStorage.key(n);
      if (!name || name.indexOf(key()) !== 0) continue;
      var item = JSON.parse(localStorage.getItem(name));
      if (!item || item.version !== 1 || item.owner !== actor || !item.data || item.data.id !== item.id
        || !/^[A-Z]+[0-9]{5}$/.test(item.id) || !(item.expected === null || (item.expected && typeof item.expected === 'object' && !Array.isArray(item.expected))) || typeof item.status !== 'string') throw new Error('invalid pending revision');
      if (!activityPayload(item.activities !== undefined ? item.activities : item.activity)) throw new Error('invalid pending record activity');
      var storedActivities = activitiesOf(item.activities !== undefined ? item.activities : item.activity);
      var id = item.id, signature = json([item.data,item.expected]);
      var list = groups[id] = groups[id] || [];
      var same = list.find(function (v) { return v.signature === signature; });
      if (same) {
        same.keys.push(name);
        same.activities = same.activities.concat(storedActivities);
        if ((item.at || 0) >= same.at) { same.status = item.status; same.at = item.at || 0; if (typeof item.reason === 'string') same.reason = item.reason; else delete same.reason; }
      } else list.push({data:item.data,expected:item.expected,status:item.status,keys:[name],signature:signature,activities:storedActivities,at:item.at || 0,reason:typeof item.reason === 'string' ? item.reason : undefined});
    }
    Object.keys(groups).forEach(function (id) {
      var list = groups[id]; pending[id] = list[0];
      pending[id].variants = list.slice(1);
      if (list.length > 1) pending[id].status = 'conflict';
    });
    return pending;
  }
  function load() {
    queue = {}; storageError = false; storageProblem = '';
    if (!actor) return;
    try { queue = readOutbox(); }
    catch (error) { storageFailure(error); }
  }
  function persist() {
    if (!actor || storageError) return false;
    try {
      Object.keys(queue).forEach(function (id) {
        var p = queue[id];
        if (parentScopeBlocked(id)) return;
        // The verified fallback is the durable journal for this immutable
        // revision. Never try to manufacture another legacy revision later.
        if (p && p.fallback && fallback[id] && fallback[id].verified) return;
        if (fallbackStaging[id]) throw {fsFallbackStaging:true};
        // `reason` is the last server verdict code shown to the user; optional,
        // additive, and ignored by older readers of the same immutable revision.
        var payload = {version:1,owner:actor,id:id,tab:tab,data:p.data,expected:p.expected,status:p.status,activities:activitiesOf(p.activities || p.activity),at:Date.now()};
        if (typeof p.reason === 'string' && p.reason) payload.reason = p.reason.slice(0,64);
        var signature = json([p.data,p.expected]);
        // Immutable revision keys prevent last-writer-wins loss across tabs.
        // Rewriting only this tab's revision preserves every other editor's copy.
        var old = p.keys || [];
        var base = key() + tab + ':' + nonce(), name = base, collision = 0;
        while (localStorage.getItem(name) !== null) {
          if (++collision > 100) throw new Error('revision key collision');
          name = base + '-' + collision;
        }
        var encoded = JSON.stringify(payload);
        var written = false;
        try { localStorage.setItem(name,encoded); written = true; }
        catch (error) {
          // Some browsers throw QuotaExceededError after committing the item.
          // A byte-exact immutable readback means the legacy durable path won;
          // do not create a duplicate fallback revision in that case.
          if (quotaError(error) && localStorage.getItem(name) === encoded) written = true;
          else if (quotaError(error)) {
            p.status = 'fallback-staging';
            stageFallback({id:id,data:p.data,expected:p.expected,activities:activitiesOf(p.activities || p.activity)});
            throw {fsFallbackStaging:true};
          } else throw error;
        }
        if (!written || localStorage.getItem(name) !== encoded) throw new Error('pending revision not persisted');
        ownedKeys[name] = true;
        p.keys = [name]; p.signature = signature;
        old.forEach(function (k) {
          if (ownedKeys[k]) { localStorage.removeItem(k); delete ownedKeys[k]; return; }
          var prior = JSON.parse(localStorage.getItem(k) || 'null');
          if (!prior) return;
          if (json([prior.data,prior.expected]) === signature) p.keys.push(k);
          else {
            p.variants = p.variants || [];
            var same = p.variants.find(function (v) { return json([v.data,v.expected]) === json([prior.data,prior.expected]); });
            if (same) same.keys.push(k);
            else p.variants.push({data:prior.data,expected:prior.expected,status:prior.status,activities:activitiesOf(prior.activities || prior.activity),keys:[k]});
            p.status = 'conflict';
          }
        });
      });
      return true;
    } catch (error) { if (!error || !error.fsFallbackStaging) storageFailure(error); return false; }
  }
  function forget(keys) {
    var originals=[];
    try {
      keys.forEach(function (k) { originals.push({key:k,value:localStorage.getItem(k)}); });
      keys.forEach(function (k) { localStorage.removeItem(k); });
      keys.forEach(function (k) { delete ownedKeys[k]; });
      return true;
    } catch (error) {
      // A later removeItem can fail after earlier keys are already gone.
      // Restore the exact immutable revisions before reporting the failure.
      originals.forEach(function (item) {
        if (item.value === null) return;
        try {
          if (localStorage.getItem(item.key) === null) localStorage.setItem(item.key,item.value);
        } catch (_) {}
      });
      storageFailure(error); return false;
    }
  }
  function backup(p) {
    var variants = [p].concat(p.variants || []);
    variants.forEach(function (v) { bakRecord(v.data,'เก็บก่อนยกเลิกการส่งใบงานฉบับนี้'); }); saveRecBak();
    var backups = JSON.parse(localStorage.getItem(RECBAK_KEY) || '{}');
    return variants.every(function (v) {
      return Array.isArray(backups[v.data.id]) && backups[v.data.id].some(function (b) { return json(b.data) === json(v.data); });
    });
  }
  // The legacy version history lives in localStorage; on a full browser the
  // copy is never written, so the person could not retire a conflicted draft
  // (17:00 มายด์ pressed "ใช้ข้อมูลจากระบบกลาง" twice, A03984 stayed blocked).
  // Keep the retired copies in their own IndexedDB database instead; they are
  // never deleted by the runtime and stay out of the fallback-journal store.
  var RECBAK_DB = 'fs_job_recbak_v1', RECBAK_STORE = 'copies';
  function backupDurable(p) {
    var variants = [p].concat(p.variants || []), owner = actor;
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB || typeof window.indexedDB.open !== 'function') { reject(new Error('IndexedDB unavailable')); return; }
      var request;
      try { request = window.indexedDB.open(RECBAK_DB, 1); } catch (error) { reject(error); return; }
      request.onupgradeneeded = function (event) { var db = event.target.result; if (!db.objectStoreNames.contains(RECBAK_STORE)) db.createObjectStore(RECBAK_STORE); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
      request.onsuccess = function () { resolve(request.result); };
    }).then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(RECBAK_STORE, 'readwrite');
          variants.forEach(function (v, index) {
            tx.objectStore(RECBAK_STORE).put({version:1, owner:owner, id:v.data.id, why:'เก็บก่อนยกเลิกการส่งใบงานฉบับนี้', at:Date.now(), data:clone(v.data)}, owner + ':' + v.data.id + ':' + nonce() + ':' + index);
          });
        } catch (error) { reject(error); return; }
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB write failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB write aborted')); };
        tx.oncomplete = function () { resolve(true); };
      });
    });
  }
  var preserveHiddenChatInput=function () {};
  function closeChatForUnknownScope() {
    invalidateChatStoragePause();preserveHiddenChatInput();
    try { if (typeof chatOpenId !== 'undefined') chatOpenId = null; } catch (_) {}
    try { if (typeof renderChatMenu === 'function') renderChatMenu(); } catch (_) {}
    try { if (typeof renderChat === 'function') renderChat(); } catch (_) {}
  }
  var switchingActor = false;
  function switchActor() {
    var now = currentUser || '';
    if (now === actor || switchingActor) return;
    switchingActor = true;
    try {
      // Closing the chat calls the wrapped renderer, which also checks the actor.
      // Fail closed before that redraw and prevent it from re-entering this transition.
      if (actor && delegatedRuntime) { sbReady = false; window.__fsCentralReady = false; }
      if (actor && delegatedRuntime) closeChatForUnknownScope();
      if (actor && delegatedRuntime && visibleIdentity) {
        var pendingSaved = stashPendingForIdentity(visibleIdentity);
        var cacheCleared = pendingSaved && clearConfirmedChatCache(visibleIdentity);
        if (!pendingSaved || !cacheCleared) {
          chatRecoveryBlocked = true;
          sbReady = false; window.__fsCentralReady = false;
          return;
        }
      }
      if (actor && delegatedRuntime) { sbReady = false; window.__fsCentralReady = false; }
      if (actor && typeof chats !== 'undefined' && Array.isArray(chats)) chats = [];
      actor = now; visibleGeneration++; visibleHistoryIdentity = '';
      visibleIdentity = '';
      confirmed = {}; revokedCentralRecords = Object.create(null); lastVerifiedParentIds = null; deferredUsers = {}; generatorActivities = {}; generatorCompletions = {}; generatorTransaction = false;
      if (installed) { hydrateSeen(); loadSeen(); }
      // References are actor-local runtime state. Resetting them never touches
      // IndexedDB or legacy evidence; a matching session-indexed owner may resume.
      fallback = {}; fallbackStaging = {}; load(); restore(true);
      integrity = {owner:now, status:'unknown', checkedAt:null, items:[], counts:{}}; integrityLastAttempt = 0; integrityBusy = null; integrityEpoch++;
      if (integrityPanel) { integrityPanel.hidden = true; integrityPanel.textContent = ''; }
    } finally { switchingActor = false; }
  }

  function restore(missingOnly) {
    if (!actor) return;
    Object.keys(queue).forEach(function (id) {
      var p = queue[id];
      // A draft belongs to its signed-in editor. Existing permission helpers
      // remain authoritative; an account switch never imports another queue.
      if (parentScopeBlocked(id) || !canSeeRecord(p.data)) return;
      var i = records.findIndex(function (r) { return r.id === id; });
      if (i < 0) { records.push(clone(p.data)); if (missingOnly) last[id] = json(p.data); }
      else if (!missingOnly) records[i] = clone(p.data);
      recTouched[id] = 1;
    });
  }
  function capture() {
    switchActor();
    if (!actor || sbApplying || !recTrackReady) { baseline(); return; }
    records.forEach(function (r) {
      if (!r || parentScopeBlocked(r.id) || !/^[A-Z]+[0-9]{5}$/.test(r.id || '')) return;
      // The display name remains for the sealed page and old rows. Add the
      // verified login identity only to a touched row, so a normal pull never
      // rewrites or silently claims someone else's historical data.
      var email = trustedSessionEmail();
      var p = queue[r.id];
      // Only the job's own owner adopts the canonical email. A pd/mkt editor
      // with FORMULA_EDIT touching someone else's legacy job must not claim it:
      // the gateway (rightly) treats that as an ownership change and refuses
      // the whole save (16 ต.ค. 2569: มายด์ on A02071, FORMULA_OWNER_IMMUTABLE,
      // while the chat already announced the formula change).
      if (email && recTouched[r.id] && !normalizedEmail(r.ownerEmail) && legacyOwner(r)) r.ownerEmail = email;
      // A row that an earlier page stamped by mistake is un-claimed here, and
      // its refused revision retired, so the pending edit can go out as the
      // owner's job. Central never held that email (confirmed copy lacks it).
      else if (email && !legacyOwner(r) && !(own(confirmed, r.id) && normalizedEmail(confirmed[r.id].ownerEmail))
        && (normalizedEmail(r.ownerEmail) === email || (p && !p.fallback && !fallbackStaging[r.id] && p.data && normalizedEmail(p.data.ownerEmail) === email))) {
        // The refused revision may hold the edit while the in-memory row was
        // already replaced by the central copy on reload (16 ต.ค. มายด์ A02071
        // after the version reload): take the edit back from the revision,
        // drop the claim, retire the revision and mark the row touched so the
        // edit is queued and sent again as the owner's job.
        if (normalizedEmail(r.ownerEmail) !== email && p && p.data) {
          var revived = clone(p.data);
          Object.keys(r).forEach(function (k) { delete r[k]; });
          Object.keys(revived).forEach(function (k) { r[k] = revived[k]; });
        }
        delete r.ownerEmail;
        if (p && !p.fallback && !fallbackStaging[r.id] && forget(allKeys(p))) { delete queue[r.id]; p = undefined; }
        recTouched[r.id] = 1;
        diag(r.id, 'owner-email', 'unclaimed');
      }
      var value = json(r);
      var staged = activitiesOf(generatorActivities[r.id]);
      // A quota fallback owns one immutable revision until its exact Record
      // and Activity acknowledgements finish. sbPush() calls capture() again
      // before every ordinary cycle; replacing that queue entry here would
      // discard its fallback locator and let the normal path send only the
      // Record. Keep the verified/staging revision intact. A genuinely newer
      // local edit is retained as a review state rather than being merged into
      // a journal that was already sealed.
      if (p && (fallbackStaging[r.id] || p.status === 'fallback-staging' || p.fallback)) {
        if (json(p.data) !== value || staged.length) p.status = 'conflict';
        return;
      }
      if (last[r.id] === value || !recTouched[r.id] || !canSeeRecord(r)) {
        if (staged.length && p && canSeeRecord(r)) p.activities = mergeActivities(p.activities || p.activity, staged);
        return;
      }
      var expected = p ? p.expected : (own(confirmed, r.id) ? clone(confirmed[r.id]) : null);
      delete notices[r.id];
      delete receipts[r.id];
      queue[r.id] = {data:clone(r),expected:expected,status:(p && unknownExpected(p.expected)) || !valid(r) ? 'invalid' : 'pending',activities:mergeActivities(p ? p.activities || p.activity : [], staged),keys:p ? p.keys : [],variants:p ? p.variants || [] : []};
    });
    Object.keys(queue).forEach(function (id) {
      if (parentScopeBlocked(id) || !own(last,id) || records.some(function (r) { return r.id === id; })) return;
      try {
        var p = queue[id];
        if (!backup(p) || !forget(allKeys(p))) throw new Error('draft backup failed');
        delete queue[id]; delete recTouched[id];
      } catch (_) { restore(); window.alert('ยังยกเลิกใบงานที่รอการบันทึกไม่ได้ เพราะเก็บสำเนาไม่สำเร็จ กรุณาสำรองข้อมูลก่อน'); }
    });
    baseline();
    if (persist()) {
      Object.keys(generatorActivities).forEach(function (id) {
        var pending = queue[id], staged = activitiesOf(generatorActivities[id]);
        if (pending && staged.every(function (activity) {
          return activitiesOf(pending.activities || pending.activity).some(function (candidate) { return json(candidate) === json(activity); });
        })) delete generatorActivities[id];
      });
    }
    paint();
  }
  function ready(id) {
    switchActor();
    var r = records.find(function (x) { return x.id === id; });
    var startupReady = typeof window.__fsRuntimeBoot !== 'function'
      || (window.__fsCentralReady === true && window.__fsPermissionReady === true);
    return !!actor && !storageError && startupReady && !readOnlyChatRooms[id] && !parentScopeBlocked(id) && !legacyBlocked(id) && !own(queue, id) && valid(r) && canSeeRecord(r)
      && own(confirmed, id) && json(confirmed[id]) === json(r);
  }
  function deleteMessage(id) {
    var p = queue[id], subject = 'ใบงาน ' + id + ' ';
    if (storageError) return subject + 'ยังลบไม่ได้ เพราะบันทึกใบงานในเครื่องไม่สำเร็จ · ข้อมูลยังไม่ถูกลบ กรุณาสำรองใบงานก่อนปิดหน้านี้';
    if (p && p.status === 'conflict') return subject + 'ยังลบไม่ได้ เพราะมีข้อมูลหลายฉบับ · ข้อมูลยังไม่ถูกลบ กรุณาตรวจสอบก่อนเลือกฉบับที่จะใช้';
    if (p && p.status === 'forbidden') return subject + 'ยังลบไม่ได้ เพราะคุณยังไม่มีสิทธิ์บันทึกใบงานนี้ในระบบกลาง · ข้อมูลยังไม่ถูกลบ กรุณาติดต่อผู้ดูแลระบบ';
    if (p && unknownExpected(p.expected)) return subject + 'ยังลบไม่ได้ เพราะยังตรวจสอบใบงานเดิมในระบบกลางไม่ได้ · ข้อมูลยังไม่ถูกลบ';
    if (p && p.status === 'invalid') return subject + 'ยังลบไม่ได้ เพราะข้อมูลใบงานยังไม่ถูกต้อง · ข้อมูลยังไม่ถูกลบ กรุณาแก้ไขและบันทึกอีกครั้ง';
    if (p && p.status === 'queued') return subject + 'กำลังบันทึกในระบบกลาง จึงยังลบไม่ได้ · ข้อมูลยังไม่ถูกลบ';
    return p ? subject + 'กำลังบันทึกในระบบกลาง จึงยังลบไม่ได้ · ข้อมูลยังไม่ถูกลบ ระบบจะส่งให้อัตโนมัติ'
      : subject + 'ยังยืนยันการบันทึกในระบบกลางไม่ได้ จึงยังลบไม่ได้ · ข้อมูลยังไม่ถูกลบ';
  }
  function deletePermissionMessage(id) {
    return 'ใบงาน ' + id + ' ยังลบไม่ได้ เพราะสิทธิ์ผู้ใช้ปัจจุบันไม่อนุญาต · ข้อมูลยังไม่ถูกลบ';
  }
  function message(id, action) {
    if (action === 'ลบใบงาน') return deleteMessage(id);
    var p = queue[id];
    if (storageError) return 'บันทึกใบงานในเครื่องไม่สำเร็จ กรุณาสำรองใบงานก่อนปิดหน้านี้';
    // Right after a reload the rooms are gated only because the central pull
    // has not finished (16:21 เชอรี่: three rooms within 3 s of sign-in). Say so.
    if (!p && typeof window.__fsRuntimeBoot === 'function' && (window.__fsCentralReady !== true || window.__fsPermissionReady !== true)) {
      return 'กำลังเชื่อมต่อระบบกลาง กรุณารอสักครู่แล้วลองใหม่';
    }
    if (p && p.status === 'conflict') return 'ใบงานนี้มีข้อมูลหลายฉบับ กรุณาตรวจสอบก่อนเลือกฉบับที่จะใช้';
    if (p && p.status === 'forbidden') return 'คุณยังไม่มีสิทธิ์บันทึกใบงานนี้ในระบบกลาง กรุณาติดต่อผู้ดูแลระบบ' + (p.reason ? ' (รหัส: ' + p.reason + ')' : '');
    if (p && unknownExpected(p.expected)) return 'ยังตรวจสอบใบงานเดิมในระบบกลางไม่ได้ จึงยังบันทึกทับไม่ได้ กรุณาตรวจสอบก่อนบันทึกอีกครั้ง';
    if (p && p.status === 'invalid') return 'ข้อมูลใบงานยังไม่ถูกต้อง กรุณาแก้ไขและบันทึกอีกครั้ง';
    if (p && p.status === 'queued') return 'ระบบกลางรับข้อมูลแล้ว กำลังบันทึกใบงาน แชตใช้งานได้หลังบันทึกสำเร็จ';
    return p ? 'ใบงานรอการบันทึกในระบบกลาง ระบบจะส่งให้อัตโนมัติ แชตใช้งานได้หลังบันทึกสำเร็จ'
      : 'ยังตรวจสอบการบันทึกใบงานนี้ในระบบกลางไม่สำเร็จ แชตจะใช้งานได้หลังตรวจสอบสำเร็จ';
  }
  function gate(id, action) {
    if (ready(id)) return true;
    diag(id, 'gate:' + (action || 'open'), readyReason(id), queue[id] && queue[id].reason);
    window.alert(message(id, action)); paint(); return false;
  }
  function state(id) {
    if (storageError) return {kind:'failed',text:'บันทึกไม่สำเร็จ'};
    if (notices[id]) return notices[id];
    var p = queue[id];
    if (p) {
      if (/^(conflict|forbidden|invalid|unconfirmed|retry)$/.test(p.status)) return {kind:'failed',text:p.status === 'retry' ? 'บันทึกไม่สำเร็จ · กำลังลองใหม่' : 'บันทึกไม่สำเร็จ · ตรวจสอบ'};
      return {kind:'pending',text:p.status === 'queued' ? 'ระบบกลางรับแล้ว · กำลังยืนยัน' : 'กำลังบันทึก…'};
    }
    var record=records.find(function (row) {return row && row.id===id;});
    return record && receipts[id]===json(record) ? {kind:'saved',text:'บันทึกแล้ว'} : null;
  }
  function paintRecordStates() {
    if (!document || typeof document.querySelectorAll !== 'function') return;
    if (typeof window.__fsUpdateFormulaSaveStatuses === 'function') window.__fsUpdateFormulaSaveStatuses();
    Array.prototype.forEach.call(document.querySelectorAll('.rec-idlink'), function (button) {
      if (button.getAttribute && button.getAttribute('data-fs-activity-job-link') === '1') return;
      var id = String(button.textContent || '').trim(), current = state(id), marker = document.getElementById('fsJobSaveState-' + id);
      if (!current) { if (marker && marker.remove) marker.remove(); return; }
      if (!marker) {
        marker = document.createElement('span'); marker.id = 'fsJobSaveState-' + id; marker.setAttribute('role','status'); marker.setAttribute('aria-live','polite');
        if (button.parentNode) button.parentNode.appendChild(marker);
      }
      marker.textContent = current.text;
      marker.style.cssText = 'display:inline-block;margin:4px 0 0 6px;padding:2px 6px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;' + (current.kind === 'saved' ? 'background:#dcfce7;color:#166534' : current.kind === 'failed' ? 'background:#fee2e2;color:#991b1b' : 'background:#fef3c7;color:#92400e');
    });
    var modal = document.getElementById('gModal'), title = modal && modal.querySelector ? modal.querySelector('.modal-t') : null;
    // Tag modal titles include the job ID; section-editor titles are merely
    // the section name and carry the ID in `.modal-desc`.
    var description = modal && modal.querySelector ? modal.querySelector('.modal-desc') : null;
    var match = (String(title && title.textContent || '') + ' ' + String(description && description.textContent || '')).match(/([A-Z]+[0-9]{5})/), id = match && match[1];
    var body = document.getElementById('jobTagBody'), current = id && state(id);
    // A section editor closes and immediately reopens its modal after Save.
    // While the parent Record/Activity acknowledgement is pending, make that
    // state explicit in the reopened modal and prevent a second, competing
    // save. The existing Tag modal has its own control rendering below.
    var sectionStatus = modal && document.getElementById('fsJobSectionSaveState');
    function unlockSectionModal() {
      if (!modal || !modal.querySelectorAll) return;
      Array.prototype.forEach.call(modal.querySelectorAll('[data-fs-job-pending-disabled]'), function (control) {
        control.disabled = control.getAttribute('data-fs-job-pending-disabled') === '1';
        control.removeAttribute('data-fs-job-pending-disabled');
      });
    }
    if (modal && id && !body) {
      var acts = modal.querySelector ? modal.querySelector('.modal-acts') : null;
      if (current) {
        if (!sectionStatus) {
          sectionStatus = document.createElement('div'); sectionStatus.id = 'fsJobSectionSaveState';
          sectionStatus.setAttribute('role','status'); sectionStatus.setAttribute('aria-live','polite');
          sectionStatus.style.cssText = 'margin:0 0 10px;padding:8px 10px;border-radius:7px;font-size:12px;font-weight:600;';
          if (acts && acts.parentNode) acts.parentNode.insertBefore(sectionStatus,acts); else if (modal.appendChild) modal.appendChild(sectionStatus);
        }
        sectionStatus.textContent = current.text;
        var locked = current.kind !== 'saved';
        sectionStatus.style.cssText = 'margin:0 0 10px;padding:8px 10px;border-radius:7px;font-size:12px;font-weight:600;'
          + (current.kind === 'saved' ? 'background:#dcfce7;color:#166534'
            : current.kind === 'failed' ? 'background:#fee2e2;color:#991b1b'
            : 'background:#fef3c7;color:#92400e');
        if (locked && modal.querySelectorAll) {
          Array.prototype.forEach.call(modal.querySelectorAll('input,textarea,select'), function (control) {
            if (control.getAttribute('data-fs-job-pending-disabled') !== null) return;
            control.setAttribute('data-fs-job-pending-disabled', control.disabled ? '1' : '0'); control.disabled = true;
          });
          if (acts && acts.querySelectorAll) Array.prototype.forEach.call(acts.querySelectorAll('button'), function (button) {
            if (!/บันทึกการแก้ไข/.test(String(button.textContent || '')) || button.getAttribute('data-fs-job-pending-disabled') !== null) return;
            button.setAttribute('data-fs-job-pending-disabled', button.disabled ? '1' : '0'); button.disabled = true;
          });
        } else unlockSectionModal();
      } else {
        if (sectionStatus && sectionStatus.remove) sectionStatus.remove();
        unlockSectionModal();
      }
    } else if (sectionStatus && sectionStatus.remove) {
      sectionStatus.remove(); unlockSectionModal();
    }
    if (!body || !id) return;
    var tagMarker = document.getElementById('fsJobTagSaveState');
    if (!current) { if (tagMarker && tagMarker.remove) tagMarker.remove(); return; }
    if (!tagMarker) {
      tagMarker = document.createElement('div'); tagMarker.id = 'fsJobTagSaveState'; tagMarker.setAttribute('role','status'); tagMarker.setAttribute('aria-live','polite');
      if (body.parentNode) body.parentNode.insertBefore(tagMarker,body);
    }
    tagMarker.textContent = current.text;
    tagMarker.style.cssText = 'margin:0 0 10px;padding:8px 10px;border-radius:7px;font-size:12px;font-weight:600;' + (current.kind === 'saved' ? 'background:#dcfce7;color:#166534' : current.kind === 'failed' ? 'background:#fee2e2;color:#991b1b' : 'background:#fef3c7;color:#92400e');
    if (typeof body.querySelectorAll === 'function') Array.prototype.forEach.call(body.querySelectorAll('.tg-chip'), function (chip) {
      if (current.kind !== 'saved') {
        chip.setAttribute('aria-disabled','true'); chip.style.pointerEvents = 'none'; chip.style.opacity = '0.62';
      } else {
        if (chip.removeAttribute) chip.removeAttribute('aria-disabled'); chip.style.pointerEvents = ''; chip.style.opacity = '';
      }
    });
  }
  function recoveryClearButton() {
    var anchor=document.getElementById('gen_err'), bar=anchor && anchor.parentNode;
    if (!bar || typeof bar.querySelectorAll !== 'function') return null;
    var buttons = bar.querySelectorAll('button');
    for (var n=0;n<buttons.length;n++) if (buttons[n].id !== 'btnCreate') return buttons[n];
    return null;
  }
  function recoveryState() {
    var ids=Object.keys(queue), id, p, ref, entry;
    for (var n=0;n<ids.length;n++) {
      id=ids[n]; p=queue[id]; ref=fallback[id]; entry=ref && ref.entry;
      if (storageError && (!ref || !ref.verified)) return {kind:'unavailable',id:id,pending:p};
      if (ref && entry && entry.owner !== actor) return {kind:'foreign',id:id,pending:p};
      if (fallbackStaging[id] || p && p.status === 'fallback-staging') return {kind:'staging',id:id,pending:p};
      if (p && p.fallback && ref && ref.verified && entry) {
        if (entry.recordAck || p.status === 'activity-pending' || entry.status === 'activity-pending') return {kind:'activity',id:id,pending:p,entry:entry};
        if (/^(conflict|forbidden|invalid|unconfirmed)$/.test(p.status) || entry.status === 'conflict') return {kind:'failed',id:id,pending:p,entry:entry};
        return {kind:entry.status === 'fallback-verified' ? 'staged' : 'replay',id:id,pending:p,entry:entry};
      }
      if (p && /^(fallback-failed|conflict|forbidden|invalid|unconfirmed)$/.test(p.status)) return {kind:'failed',id:id,pending:p};
    }
    return storageError ? {kind:'unavailable',id:null,pending:null} : null;
  }
  function recoveryCopy(state) {
    if (state.kind === 'foreign') return {heading:'ไม่สามารถใช้สำเนาใบงานของผู้ใช้อื่นได้',status:'ยังไม่ยืนยันในระบบกลางสำหรับผู้ใช้นี้',next:'ลงชื่อเข้าใช้ด้วยผู้ที่สร้างใบงานนี้ หรือกลับไปที่ข้อมูลในฟอร์มของคุณเอง'};
    if (state.kind === 'staged') return {heading:'เก็บสำเนาใบงานในเครื่องแล้ว',status:'ยังไม่ยืนยันในระบบกลาง',next:'ระบบกำลังเตรียมส่งข้อมูล โปรดเก็บหน้านี้ไว้เปิดอยู่ หากจำเป็นต้องออกจากหน้านี้ ให้ดาวน์โหลดสำเนาใบงานก่อน'};
    if (state.kind === 'replay' || state.kind === 'staging') return {heading:'ใบงานกำลังรอการยืนยัน',status:'ระบบกลางยังไม่ยืนยันการบันทึกใบงานนี้',next:'โปรดอย่าโหลดหน้า ปิดหน้า หรือล้างข้อมูล หากต้องออกจากหน้านี้ ให้ดาวน์โหลดสำเนาใบงานก่อน'};
    if (state.kind === 'activity') return {heading:'ระบบกลางรับใบงานแล้ว แต่การบันทึกประวัติยังไม่ครบ',status:'ใบงานนี้ยังไม่เสร็จสมบูรณ์ และยังไม่เปิดใช้งานแชต',next:'ระบบจะยืนยันประวัติที่เหลือจากสำเนาที่เก็บไว้ หากต้องออกจากหน้านี้ ให้ดาวน์โหลดสำเนาใบงานก่อน'};
    if (state.kind === 'unavailable') return {heading:'ยังเก็บสำเนาใบงานในเครื่องไม่ได้',status:'ข้อมูลยังไม่ยืนยันในระบบกลาง',next:'ข้อมูลในฟอร์มนี้ยังอยู่ ให้ดาวน์โหลดสำเนาใบงานก่อนโหลดใหม่หรือปิดหน้านี้'};
    return {heading:'ยังยืนยันการบันทึกใบงานไม่ได้',status:'ข้อมูลยังไม่ยืนยันในระบบกลาง',next:'ข้อมูลในฟอร์มนี้และสำเนาใบงานยังอยู่ ให้ดาวน์โหลดสำเนาใบงานก่อนโหลดใหม่หรือปิดหน้านี้'};
  }
  function recoveryExportPayload(state) {
    if (!state || state.kind === 'foreign') return null;
    var source=state.entry || state.pending;
    if (!source || !source.data || !valid(source.data)) return null;
    var activities=activitiesOf(source.activities || source.activity);
    var revision={record:clone(source.data),activities:clone(activities)};
    if (!exact(revision.record,source.data) || !exact(revision.activities,activities)) return null;
    // This timestamp belongs to the downloaded recovery artifact only. It is
    // deliberately outside the immutable record/activity revision used for replay.
    return {format:'formula-unsent-job-v1',createdAt:new Date().toISOString(),recordId:source.data.id,record:revision.record,activities:revision.activities};
  }
  function recoveryFilename(id) {
    var now=new Date(), pad=function(v){return String(v).padStart(2,'0');}, offset=-now.getTimezoneOffset(), sign=offset >= 0 ? '+' : '-', absolute=Math.abs(offset);
    return 'formula-unsent-' + (id || 'draft') + '-' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + 'T' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + sign + pad(Math.floor(absolute/60)) + pad(absolute%60) + '.json';
  }
  function downloadRecovery(state) {
    var payload=recoveryExportPayload(state);
    if (!payload || typeof Blob !== 'function' || !window.URL || typeof window.URL.createObjectURL !== 'function') return false;
    var encoded=JSON.stringify(payload), blob=new Blob([encoded],{type:'application/json;charset=utf-8'}), url=window.URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url; link.download=recoveryFilename(payload.recordId); link.style.display='none';
    if (document.body && document.body.appendChild) document.body.appendChild(link);
    try { if (typeof link.click === 'function') link.click(); else return false; }
    finally {
      if (link.remove) link.remove(); else if (link.parentNode && link.parentNode.removeChild) link.parentNode.removeChild(link);
      window.setTimeout(function(){ window.URL.revokeObjectURL(url); },0);
    }
    return true;
  }
  function setRecoveryDisabled(button,disabled) {
    if (!button) return;
    var read=function(name){ return typeof button.getAttribute === 'function' ? button.getAttribute(name) : button.attrs && own(button.attrs,name) ? button.attrs[name] : null; };
    if (disabled) {
      if (read('data-fs-recovery-original-describedby') === null) button.setAttribute('data-fs-recovery-original-describedby',read('aria-describedby') || '');
      button.disabled=true; button.setAttribute('aria-disabled','true'); button.setAttribute('aria-describedby','fsJobRecoveryStatus');
    } else if (read('data-fs-recovery-original-describedby') !== null) {
      button.disabled=false; button.setAttribute('aria-disabled','false');
      var original=read('data-fs-recovery-original-describedby');
      if (original) button.setAttribute('aria-describedby',original); else if (button.removeAttribute) button.removeAttribute('aria-describedby');
      button.removeAttribute('data-fs-recovery-original-describedby');
    }
  }
  function paintRecoveryPanel(state) {
    var panel=document.getElementById('fsJobRecoveryPanel'), create=document.getElementById('btnCreate'), clear=recoveryClearButton(), copy=state && recoveryCopy(state);
    setRecoveryDisabled(create,!!state); setRecoveryDisabled(clear,!!state);
    if (!state) { if (panel && panel.remove) panel.remove(); return; }
    var anchor=document.getElementById('gen_err'), actionBar=anchor && anchor.parentNode;
    if (!actionBar) return;
    if (!panel) {
      panel=document.createElement('section'); panel.id='fsJobRecoveryPanel'; panel.setAttribute('aria-labelledby','fsJobRecoveryHeading');
      panel.style.cssText='flex-basis:100%;box-sizing:border-box;margin-top:8px;padding:10px 12px;border:1px solid #d97706;border-radius:8px;background:#fffbeb;color:#78350f;font:14px/1.45 sans-serif;overflow-wrap:anywhere';
      var heading=document.createElement('h3'); heading.id='fsJobRecoveryHeading'; heading.tabIndex=-1; heading.style.cssText='margin:0 0 4px;font-size:14px;line-height:1.45'; panel.appendChild(heading);
      var status=document.createElement('p'); status.id='fsJobRecoveryStatus'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); status.style.cssText='margin:0 0 4px'; panel.appendChild(status);
      var next=document.createElement('p'); next.id='fsJobRecoveryNext'; next.style.cssText='margin:0'; panel.appendChild(next);
      if (typeof actionBar.insertBefore === 'function') actionBar.insertBefore(panel,anchor.nextSibling); else actionBar.appendChild(panel);
    }
    document.getElementById('fsJobRecoveryHeading').textContent='⚠ ' + copy.heading;
    document.getElementById('fsJobRecoveryStatus').textContent=copy.status;
    var next=document.getElementById('fsJobRecoveryNext'), payload=recoveryExportPayload(state), existing=document.getElementById('fsJobRecoveryDownload');
    next.textContent=payload ? copy.next : 'ข้อมูลในฟอร์มยังอยู่ โปรดคงหน้านี้ไว้และติดต่อผู้ดูแลระบบก่อนโหลดใหม่หรือปิดหน้านี้';
    if (payload && !existing) {
      var button=document.createElement('button'); button.id='fsJobRecoveryDownload'; button.type='button'; button.textContent='ดาวน์โหลดสำเนาใบงาน'; button.setAttribute('aria-label','ดาวน์โหลดสำเนาใบงาน'); button.setAttribute('aria-describedby','fsJobRecoveryDownloadDescription');
      // Keep the recovery action reachable on narrow screens. Some browser
      // layouts shrink an inline-flex button despite its minimum size; an
      // explicit 44px box is the smallest touch target accepted by UAT.
      button.style.cssText='display:inline-flex;align-items:center;width:100%;max-width:100%;min-width:44px;min-height:44px;box-sizing:border-box;margin-top:8px;padding:8px 12px;border:1px solid #b45309;border-radius:6px;background:#fff;color:#78350f;font:600 14px/1.4 sans-serif;cursor:pointer';
      button.onfocus=function(){ this.style.outline='2px solid #1d4ed8'; this.style.outlineOffset='2px'; };
      button.onblur=function(){ this.style.outline=''; this.style.outlineOffset=''; };
      button.onkeydown=function(event){
        if (event && event.key === 'Tab' && event.shiftKey) {
          var previous=document.getElementById('f_notes');
          if (previous && !previous.disabled && typeof previous.focus === 'function') { event.preventDefault(); previous.focus(); }
        }
      };
      button.onclick=function(){ return downloadRecovery(recoveryState()); }; panel.appendChild(button);
      var description=document.createElement('span'); description.id='fsJobRecoveryDownloadDescription'; description.textContent='ไฟล์นี้เป็นสำเนาสำหรับกู้คืน ยังไม่ได้บันทึกในระบบกลาง'; description.style.cssText='display:block;margin-top:4px;font-size:12px;line-height:1.45'; panel.appendChild(description);
    } else if (!payload && existing && existing.remove) existing.remove();
    if (recoveryFocusRequested) { recoveryFocusRequested=false; var focus=document.getElementById('fsJobRecoveryHeading'); if (focus && typeof focus.focus === 'function') focus.focus(); }
  }
  function paint() {
    if (!document || !document.body) return;
    var recovery=recoveryState(), createButton = document.getElementById('btnCreate');
    if (createButton) {
      var centralPending = typeof window.__fsRuntimeBoot === 'function' && (window.__fsCentralReady !== true || window.__fsPermissionReady !== true);
      createButton.disabled = !!recovery || centralPending || !window.__fsJobSync || !window.__fsJobSync.ready || storageError || Object.keys(fallbackStaging).length > 0;
      createButton.setAttribute('aria-disabled', String(createButton.disabled));
    }
    var preparing = document.getElementById('gen_err');
    if (window.__fsJobSync && window.__fsJobSync.ready && !storageError && preparing
      && typeof preparing.getAttribute === 'function' && preparing.getAttribute('data-fs-job-preparing') === '1') {
      preparing.textContent = ''; preparing.removeAttribute('data-fs-job-preparing');
    }
    var el = document.getElementById('fsJobSyncStatus');
    if (!el) {
      el = document.createElement('div'); el.id = 'fsJobSyncStatus';
      el.setAttribute('role','status'); el.setAttribute('aria-live','polite');
      el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:1100;box-sizing:border-box;max-width:calc(100vw - 24px);max-height:40vh;overflow-y:auto;overflow-wrap:anywhere;padding:10px 14px;border:1px solid #d97706;border-radius:8px;background:#fffbeb;color:#78350f;font:14px sans-serif;box-shadow:0 2px 8px #0002';
      document.body.appendChild(el);
    }
    // A revision that still carries variants is never sent (flush skips it) and
    // never resolves itself, whatever its status says: editing a conflicted job
    // again resets the status to pending but keeps the variants (18:11 เอ้,
    // A03885 "queue-skip variants" with no control). Treat it as blocked.
    function needsReview(id) { var p = queue[id]; return !!p && (/^(conflict|forbidden|invalid|unconfirmed)$/.test(p.status) || !!(p.variants && p.variants.length)); }
    var ids = Object.keys(queue), blocked = ids.filter(needsReview).length;
    // Legacy writes are deliberately suppressed until the parent record is
    // exactly acknowledged. Show only valid IDs from that local protection
    // state; an ID is never taken from arbitrary legacy content.
    var legacyIds = blockedLegacy ? Object.keys(suppressed).concat(Object.keys(suppressedRecords)).filter(function (id, index, all) {
      return /^[A-Z]+[0-9]{5}$/.test(id) && all.indexOf(id) === index
        && records.some(function (record) { return record && record.id === id && canSeeRecord(record); });
    }) : [];
    var accepted = ids.filter(function (id) { return queue[id].status === 'queued'; }).length, staging = Object.keys(fallbackStaging).length;
    el.textContent = storageError ? 'บันทึกใบงานในเครื่องไม่สำเร็จ · ' + storageRecoveryMessage()
      : staging ? 'บันทึกใบงานในเครื่องไม่สำเร็จ · พื้นที่เก็บข้อมูลของเบราว์เซอร์ไม่พอ ข้อมูลยังไม่ยืนยันในระบบกลาง'
      : ids.length ? 'ใบงานรอการบันทึก ' + ids.length + ' ใบ' + (accepted ? ' · รับข้อมูลแล้ว กำลังบันทึกใบงาน ' + accepted + ' ใบ' : '') + (blocked ? ' · ต้องตรวจสอบ ' + blocked + ' ใบ' : accepted ? '' : ' · ระบบจะส่งให้อัตโนมัติ')
      : blockedLegacy ? 'มีใบงานที่ยังตรวจสอบการบันทึกไม่สำเร็จ' + (legacyIds.length ? ' · เปิดตรวจสอบใบงานที่เกี่ยวข้อง' : ' · กรุณาตรวจสอบ') : '';
    el.hidden = !actor || !el.textContent;
    if (storageError) el.textContent += ' · หากเปิดหลายหน้า ให้สำรองใบงานและปิดหน้าอื่นก่อนโหลดใหม่';
    ids.filter(needsReview).forEach(function (id) {
      var row = document.createElement('div'); row.style.cssText = 'margin-top:8px';
      var label = document.createElement('span'), reason = queue[id].reason;
      var status = queue[id].variants && queue[id].variants.length && queue[id].status !== 'forbidden' ? 'conflict' : queue[id].status;
      // A conflict (two local revisions) or an unconfirmed save never resolves
      // itself: the automatic path stops as soon as central already has the
      // job. When central does have it, the person can adopt that copy here;
      // useServer() asks for confirmation and keeps the local copy in the
      // version history first. 14 ต.ค. 2569: a pd user sat on queued:conflict
      // for A03984 with no control anywhere on the page.
      var central = own(confirmed, id);
      // A forbidden revision of a job central does not hold can never be sent
      // by this account (16 ต.ค. 2569: ปุ้ม/rd kept a copy of A02423 after the
      // admin deleted it; every page load retried once and was refused). Offer
      // to retire the local copy; the copy is kept in the version history first.
      var orphanForbidden = status === 'forbidden' && !central && startupReady();
      label.textContent = id + ' · ' + (integrityLabels[status] || status) + (reason ? ' (' + reason + ')' : '')
        + (central ? ' · ระบบกลางมีใบงานนี้แล้ว'
          : orphanForbidden ? ' · ระบบกลางไม่มีใบงานนี้ และบัญชีนี้บันทึกใบงานนี้ไม่ได้ · สำเนาในเครื่องจะไม่ถูกส่ง'
          : ' · ระบบจะตรวจสอบข้อมูลกลางและดำเนินการให้อัตโนมัติเมื่อเปิดแชต');
      row.appendChild(label);
      if (orphanForbidden) {
        var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-s btn-sm';
        remove.textContent = 'ลบสำเนาในเครื่อง'; remove.setAttribute('aria-label','ลบสำเนาในเครื่องของใบงาน ' + id);
        remove.setAttribute('data-fs-remove-local', id);
        remove.style.cssText = 'min-height:36px;margin-left:6px;padding:6px 10px;border:1px solid #b45309;border-radius:6px;background:white;color:#78350f;cursor:pointer';
        remove.onclick = function () { diag(id, 'remove-local', status, reason); return removeLocal(id); };
        row.appendChild(remove);
      }
      if (central && status !== 'forbidden') {
        var adopt = document.createElement('button'); adopt.type = 'button'; adopt.className = 'btn btn-s btn-sm';
        adopt.textContent = 'ใช้ข้อมูลจากระบบกลาง'; adopt.setAttribute('aria-label','ใช้ข้อมูลจากระบบกลางสำหรับใบงาน ' + id);
        adopt.setAttribute('data-fs-adopt-server', id);
        adopt.style.cssText = 'min-height:36px;margin-left:6px;padding:6px 10px;border:1px solid #b45309;border-radius:6px;background:white;color:#78350f;cursor:pointer';
        adopt.onclick = function () { diag(id, 'adopt-server', status, reason); return useServer(id); };
        row.appendChild(adopt);
      }
      el.appendChild(row);
    });
    if (blockedLegacy && legacyIds.length) {
      var legacyRow = document.createElement('div'); legacyRow.style.cssText = 'margin-top:8px';
      var legacyLabel = document.createElement('span'); legacyLabel.textContent = 'ใบงานที่ต้องตรวจสอบ: ';
      legacyRow.appendChild(legacyLabel);
      legacyIds.forEach(function (id, index) {
        var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-s btn-sm'; button.textContent = id;
        button.setAttribute('aria-label','เปิดตรวจสอบใบงาน ' + id); button.setAttribute('title','เปิดตรวจสอบใบงาน ' + id);
        button.style.cssText = 'min-height:36px;padding:6px 10px;border:1px solid #b45309;border-radius:6px;background:white;color:#78350f;cursor:pointer' + (index ? ';margin-left:6px' : '');
        button.onclick = function () { return typeof window.openRecordPopup === 'function' ? window.openRecordPopup(id) : false; };
        legacyRow.appendChild(button);
      });
      el.appendChild(legacyRow);
    }
    Object.keys(notices).filter(function (id) {
      return /^[A-Z]+[0-9]{5}$/.test(id) && notices[id] && /^(pending|failed)$/.test(notices[id].kind)
        && records.some(function (record) { return record && record.id === id && canSeeRecord(record); });
    }).forEach(function (id) {
      var notice = document.createElement('div'); notice.style.cssText = 'margin-top:8px';
      notice.textContent = id + ' · ' + (notices[id].text || (notices[id].kind === 'pending'
        ? 'กำลังตรวจสอบข้อมูลใบงานก่อนเปิดแชต…'
        : 'ยังเปิดแชตไม่ได้ · ระบบจะตรวจสอบใหม่อัตโนมัติ'));
      el.appendChild(notice);
    });
    paintRecoveryPanel(recovery); paintRecordStates(); integrityRender(); integrityPoll(false);
  }
  var integrityLabels = {saved:'บันทึกสำเร็จ', pending:'รอการบันทึก', deleted:'ลบแล้ว', closed:'ปิดงานแล้ว', rejected:'ไม่อนุมัติ', conflict:'ข้อมูลหลายฉบับ', forbidden:'ไม่มีสิทธิ์บันทึก', invalid:'ข้อมูลไม่ครบหรือไม่ถูกต้อง', missing:'ไม่พบใบงานในระบบกลาง', unknown:'ยังตรวจสอบไม่ได้'};
  function integrityAllowed() {
    try { return !!currentUser && typeof currentRole === 'function' && currentRole() === 'admin' && !(typeof impersonator !== 'undefined' && impersonator); }
    catch (_) { return false; }
  }
  function integrityTime(value) { return value === null || value === undefined ? '—' : new Date(value).toLocaleString('th-TH'); }
  function integrityWaiting(item) { return /^(pending|conflict|forbidden|invalid|missing|unknown)$/.test(item.state); }
  function integrityRead(data) {
    function time(value) { return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0); }
    if (!data || data.version !== 1 || data.complete !== true || !/^(ok|unknown)$/.test(data.status)
      || typeof data.checkedAt !== 'number' || !time(data.checkedAt) || !Array.isArray(data.items)
      || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)) throw new Error('invalid integrity metadata');
    var seen = {}, items = data.items.slice(0,100).map(function (item) {
      if (!item || typeof item.id !== 'string' || !/^[A-Z]+[0-9]{5}$/.test(item.id) || own(seen,item.id)
        || !own(integrityLabels,item.state) || typeof item.reason !== 'string'
        || !time(item.firstSeenAt) || !time(item.lastAttemptAt) || !time(item.nextAttemptAt)) throw new Error('invalid integrity item');
      seen[item.id] = true;
      return {id:item.id,state:item.state,reason:item.reason.slice(0,240),firstSeenAt:item.firstSeenAt,lastAttemptAt:item.lastAttemptAt,nextAttemptAt:item.nextAttemptAt};
    });
    var counts = {};
    Object.keys(integrityLabels).forEach(function (state) {
      var value = data.counts[state];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Math.floor(value) !== value)) throw new Error('invalid integrity count');
      if (value !== undefined) counts[state] = value;
    });
    if (data.notice !== undefined && data.notice !== null && typeof data.notice !== 'string') throw new Error('invalid integrity notice');
    return {owner:currentUser,status:data.status === 'ok' && Date.now() - data.checkedAt > 120000 ? 'unknown' : data.status,checkedAt:data.checkedAt,items:items,counts:counts,notice:typeof data.notice === 'string' ? data.notice.slice(0,480) : ''};
  }
  function integrityRender() {
    if (!integrityEnabled) {
      if (integrityPanel && integrityPanel.remove) integrityPanel.remove();
      integrityPanel = null;
      var stale = document && document.getElementById ? document.getElementById('fsJobIntegrityPanel') : null;
      if (stale && stale.remove) stale.remove();
      return;
    }
    if (!integrityAllowed() || integrity.owner !== currentUser) {
      if (integrityPanel) { integrityPanel.hidden = true; integrityPanel.textContent = ''; }
      return;
    }
    if (integrity.status === 'ok' && Date.now() - integrity.checkedAt > 120000) integrity.status = 'unknown';
    var host = document.getElementById('actView');
    if (!host) return;
    if (!integrityPanel) {
      integrityPanel = document.createElement('section'); integrityPanel.id = 'fsJobIntegrityPanel';
      integrityPanel.setAttribute('aria-label','ตรวจสอบการบันทึกใบงานในระบบกลาง');
      integrityPanel.style.cssText = 'margin-bottom:20px;padding:20px;border:1px solid var(--bd,#DADCE0);border-radius:12px;background:var(--card,#fff);color:var(--tx,#202124)';
      if (typeof host.insertBefore === 'function') host.insertBefore(integrityPanel,host.firstChild); else host.appendChild(integrityPanel);
    }
    integrityPanel.hidden = false; integrityPanel.textContent = '';
    function textNode(tag,text,parent) { var node = document.createElement(tag); node.textContent = text; (parent || integrityPanel).appendChild(node); return node; }
    var heading = textNode('h3','สถานะการบันทึกใบงานในระบบกลาง'); heading.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:500';
    var unresolved = integrity.items.filter(integrityWaiting).length;
    var counted = Object.keys(integrity.counts).reduce(function (sum,state) { return sum + (integrityWaiting({state:state}) ? integrity.counts[state] : 0); },0);
    unresolved = Math.max(unresolved,counted);
    var summary = textNode('p',integrity.status !== 'ok' ? 'ยังตรวจสอบไม่ได้ · ระบบจะตรวจให้อัตโนมัติ'
      : unresolved ? 'มีใบงานที่ต้องติดตาม ' + unresolved + ' ใบ' : 'ตรวจสอบแล้ว · ไม่พบใบงานค้างในรายการนี้');
    summary.setAttribute('role','status'); summary.setAttribute('aria-live','polite');
    summary.style.cssText = 'margin:0 0 8px;color:' + (integrity.status !== 'ok' || unresolved ? 'var(--ye,#B06000)' : 'var(--gr,#1E8E3E)');
    textNode('p','ตรวจล่าสุด: ' + integrityTime(integrity.checkedAt) + ' · ตรวจอัตโนมัติทุก 1 นาที').style.cssText = 'font-size:12px;color:var(--muted,#5F6368);margin:0 0 12px';
    if (integrity.notice) {
      var notice = textNode('p','พื้นที่รับข้อมูล: '+integrity.notice); notice.setAttribute('role','status');
      notice.style.cssText = 'padding:10px;margin:12px 0;border-left:3px solid var(--ye,#B06000);background:var(--card2,#F1F3F4);color:var(--ye,#B06000);overflow-wrap:anywhere';
    }
    var button = textNode('button','ตรวจสอบอีกครั้ง'); button.type = 'button'; button.className = 'btn btn-g btn-sm';
    button.setAttribute('aria-label','ตรวจสอบสถานะการบันทึกใบงานอีกครั้ง'); button.onclick = function () { return integrityPoll(true); };
    if (integrity.status !== 'ok' && integrity.items.length) textNode('p','สถานะล่าสุดยังไม่ยืนยัน กรุณารอผลตรวจครั้งถัดไป').style.cssText = 'margin-top:12px;color:var(--ye,#B06000)';
    var list = textNode('div',''); list.style.cssText = 'margin-top:12px;max-height:360px;overflow-y:auto';
    integrity.items.forEach(function (item) {
      var overdue = integrityWaiting(item) && item.firstSeenAt !== null && Date.now() - item.firstSeenAt > 120000;
      var row = textNode('article','',list); row.setAttribute('aria-label','ใบงาน '+item.id+' '+integrityLabels[item.state]);
      row.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:12px 0;border-top:1px solid var(--line,#E8EAED);' + (overdue ? 'border-left:3px solid var(--re,#D93025);padding-left:10px;' : '');
      var state = textNode('div','',row); textNode('strong',item.id,state);
      textNode('div',integrityLabels[item.state] + (overdue ? ' · ค้างเกิน 2 นาที' : ''),state).style.cssText = overdue ? 'color:var(--re,#D93025)' : '';
      textNode('p',item.reason || integrityLabels[item.state],row).style.cssText = 'margin:0;overflow-wrap:anywhere';
      textNode('div','ลองบันทึกอีกครั้งโดยอัตโนมัติ: '+integrityTime(item.nextAttemptAt)+' · ส่งล่าสุด: '+integrityTime(item.lastAttemptAt),row).style.cssText = 'font-size:12px;color:var(--muted,#5F6368)';
    });
  }
  function integrityPoll(force) {
    if (!integrityEnabled) { integrityRender(); return Promise.resolve(false); }
    if (!integrityAllowed()) { integrityRender(); return Promise.resolve(false); }
    if (integrity.owner !== currentUser) { integrity = {owner:currentUser,status:'unknown',checkedAt:null,items:[],counts:{}}; integrityLastAttempt = 0; integrityBusy = null; integrityEpoch++; }
    if (integrityBusy) return integrityBusy;
    if (!force && integrityLastAttempt && Date.now() - integrityLastAttempt < 60000) return Promise.resolve(false);
    var owner = currentUser, epoch = integrityEpoch; integrityLastAttempt = Date.now();
    integrityRender();
    var request = (async function () {
      var timeout = null, controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
      try {
        if (typeof window.fetch !== 'function') throw new Error('integrity read unavailable');
        var options = {method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
        if (controller) options.signal = controller.signal;
        var read = (async function () {
          var response = await window.fetch('/__formula/job-integrity',options);
          if (!response.ok) throw new Error('integrity read failed');
          return response.json();
        })();
        var deadline = new Promise(function (_,reject) { timeout = setTimeout(function () { if (controller) controller.abort(); reject(new Error('integrity read timeout')); },15000); });
        var data = await Promise.race([read,deadline]);
        if (currentUser !== owner || !integrityAllowed() || epoch !== integrityEpoch) return false;
        integrity = integrityRead(data); return true;
      } catch (_) {
        if (currentUser === owner && integrityAllowed() && epoch === integrityEpoch) integrity.status = 'unknown';
        return false;
      } finally { if (timeout !== null && typeof window.clearTimeout === 'function') window.clearTimeout(timeout); integrityRender(); }
    })();
    integrityBusy = request;
    request.finally(function () { if (integrityBusy === request) integrityBusy = null; });
    return request;
  }
  function integritySchedule() {
    if (!integrityEnabled) return;
    setTimeout(function () { integrityPoll(false); integritySchedule(); },60000);
  }
  function releaseActivities(activities) {
    if (typeof logAct !== 'function') return;
    activitiesOf(activities).forEach(function (activity) {
      try { logAct(activity.cat,activity.action,activity.detail,activity.job); } catch (_) {}
    });
  }
  // Version history from central (runtime/record-versions.sql via
  // /__formula/job-versions). The sealed history popup reads recBakList(id)
  // (this browser's copies only, so an admin never saw what a pd changed on
  // her machine — 16 ต.ค. 2569 A02071). Merge the central versions into that
  // list when the popup opens; restore keeps using the sealed path, which
  // saves through the normal gate like any other edit.
  var serverVersions = {}, versionsBusy = {};
  function mergedVersions(id, local) {
    var server = serverVersions[id] || [];
    if (!server.length) return local;
    var out = local.slice(), seen = {};
    out.forEach(function (v) { if (v && v.data) seen[json(v.data)] = 1; });
    server.forEach(function (v) {
      var key = json(v.data);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ts: v.at, by: v.by, why: 'บันทึกในระบบกลาง', data: clone(v.data), central: true});
    });
    out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return out;
  }
  function noteVersions(id) {
    var box = document.getElementById('verBody');
    if (!box) return;
    var note = document.createElement('div'); note.className = 'tg-none';
    note.setAttribute('data-fs-central-versions', id);
    note.style.cssText = 'margin-top:10px';
    note.textContent = 'รวมเวอร์ชันจากระบบกลาง ' + (serverVersions[id] || []).length + ' รายการ (เห็นเหมือนกันทุกเครื่อง · ของในเครื่องนี้แสดงร่วมด้วย)';
    box.appendChild(note);
  }
  async function loadVersions(id) {
    if (!/^[A-Z]+[0-9]{5}$/.test(String(id)) || versionsBusy[id] || typeof window.fetch !== 'function') return false;
    versionsBusy[id] = true;
    try {
      var response = await window.fetch('/__formula/job-versions?id=' + encodeURIComponent(id), {method:'GET', credentials:'same-origin', cache:'no-store', headers:{Accept:'application/json'}});
      if (!response || !response.ok) throw new Error('versions unavailable');
      var body = await response.json();
      if (!body || body.id !== id || !Array.isArray(body.versions)) throw new Error('invalid versions');
      serverVersions[id] = body.versions.filter(function (v) {
        return v && typeof v.at === 'number' && v.data && typeof v.data === 'object' && v.data.id === id;
      }).slice(0, 12);
      if (document.getElementById('verBody') && typeof window.renderRecordHistory === 'function') window.renderRecordHistory(id);
      noteVersions(id);
      return true;
    } catch (_) { diag(id, 'job-versions', 'unavailable'); return false; }
    finally { delete versionsBusy[id]; }
  }
  if (typeof window.recBakList === 'function' && typeof window.openRecordHistory === 'function') {
    var localVersions = window.recBakList;
    window.recBakList = function (id) { return mergedVersions(id, localVersions.apply(this, arguments) || []); };
    var openHistory = window.openRecordHistory;
    window.openRecordHistory = function (id) {
      var result = openHistory.apply(this, arguments);
      if (document.getElementById('verBody')) loadVersions(id);
      return result;
    };
  }
  function startupReady() {
    return typeof window.__fsRuntimeBoot !== 'function' || (window.__fsCentralReady === true && window.__fsPermissionReady === true);
  }
  // Retire a local copy that this account can never save: the queue holds a
  // forbidden revision and a fresh read proves central has no such job. The
  // page copy and every queued variant go to the version history first; the
  // outbox keys are removed only after that copy is proven stored. Nothing is
  // sent to central. A fresh read that finds the job stops the removal.
  async function removeLocal(id) {
    switchActor();
    var p = queue[id], owner = actor, r = records.find(function (x) { return x.id === id; });
    if (!p || p.status !== 'forbidden' || storageError || !valid(r) || !canSeeRecord(r) || !startupReady()) return false;
    if (!window.confirm('ลบสำเนาในเครื่องของใบงาน ' + id + '? ระบบกลางไม่มีใบงานนี้ และบัญชีนี้บันทึกใบงานนี้ไม่ได้ · ฉบับในเครื่องจะถูกเก็บไว้ในประวัติเวอร์ชันก่อน และจะไม่ถูกส่งขึ้นระบบกลาง')) return false;
    try {
      var result = await sbReq('fs_records?id=eq.' + encodeURIComponent(id) + '&select=id,data', {method:'GET'});
      if (currentUser !== owner || actor !== owner || parentScopeBlocked(id) || queue[id] !== p) return false;
      if (!Array.isArray(result)) throw new Error('missing central lookup acknowledgement');
      if (result.some(function (row) { return row && row.id === id; })) {
        diag(id, 'remove-local', 'central-has-job', p.reason);
        window.alert('ระบบกลางมีใบงาน ' + id + ' แล้ว จึงไม่ลบสำเนาในเครื่อง กรุณาโหลดหน้าใหม่แล้วใช้ข้อมูลจากระบบกลาง');
        paint(); return false;
      }
      var review = {data: clone(r), variants: [p].concat(p.variants || [])};
      var kept = backup(review);
      if (!kept) {
        try { kept = await backupDurable(review); diag(id, 'remove-local', 'backup-indexeddb'); } catch (_) { kept = false; }
        if (currentUser !== owner || actor !== owner || parentScopeBlocked(id) || queue[id] !== p) return false;
      }
      if (!kept) { diag(id, 'remove-local', 'backup-failed'); throw new Error('backup failed'); }
      if (!forget(allKeys(p))) { diag(id, 'remove-local', 'outbox-removal-failed'); throw new Error('outbox removal failed'); }
      delete queue[id];
      load();
      if (queue[id]) { diag(id, 'remove-local', 'unreviewed-revision'); throw new Error('unreviewed revision'); }
      delete recTouched[id]; delete confirmed[id]; delete sbSnap.records[id]; delete receipts[id]; delete recLastJson[id];
      var i = records.findIndex(function (x) { return x.id === id; });
      if (i >= 0) records.splice(i, 1);
      var applying = sbApplying; sbApplying = true;
      try { saveRecordsStore(); } finally { sbApplying = applying; }
      baseline();
      diag(id, 'remove-local', 'removed', p.reason);
      sbRerender(); paint(); return true;
    } catch (_) { window.alert('ยังลบสำเนาในเครื่องไม่ได้ ข้อมูลยังอยู่ครบ กรุณาตรวจการเชื่อมต่อและพื้นที่เก็บข้อมูลในเครื่อง'); paint(); return false; }
  }
  async function useServer(id, automatic) {
    if (automatic) return recoverLegacy(id, 'auto');
    switchActor();
    var p = queue[id], owner = actor;
    if (!p || parentScopeBlocked(id) || storageError || !canSeeRecord(p.data)) return false;
    if (!automatic && !window.confirm('ใช้ข้อมูลล่าสุดจากระบบกลางสำหรับ ' + id + '? ระบบจะเก็บฉบับที่แก้ในหน้านี้ไว้ในประวัติใบงาน แล้วหยุดส่งฉบับนั้น')) return false;
    try {
      var result = await sbReq('fs_records?id=eq.' + encodeURIComponent(id) + '&select=id,data', {method:'GET'});
      if (currentUser !== owner || actor !== owner || parentScopeBlocked(id) || queue[id] !== p) return false;
      var row = Array.isArray(result) && result.find(function (r) { return r.id === id; });
      if (!row || !valid(row.data) || row.data.id !== id || !canSeeRecord(row.data)) throw new Error('no authorized server job');
      var kept = backup(p);
      if (!kept) {
        try { kept = await backupDurable(p); diag(id, 'adopt-server', 'backup-indexeddb'); } catch (_) { kept = false; }
        if (currentUser !== owner || actor !== owner || parentScopeBlocked(id) || queue[id] !== p) return false;
      }
      if (!kept) { diag(id, 'adopt-server', 'backup-failed'); throw new Error('backup failed'); }
      if (!forget(allKeys(p))) { diag(id, 'adopt-server', 'outbox-removal-failed'); throw new Error('outbox removal failed'); }
      delete queue[id];
      load();
      confirmed[id] = clone(row.data); sbSnap.records[id] = json(row.data); delete recTouched[id];
      var i = records.findIndex(function (r) { return r.id === id; });
      if (i < 0) records.push(clone(row.data)); else records[i] = clone(row.data);
      baseline();
      var applying = sbApplying; sbApplying = true;
      try { saveRecordsStore(); } finally { sbApplying = applying; }
      sbRerender(); paint(); return true;
    } catch (_) { if (!automatic) window.alert('ยังใช้ข้อมูลจากระบบกลางไม่ได้ ใบงานฉบับที่รอการบันทึกยังอยู่ กรุณาตรวจการเชื่อมต่อและพื้นที่เก็บข้อมูลในเครื่อง'); paint(); return false; }
  }
  function legacyBlocked(id) {
    return !!id && (own(suppressed,id) || own(suppressedRecords,id))
      && records.some(function (r) { return r && r.id === id && canSeeRecord(r); });
  }
  function clearLegacyBlock(id) {
    delete suppressed[id]; delete suppressedRecords[id];
    blockedLegacy = Object.keys(suppressed).length > 0 || Object.keys(suppressedRecords).length > 0;
  }
  async function recoverLegacy(id, choice) {
    switchActor();
    var owner=actor, local=records.find(function (r) { return r && r.id === id; }), snapshot=local && clone(local), prior=queue[id] && clone(queue[id]);
    var automatic = choice === 'auto';
    var blocked=legacyBlocked(id), marker=json([suppressed[id] || null,suppressedRecords[id] || null]);
    if (parentScopeBlocked(id) || legacyRecoveryBusy[id] || (!blocked && !(automatic && prior && /^(conflict|forbidden|invalid|unconfirmed)$/.test(prior.status)))
      || storageError || !local || !canSeeRecord(local)) return false;
    if (!automatic && choice !== 'server' && choice !== 'local') return false;
    if (automatic && typeof window.__fsRuntimeBoot === 'function'
      && (window.__fsCentralReady !== true || window.__fsPermissionReady !== true)) {
      setRecoveryDiagnostic(id, choice, 'central-handshake', 'failed'); paint(); return false;
    }
    var prompt = choice === 'server'
      ? 'ใช้ข้อมูลล่าสุดจากระบบกลางสำหรับ ' + id + '? ฉบับในหน้านี้จะถูกเก็บไว้ในประวัติเวอร์ชันก่อนปลดล็อกแชต'
      : 'ส่งฉบับที่แสดงในหน้านี้สำหรับ ' + id + '? จะส่งได้เฉพาะเมื่อระบบกลางยังไม่มีใบงานนี้ และจะไม่เขียนทับใบงานที่มีอยู่';
    if (!automatic && !window.confirm(prompt)) return false;
    legacyRecoveryBusy[id]=true;
    var recoveryStage = typeof window.__fsRuntimeBoot === 'function' && window.__fsCentralReady !== true ? 'central-handshake' : 'central-lookup';
    setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
    try {
      // Read immutable actor-owned revisions even when the storage event has
      // not arrived. Keep the memory snapshot too; never reload over an edit.
      recoveryStage='concurrency-check';
      var durable=readOutbox()[id] || null;
      if (prior && prior.fallback) throw new Error('fallback conflict requires journal review');
      var variants=(prior ? [prior].concat(prior.variants || []) : []).concat(durable ? [durable].concat(durable.variants || []) : []);
      var reviewedKeys=Array.from(new Set((prior ? allKeys(prior) : []).concat(durable ? allKeys(durable) : [])));
      function unchanged() {
        return currentUser === owner && actor === owner && !storageError && !parentScopeBlocked(id)
          && legacyBlocked(id) === blocked && json([suppressed[id] || null,suppressedRecords[id] || null]) === marker
          && json(records.find(function (r) { return r && r.id === id; }) || null) === json(snapshot)
          && json(queue[id] || null) === json(prior || null)
          && json(readOutbox()[id] || null) === json(durable);
      }
      recoveryStage='central-lookup';
      var result=await sbReq('fs_records?id=eq.' + encodeURIComponent(id) + '&select=id,data',{method:'GET'});
      recoveryStage='concurrency-check';
      if (!unchanged()) {
        setRecoveryDiagnostic(id, choice, 'concurrency-check', 'failed'); return false;
      }
      if (automatic && typeof window.__fsRuntimeBoot === 'function'
        && (window.__fsCentralReady !== true || window.__fsPermissionReady !== true)) {
        setRecoveryDiagnostic(id, choice, 'central-handshake', 'failed'); paint(); return false;
      }
      var classification=automatic ? classifyRecoveryLookup(result,id) : null;
      if (automatic && classification.kind === 'invalid') {
        setRecoveryDiagnostic(id, choice, 'central-response', 'failed'); paint(); return false;
      }
      if (!automatic && !Array.isArray(result)) { recoveryStage='central-response'; throw new Error('missing legacy lookup acknowledgement'); }
      var row=automatic && classification.kind === 'server' ? classification.row : result.find(function (r) { return r && r.id === id; });
      var selected = automatic ? (classification.kind === 'server' ? 'server' : 'local') : choice;
      if (selected === 'server') {
        if (!row || !valid(row.data) || row.data.id !== id || !canSeeRecord(row.data)) {
          setRecoveryDiagnostic(id, choice, 'central-response', 'failed');
          if (!automatic) window.alert('ระบบกลางยังไม่มีข้อมูลใบงานนี้ จึงใช้ฉบับระบบกลางไม่ได้'); paint(); return false;
        }
        var serverReview={data:clone(snapshot),expected:clone(row.data),variants:variants};
        recoveryStage='local-backup'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
        if (!backup(serverReview)) throw new Error('legacy backup failed');
        recoveryStage='concurrency-check';
        if (!unchanged()) throw new Error('recovery changed during backup');
        var index=records.findIndex(function (r) { return r.id === id; });
        var tracked=own(recLastJson,id) ? recLastJson[id] : null;
        if (index < 0) records.push(clone(row.data)); else records[index]=clone(row.data);
        var applying=sbApplying; sbApplying=true;
        recoveryStage='local-persistence'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
        try {
          saveRecordsStore();
          if (localStorage.getItem('fs_records') !== JSON.stringify(records)) throw new Error('legacy record persistence failed');
        }
        catch (error) {
          if (index < 0) records.pop(); else records[index]=snapshot;
          if (tracked === null) delete recLastJson[id]; else recLastJson[id]=tracked;
          throw error;
        }
        finally { sbApplying=applying; }
        recoveryStage='outbox-cleanup'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
        if (!forget(reviewedKeys)) throw new Error('legacy outbox removal failed');
        recoveryStage='concurrency-check';
        var remaining=readOutbox()[id];
        if (remaining) { queue[id]=remaining; throw new Error('unreviewed recovery revision'); }
        delete queue[id];
        confirmed[id]=clone(row.data); sbSnap.records[id]=json(row.data); delete recTouched[id];
        baseline(); clearLegacyBlock(id);
        if (!ready(id)) { suppressedRecords[id]=true; blockedLegacy=true; throw new Error('legacy central readiness failed'); }
        setRecoveryDiagnostic(id, choice, 'complete', 'complete');
        sbRerender(); paint(); return true;
      }
      if (row || (automatic && !blocked && !/^(conflict|unconfirmed)$/.test(prior.status))) {
        setRecoveryDiagnostic(id, choice, 'central-response', 'failed');
        if (!automatic) window.alert('ระบบกลางมีใบงานนี้แล้ว กรุณาใช้ข้อมูลจากระบบกลางก่อนแก้ไข ระบบจะยังไม่บันทึกทับ');
        paint(); return false;
      }
      var current=records.find(function (r) { return r && r.id === id; });
      if (!current || json(current) !== json(snapshot)) {
        setRecoveryDiagnostic(id, choice, 'concurrency-check', 'failed'); return false;
      }
      var localReview={data:clone(snapshot),expected:null,variants:variants};
      recoveryStage='local-backup'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
      if (!backup(localReview)) throw new Error('legacy backup failed');
      recoveryStage='concurrency-check';
      if (!unchanged()) throw new Error('recovery changed during backup');
      queue[id]={data:clone(snapshot),expected:null,status:'pending',activities:[],keys:[],variants:[]};
      recoveryStage='local-persistence'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
      if (!persist()) { if (prior) queue[id]=prior; else delete queue[id]; throw new Error('legacy outbox persistence failed'); }
      recoveryStage='outbox-cleanup'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
      if (!forget(reviewedKeys)) { if (prior) queue[id]=prior; throw new Error('legacy outbox removal failed'); }
      load(); recTouched[id]=1; baseline();
      recoveryStage='recovery-request'; setRecoveryDiagnostic(id, choice, recoveryStage, 'running');
      var saved=await flush();
      var complete=!!saved && currentUser === owner && actor === owner && !queue[id]
        && json(records.find(function (r) { return r && r.id === id; }) || null) === json(snapshot)
        && own(confirmed,id) && json(confirmed[id]) === json(snapshot);
      if (complete) {
        clearLegacyBlock(id);
        complete=ready(id);
        if (!complete) { suppressedRecords[id]=true; blockedLegacy=true; }
      }
      setRecoveryDiagnostic(id, choice, complete ? 'complete' : 'recovery-request', complete ? 'complete' : 'failed');
      paint(); return complete;
    } catch (_) {
      setRecoveryDiagnostic(id, choice, recoveryStage, 'failed');
      if (!automatic) window.alert('ยังแก้สถานะการบันทึกใบงานนี้ไม่ได้ ฉบับในหน้านี้ยังอยู่ กรุณาตรวจการเชื่อมต่อและพื้นที่เก็บข้อมูลในเครื่อง');
      paint(); return false;
    } finally { delete legacyRecoveryBusy[id]; }
  }
  async function useLocalCreate(id, automatic) {
    if (automatic) return recoverLegacy(id, 'auto');
    switchActor();
    var owner = actor, chosen = records.find(function (r) { return r.id === id; });
    if (parentScopeBlocked(id) || !queue[id] || storageError || !valid(chosen) || !canSeeRecord(chosen)) return false;
    chosen = clone(chosen);
    if (!automatic && !window.confirm('บันทึกฉบับที่แสดงในหน้านี้สำหรับ ' + id + '? ทำได้เมื่อระบบกลางยังไม่มีใบงานนี้ โดยระบบจะเก็บทุกฉบับที่รอการบันทึกไว้ในประวัติใบงานก่อน')) return false;
    try {
      var result = await sbReq('fs_records?id=eq.' + encodeURIComponent(id) + '&select=id,data', {method:'GET'});
      if (currentUser !== owner || actor !== owner || parentScopeBlocked(id) || json(records.find(function (r) { return r.id === id; })) !== json(chosen)) return false;
      if (!Array.isArray(result)) throw new Error('missing lookup acknowledgement');
      if (result.length) {
        if (!automatic) window.alert('ระบบกลางมีใบงานนี้แล้ว กรุณาตรวจสอบและเลือกใช้ข้อมูลจากระบบกลางก่อนแก้ไข ระบบจะยังไม่บันทึกทับ');
        return false;
      }
      // Re-read immutable revisions before backing up, so variants received
      // while the fresh lookup was running are included in the review.
      load();
      var previous = queue[id];
      if (!previous || storageError) return false;
      var reviewed = allKeys(previous);
      if (!backup({data:chosen,variants:[previous].concat(previous.variants || [])})) throw new Error('backup not persisted');
      queue[id] = {data:chosen,expected:null,status:'pending',activities:activitiesOf(previous.activities || previous.activity),keys:[],variants:[]};
      if (!persist()) { queue[id] = previous; throw new Error('chosen revision not persisted'); }
      // The selected create-only revision is durable BEFORE reviewed keys are
      // removed. A new concurrent revision is never part of this removal set.
      if (!forget(reviewed)) throw new Error('reviewed revisions not cleared');
      load();
      recTouched[id] = 1; baseline(); sbQueue(); paint(); return true;
    } catch (_) {
      if (!automatic) window.alert('ยังบันทึกฉบับนี้ไม่ได้ ฉบับที่รอการบันทึกยังอยู่ กรุณาตรวจพื้นที่เก็บข้อมูลในเครื่องและการเชื่อมต่อ');
      paint(); return false;
    }
  }
  var automaticRecoveryBusy = {};
  async function readOnlyReconcile(id) {
    switchActor();
    var owner = actor, local = records.find(function (record) { return record && record.id === id; });
    if (!owner || parentScopeBlocked(id) || !local || !canSeeRecord(local) || typeof sbReq !== 'function') return false;
    try {
      var result = await sbReq('fs_records?id=eq.' + encodeURIComponent(id) + '&select=id,data', {method:'GET'});
      if (currentUser !== owner || actor !== owner || parentScopeBlocked(id)) return false;
      var lookup = classifyRecoveryLookup(result, id);
      if (lookup.kind !== 'server') return false;
      var row = lookup.row, index = records.findIndex(function (record) { return record && record.id === id; });
      if (index < 0) return false;
      // Keep this path deliberately in-memory: opening Chat may repair a stale
      // view, but must never flush another pending record or write a browser
      // journal merely because the user clicked a Chat link.
      records[index] = clone(row.data);
      confirmed[id] = clone(row.data);
      sbSnap.records[id] = json(row.data);
      delete recTouched[id];
      baseline(); sbRerender(); paint();
      return ready(id);
    } catch (_) { return false; }
  }
  async function autoReconcile(id) {
    switchActor();
    if (ready(id)) return true;
    if (automaticRecoveryBusy[id]) return automaticRecoveryBusy[id];
    var request = (async function () {
      notices[id] = {kind:'pending',text:'กำลังตรวจสอบข้อมูลใบงานก่อนเปิดแชต…'};
      paint();
      try {
        if (legacyBlocked(id)) return await recoverLegacy(id, 'auto');
        var pending = queue[id];
        if (pending) {
          if (!/^(conflict|forbidden|invalid|unconfirmed)$/.test(pending.status)) {
            await flush();
            if (ready(id)) return true;
            pending = queue[id];
          }
          if (pending && /^(conflict|forbidden|invalid|unconfirmed)$/.test(pending.status)) {
            return await recoverLegacy(id, 'auto');
          }
        }
        return await readOnlyReconcile(id);
      } catch (_) {
        return false;
      } finally {
        delete automaticRecoveryBusy[id];
        if (ready(id)) delete notices[id];
        else notices[id] = {kind:'failed',text:'ยังเปิดแชตไม่ได้ · ระบบจะตรวจสอบใหม่อัตโนมัติ'};
        paint();
      }
    })();
    automaticRecoveryBusy[id] = request;
    return request;
  }
  function bulkGuard() {
    if (sbGuardTake) return true;
    if (sbGuardOK) return false;
    var hit = Object.keys(queue).filter(function (id) {
      var p = queue[id];
      return p.expected && json(p.expected.rows || []) !== json(p.data.rows || []);
    });
    if (hit.length > SB_GUARD_MAX) { sbGuardHold(hit); return true; }
    return false;
  }
  async function fallbackSession(entry, owner) {
    var session=await trustedSession(owner);
    if (!entry || entry.owner !== owner || !identityMatches(entry.identity, session, owner)
      || !entry.actor || session.name !== entry.actor.name || session.role !== entry.actor.role
      || (entry.actor.email && session.email !== normalizedEmail(entry.actor.email))) throw new Error('fallback session changed');
    return session;
  }
  async function updateFallback(p, state) {
    var ref=fallback[p.data.id];
    if (!ref || !ref.verified || !p.fallback || ref.key !== p.fallback) throw new Error('fallback journal unavailable');
    var entry=clone(ref.entry);
    entry.recordAck=!!state.recordAck; entry.activities=clone(state.activities); entry.status=state.status;
    await idbWrite(ref.db,ref.key,entry);
    var readback=await idbRead(ref.db,ref.key);
    if (!exact(readback,entry)) throw new Error('fallback acknowledgement not durable');
    ref.entry=entry; return entry;
  }
  function businessActivity(data) {
    var value=clone(data || {}); delete value.user; delete value.role; return value;
  }
  function activityAcknowledged(result, activity, journal) {
    return Array.isArray(result) && result.some(function(row) {
      // The gateway is authoritative for actor fields. Everything else,
      // including stable UID/ts and the business audit payload, is immutable.
      // The stored row wins when it already exists (append-only, first writer
      // wins): a row the gateway stamped for this actor, or an identical row it
      // already holds, both prove the journal entry is durable in central. An
      // unstamped row (no actor at all) never counts.
      if (!row || row.uid !== activity.uid || row.ts !== activity.ts || !row.data || !journal.actor) return false;
      var stamped = typeof row.data.user === 'string' && row.data.user && typeof row.data.role === 'string' && row.data.role;
      if (!stamped) return false;
      return exact(businessActivity(row.data),businessActivity(activity));
    });
  }
  function pendingFormSnapshot() {
    var root=document.getElementById('inputView');
    if (!root) return null;
    var controls=[];
    (function walk(node) {
      if (!node) return;
      var tag=String(node.tagName || '').toUpperCase();
      if (node.id && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
        controls.push({id:node.id,value:node.value == null ? '' : String(node.value),checked:!!node.checked,selectedIndex:typeof node.selectedIndex === 'number' ? node.selectedIndex : null});
      }
      Array.prototype.forEach.call(node.children || [],walk);
    })(root);
    var section=function(id){ var node=document.getElementById(id); return node && typeof node.innerHTML === 'string' ? node.innerHTML : null; };
    return {controls:controls,ingredients:section('ingBody'),claims:section('tc_claims'),constraints:section('tc_cons'),concepts:typeof selectedConcepts === 'undefined' ? [] : clone(selectedConcepts)};
  }
  function completeGeneratorForm(id, owner) {
    var completion=generatorCompletions[id];
    if (!completion || completion.owner !== owner || currentUser !== owner || actor !== owner) return;
    delete generatorCompletions[id];
    // This is the sealed form clear captured during its original Create
    // action. It is intentionally delayed until both immutable acknowledgements
    // have succeeded, never recreated from a later browser state.
    if (window._editingRecordId === id) {
      window._editingRecordId=null;
      if (typeof window.hideEditingBanner === 'function') window.hideEditingBanner();
    }
    // The form stays editable while central acknowledgement is pending. Never
    // erase values typed after the immutable journal was created; they are a
    // new unsaved draft, not part of the acknowledged record.
    if (completion.snapshot && !exact(completion.snapshot,pendingFormSnapshot())) {
      var field=document.getElementById('gen_err');
      if (field) { field.textContent='ใบงาน ' + id + ' บันทึกแล้ว ข้อมูลในฟอร์มถูกแก้ไขระหว่างรอยืนยัน จึงคงไว้เป็นฉบับใหม่'; field.setAttribute('role','status'); }
      return;
    }
    completion.clear();
  }
  async function flushFallback(id,p,owner) {
    var ref=fallback[id];
    if (!ref || !ref.verified || !p.fallback || ref.key !== p.fallback || !ref.entry || ref.entry.owner !== owner) return false;
    var entry=ref.entry, value=json(p.data), remaining=clone(entry.activities || []);
    if (!entry.recordAck) {
      await fallbackSession(entry,owner);
      var result=await sbReq('rpc/fs_save_record',{method:'POST',body:{p_id:id,p_data:clone(entry.data),p_expected:clone(entry.expected)}});
      if (currentUser !== owner || actor !== owner) return false;
      await fallbackSession(entry,owner);
      if (!result || result.status !== 'saved' || result.id !== id || !result.data || json(result.data) !== value) {
        p.status=result && /^(conflict|forbidden|invalid)$/.test(result.status) ? result.status : 'unconfirmed'; return false;
      }
      entry=await updateFallback(p,{recordAck:true,activities:remaining,status:remaining.length ? 'activity-pending' : 'acknowledged'});
      confirmed[id]=clone(result.data); sbSnap.records[id]=value; receipts[id]=value;
    }
    for (var index=0;index<remaining.length;index++) {
      var activity=remaining[index];
      await fallbackSession(entry,owner);
      var response=await sbReq('fs_activities',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:[{uid:activity.uid,ts:activity.ts,data:clone(activity)}]});
      if (currentUser !== owner || actor !== owner) return false;
      await fallbackSession(entry,owner);
      if (!activityAcknowledged(response,activity,entry)) { p.status='activity-pending'; return false; }
      remaining=remaining.slice(index+1); index=-1;
      entry=await updateFallback(p,{recordAck:true,activities:remaining,status:remaining.length ? 'activity-pending' : 'acknowledged'});
    }
    await fallbackSession(entry,owner);
    await idbDeleteExact(ref.db,ref.key,entry);
    delete fallback[id]; forgetFallbackIndex(ref.key); delete queue[id]; delete recTouched[id]; delete sbSnap.chats[id];
    completeGeneratorForm(id,owner);
    var acknowledged = clone(p.data), signature = json(acknowledged);
    if (await verifyCentralRecord(id, acknowledged)) {
      verifiedRecordCache[id] = signature;
      compactVerifiedRecordCache();
    }
    return true;
  }
  async function flush() {
    switchActor();
    if (flushing) return flushing;
    if (!actor || storageError || !sbReady || !sbCanEdit || bulkGuard()) {
      if (Object.keys(queue).length) diag('', 'flush-gate', !actor ? 'no-actor' : storageError ? 'storage-error' : !sbReady ? 'central-not-ready' : !sbCanEdit ? 'cannot-edit' : 'bulk-guard');
      paint(); return false;
    }
    var owner = actor;
    flushing = (async function () {
      var savedAny = false;
      for (var id of Object.keys(queue)) {
        if (currentUser !== owner || actor !== owner || storageError) break;
        var p = queue[id];
        if (parentScopeBlocked(id)) continue;
        // A forbidden verdict is not permanent: the server rule or the user's
        // grant can change after the fact (12 ต.ค. 2569 owner-email release).
        // Retry it once per page load so the next verdict is current and logged;
        // conflict and invalid still need a human or a new edit.
        if (p && p.status === 'forbidden' && !forbiddenRetried[id]) { forbiddenRetried[id] = true; p.status = 'pending'; }
        if (p && /^(conflict|forbidden|invalid)$/.test(p.status)) diag(id, 'queue-skip', p.status, p.reason);
        else if (p && unknownExpected(p.expected)) diag(id, 'queue-skip', 'unknown-baseline');
        else if (p && p.variants && p.variants.length) diag(id, 'queue-skip', 'variants');
        if (!p || fallbackStaging[id] || p.status === 'fallback-staging' || p.status === 'fallback-failed' || unknownExpected(p.expected) || (p.variants && p.variants.length) || !valid(p.data) || /^(conflict|forbidden|invalid)$/.test(p.status)) continue;
        if (p.fallback) {
          try { if (await flushFallback(id,p,owner)) savedAny=true; }
          catch (_) { if (queue[id]) queue[id].status='activity-pending'; }
          continue;
        }
        var sent = clone(p.data), expected = clone(p.expected), value = json(sent), sentKeys = p.keys.slice(), sentActivities = activitiesOf(p.activities || p.activity);
        // A committed save can lose its HTTP response after the database has
        // accepted it. If the next full pull proves that the central row is
        // byte-for-byte the same as this create-only journal, acknowledge the
        // durable journal locally instead of retrying with p_expected=null.
        // The RPC correctly rejects that retry as a create conflict, which
        // used to leave the user stuck even though the record was already
        // saved. Activities still go through the normal exact-ACK path.
        if (expected === null && own(confirmed,id) && json(confirmed[id]) === value) {
          if (!sentActivities.length) {
            if (!forget(sentKeys)) continue;
            load();
            if (!queue[id]) {
              delete recTouched[id]; receipts[id] = value;
              delete sbSnap.chats[id];
              chats.filter(function (c) { return c.jobId === id; }).forEach(function (c) {
                (c.messages || []).forEach(function (m) { delete sbSnap.msgs[msgUid(id,m)]; });
              });
              CHAT_PARTS.forEach(function (part) { delete sbSnap.apvs[id+'|'+part.key]; });
              if (await verifyCentralRecord(id, sent)) {
                verifiedRecordCache[id] = value;
                compactVerifiedRecordCache();
              }
              savedAny = true;
              continue;
            }
          } else {
            expected = clone(confirmed[id]);
            if (json(p.data) === value) { p.expected = clone(expected); p.status = 'pending'; persist(); }
          }
        }
        try {
          var result = await sbReq('rpc/fs_save_record', {method:'POST', body:{p_id:id, p_data:sent, p_expected:expected}});
          if (currentUser !== owner || actor !== owner || storageError) break;
          var current = queue[id];
          if (!current) continue;
          if (result && result.status === 'queued' && result.id === id) {
            if (json(current.data) === value) current.status = 'queued';
            persist(); continue;
          }
          if (!result || result.status !== 'saved' || result.id !== id || !result.data || json(result.data) !== value) {
            var verdict = result && /^(conflict|forbidden|invalid|retry)$/.test(result.status) ? result.status : 'unconfirmed';
            diag(id, 'save-result', verdict, result && (result.reason_code || result.reason));
            if (json(current.data) === value) {
              current.status = verdict === 'retry' ? 'unconfirmed' : verdict;
              // This page has now seen the live verdict; the next page load gets one retry.
              if (verdict === 'forbidden') forbiddenRetried[id] = true;
              if (result && (result.reason_code || result.reason)) current.reason = String(result.reason_code || result.reason).slice(0,64); else delete current.reason;
            }
            persist(); continue;
          }
          confirmed[id] = clone(result.data);
          sbSnap.records[id] = value;
          if (json(current.data) === value) {
            if (!forget(sentKeys)) continue;
            load();
            if (!queue[id]) delete recTouched[id];
          }
          else { forget(sentKeys); current.expected = clone(result.data); current.status = 'pending'; current.activities = keepActivities(current.activities || current.activity, sentActivities); delete current.activity; }
          // Legacy filtered writes used to mark a blocked room as synced. Once
          // the job is acknowledged, ensure its pending chat work is retried.
          delete sbSnap.chats[id];
          chats.filter(function (c) { return c.jobId === id; }).forEach(function (c) {
            (c.messages || []).forEach(function (m) { delete sbSnap.msgs[msgUid(id,m)]; });
          });
          CHAT_PARTS.forEach(function (part) { delete sbSnap.apvs[id+'|'+part.key]; });
          receipts[id] = value;
          releaseActivities(sentActivities);
          persist(); savedAny = true;
          if (!queue[id] && json(records.find(function (row) { return row && row.id === id; }) || null) === value
            && await verifyCentralRecord(id, sent)) {
            verifiedRecordCache[id] = value;
            compactVerifiedRecordCache();
          }
        } catch (_) { if (currentUser !== owner || actor !== owner) break; diag(id, 'save-request', 'network-error'); if (queue[id]) queue[id].status = 'retry'; persist(); }
      }
      paint();
      if (typeof window.__fsUpdateFormulaSaveStatuses === 'function') window.__fsUpdateFormulaSaveStatuses();
      return savedAny;
    })();
    try { return await flushing; } finally { flushing = null; }
  }
  function install() {
    if (installed) return;
    if (typeof saveRecordsStore !== 'function' || typeof sbApply !== 'function' || typeof sbPush !== 'function' || typeof sbUpsert !== 'function' || typeof stableStr !== 'function') {
      setTimeout(install, 50); return;
    }
    var delegatedBoot = typeof window.__fsRuntimeBoot === 'function' && typeof sbPull === 'function' && typeof sbReq === 'function';
    delegatedRuntime = delegatedBoot;
    var startupRequest = delegatedBoot ? sbReq : null;
    var startupPull = delegatedBoot ? sbPull : null;
    var startupFillIds = delegatedBoot && typeof sbFillIdPool === 'function' ? sbFillIdPool : null;
    var startupCycle = delegatedBoot && typeof sbCycle === 'function' ? sbCycle : null;
    var startupChip = delegatedBoot && typeof sbChip === 'function' ? sbChip : null;
    var startupPermission = delegatedBoot && typeof sbLoadWritePermission === 'function' ? sbLoadWritePermission : null;
    var permissionReady = !delegatedBoot || !startupPermission;
    var historyDeferred = delegatedBoot, historyRunning = false, historyFollowup = false, idWarmPromise = null, startHistoryRefresh = null;
    var hiddenChatInputs=Object.create(null);
    var pendingHydration = Object.create(null), roomVersions = Object.create(null), approvalVersions = Object.create(null);
    var cyclePromise = null, cycleAgain = false, cacheWake = null, joiningChatEventCycle=false;
    var currentVisibleJobIds = null, activeVisibleSnapshot = null, visibleScopePromise = null, visibleScopeOwner = '';
    function observeVisibleScope(ids) {
      // A known central parent can be transferred/deleted while its old
      // owner copy still passes canSeeRecord. That copy grants no authority.
      lastVerifiedParentIds=Object.assign(Object.create(null),ids);
      var known=Object.assign({},currentVisibleJobIds || {},confirmed);
      Object.keys(queue).forEach(function (id) { if (queue[id].expected && !unknownExpected(queue[id].expected)) known[id]=true; });
      Object.keys(known).forEach(function (id) { if (!ids[id]) revokedCentralRecords[id]=true; });
    }

      async function scopedRows(table, select, ids, column, order) {
        var keys=Object.keys(ids), result=[], seen=Object.create(null);
        for (var offset=0;offset<keys.length;offset+=50) {
          var batch=keys.slice(offset,offset+50), filter='in.'+encodeURIComponent('('+batch.map(function (id) {return '"'+id+'"';}).join(',')+')');
          var path=table+'?select='+select+'&'+column+'='+filter+'&order='+order;
          // The sealed helper accepts malformed later pages as a partial
          // result. Scoped history must stage and validate every page itself.
          for (var from=0;;from+=1000) {
            var rows=await readWithinDeadline(function () {return startupRequest(path,{headers:{'Range-Unit':'items',Range:from+'-'+(from+999)}});});
            if (!Array.isArray(rows) || rows.length>1000) throw new Error('scoped history incomplete');
            rows.forEach(function (row) {
              if (!row || batch.indexOf(row[column])<0 || select.indexOf('data')>=0 && (!row.data || typeof row.data!=='object' || Array.isArray(row.data))) throw new Error('scoped history invalid');
              if (table==='fs_messages' && (typeof row.uid!=='string' || !row.uid) || table==='fs_approvals' && (typeof row.part!=='string' || !row.part)) throw new Error('scoped history invalid');
              var key=table==='fs_messages'?row.job_id+'|'+row.uid:table==='fs_approvals'?row.job_id+'|'+row.part:row[column];
              if (seen[key]) throw new Error('scoped history duplicate');seen[key]=true;
            });
            result=result.concat(rows);
            if (rows.length<1000) break;
          }
        }
        return result;
      }
      function hideUnknownScope() {
        invalidateChatStoragePause();targetedRooms=Object.create(null);targetedOpenSequence++;sbReady = false; window.__fsCentralReady = false; currentVisibleJobIds = null;
        if (visibleIdentity && stashPendingForIdentity(visibleIdentity)) {
          if (clearConfirmedChatCache(visibleIdentity)) chats = [];
          else chatRecoveryBlocked = true;
        }
        closeChatForUnknownScope();
      }
    async function readScopedChatHistory(ids) {
      var keys=Object.keys(ids), result={chats:[],messages:[]}, seenRooms=Object.create(null), seenMessages=Object.create(null);
      for (var offset=0;offset<keys.length;offset+=50) {
        var batch=keys.slice(offset,offset+50), filter='in.('+batch.map(function (id) {return JSON.stringify(id);}).join(',')+')';
        var read=await readWithinDeadline(async function () {
          var response=await window.fetch('/__formula/scoped-chat-history?job_id='+encodeURIComponent(filter),{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
          return {response:response,data:await response.json().catch(function () {return null;})};
        },30000);
        var snapshot=read.data;
        if (!read.response.ok || !snapshot || !Array.isArray(snapshot.chats) || !Array.isArray(snapshot.messages)) {
          var error=new Error('scoped history incomplete');error.status=read.response.status;throw error;
        }
        [snapshot.chats,snapshot.messages].forEach(function (rows,table) {
          rows.forEach(function (row) {
            if (!row || batch.indexOf(row.job_id)<0 || !row.data || typeof row.data!=='object' || Array.isArray(row.data)
              || table===1 && (typeof row.uid!=='string' || !row.uid)) throw new Error('scoped history invalid');
            var key=table===1?row.job_id+'|'+row.uid:row.job_id, seen=table===1?seenMessages:seenRooms;
            if (seen[key]) throw new Error('scoped history duplicate');seen[key]=true;
          });
        });
        result.chats=result.chats.concat(snapshot.chats);result.messages=result.messages.concat(snapshot.messages);
      }
      return result;
    }
    async function readVisibleSnapshot(owner) {
      var scope=await readVisibleJobIds(owner);
      var history=await readScopedChatHistory(scope.ids), rooms=history.chats, messages=history.messages;
      var finalScope=await readVisibleJobIds(owner);
      if (scope.identity!==finalScope.identity || json(scope.ids)!==json(finalScope.ids)) throw new Error('visible scope changed during read');
      if (visibleIdentity && visibleIdentity!==scope.identity) {
        if (!stashPendingForIdentity(visibleIdentity)) throw new Error('pending chat recovery could not be saved');
        if (!clearConfirmedChatCache(visibleIdentity)) {chatRecoveryBlocked=true;throw new Error('old chat cache could not be cleared safely');}
        visibleHistoryIdentity='';visibleIdentity=scope.identity;visibleGeneration++;
      }
      return {identity:scope.identity,chats:rooms,messages:messages};
    }
    async function readVisibleJobIdsNow(owner) {
      var before = await trustedSession(owner), ids = Object.create(null);
      var read=await readWithinDeadline(async function () {
        var response=await window.fetch('/__formula/visible-record-ids', {method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
        return {response:response,data:await response.json()};
      });
      var response=read.response, scope=read.data;
      if (!response.ok || !scope || !Array.isArray(scope.ids)) { var error = new Error('visible record scope unavailable'); error.status = response.status; throw error; }
      scope.ids.forEach(function (id) {
        if (typeof id !== 'string' || !id || ids[id]) throw new Error('visible record scope malformed');
        ids[id] = true;
      });
      var after = await trustedSession(owner);
      if (before.identity !== after.identity || owner !== currentUser) throw new Error('user or role changed during scope read');
      return {identity:after.identity, ids:ids};
    }
    function readVisibleJobIds(owner) {
      if (visibleScopePromise) {
        if (visibleScopeOwner === owner) return visibleScopePromise;
        return visibleScopePromise.catch(function () {}).then(function () { return readVisibleJobIds(owner); });
      }
      visibleScopeOwner = owner;
      var wrapped = readVisibleJobIdsNow(owner).finally(function () {
        if (visibleScopePromise === wrapped) { visibleScopePromise = null; visibleScopeOwner = ''; }
      });
      visibleScopePromise = wrapped;
      return visibleScopePromise;
    }
    function pruneChatsToVisibleScope(ids) {
      if (!stashPendingForIdentity(visibleIdentity)) throw new Error('pending chat recovery could not be saved');
      if (!preserveUnclassifiedChatCache(visibleIdentity,confirmedChatData,[])) throw new Error('unclassified legacy chat cache could not be preserved');
      var previous = Array.isArray(chats) ? chats : [], filtered = previous.filter(function (room) { return room && ids[room.jobId]; });
      if (filtered.length === previous.length) return true;
      var revokedOpenRoom = chatOpenId && !ids[chatOpenId];
      chats = filtered;
      try {
        var slim = slimChats();
        writeChatCache(JSON.stringify(slim || filtered));
        try {localStorage.setItem('fs_chat_cache_owner_v1',visibleIdentity);} catch (error) {if (!quotaError(error)) throw error;chatQuotaRecovered=true;}
        if (revokedOpenRoom) {
          preserveHiddenChatInput();
          chatOpenId = null;
          if (typeof renderChatMenu === 'function') { try { renderChatMenu(); } catch (_) {} }
          if (typeof renderChat === 'function') { try { renderChat(); } catch (_) {} }
        }
        return true;
      } catch (_) {
        chats = previous; chatRecoveryBlocked = true;
        throw new Error('visible chat cache could not be safely updated');
      }
    }
    function chatReconciliationState(d,snapshot) {
      if (!d || !Array.isArray(d.rec)) throw new Error('latest record scope unavailable');
      var visible=Object.create(null), messages=Object.create(null);
      d.rec.forEach(function (row) {if (!row || typeof row.id!=='string' || !row.id || visible[row.id]) throw new Error('latest record scope invalid');visible[row.id]=true;});
      var rooms=snapshot.chats.filter(function (row) {return row && visible[row.job_id];});
      snapshot.messages.forEach(function (row) {if (row && visible[row.job_id] && typeof row.uid==='string') {var message=clone(row.data || {});if (!message.uid) message.uid=row.uid;messages[row.job_id+'|'+row.uid]=message;}});
      return {visible:visible,rooms:rooms,messages:messages};
    }
    function exactChatAcknowledged(entry,identity,state) {
      var item=entry.value, server=item.message && state.messages[item.jobId+'|'+item.message.uid];
      if (!state.visible[item.jobId]) return false;
      if ((item.kind==='pending' && item.identity===identity || item.kind==='unclassified-message') && server && json(server)===json(item.message)) return true;
      return item.kind==='unclassified-room' && state.rooms.some(function (row) {var data=clone(row.data || {});data.jobId=row.job_id;delete data.messages;return row.job_id===item.jobId && json(data)===json(item.data);});
    }
    async function prepareChatReconciliation(d,snapshot,generation) {
      if (!chatAdapter()) return true; // Legacy pages without the new asset.
      rememberChatSnapshot(await chatAdapter().load());
      if (!sameChatGeneration(generation)) return false;
      var reconciliationEpoch=chatSaveFailureEpoch;
      await drainChatWaiting(snapshot.identity,generation,reconciliationEpoch);
      var state=chatReconciliationState(d,snapshot), entries=chatJournalItems();
      var batch=collectChatBatch(function () {
        if (visibleHistoryIdentity===snapshot.identity && !stashPendingForIdentity(snapshot.identity)) return false;
        importLegacyPending(snapshot.identity);
        if (!preserveUnclassifiedChatCache(snapshot.identity,state.messages,state.rooms)) return false;
        entries.forEach(function (entry) {if (exactChatAcknowledged(entry,snapshot.identity,state)) {captureChatRaw(entry.key,entry.raw);if (entry.fallbackRaw) captureChatRaw(entry.key,entry.fallbackRaw);}});
      });
      batch.items.forEach(function (item) {var entry={key:item.key,raw:item.raw,value:JSON.parse(item.raw)};if (exactChatAcknowledged(entry,snapshot.identity,state) && !archivedChatRaw(entry.key,entry.raw)) batch.raws.push({sourceKey:entry.key,raw:entry.raw});});
      mergeChatBatch(batch,chatWaiting);
      if (!await ensureChatDurability(batch,snapshot.identity,generation)) return false;
      settleChatWaiting(batch);
      // A tab can miss broadcasts or gain/revoke a parent while IDB commits.
      var retiring=entries.filter(function (entry) {
        return exactChatAcknowledged(entry,snapshot.identity,state) && (entry.backend==='indexeddb' || entry.fallback)
          && !batch.items.some(function (item) {return item.key===entry.key;});
      });
      // Only an actual retirement needs the additional pre-delete authority
      // read. The final fresh scope/session checks below always guard apply.
      if (retiring.length) {
        var scope=await readVisibleJobIds(generation.owner);
        if (!sameChatGeneration(generation) || scope.identity!==snapshot.identity || json(scope.ids)!==json(state.visible)) return false;
        assertChatWaitingSettled(generation,reconciliationEpoch);
      }
      for (var entry of retiring) {
        await chatAdapter().retireExact(entry.key,entry.fallbackRaw || entry.raw);
        if (!sameChatGeneration(generation)) return false;
      }
      rememberChatSnapshot(await chatAdapter().load());
      if (!sameChatGeneration(generation)) return false;
      var finalScope=await readVisibleJobIds(generation.owner);
      if (!sameChatGeneration(generation) || finalScope.identity!==snapshot.identity || json(finalScope.ids)!==json(state.visible)) return false;
      var finalSession=await trustedSession(generation.owner);
      if (!sameChatGeneration(generation) || finalSession.identity!==snapshot.identity) return false;
      assertChatWaitingSettled(generation,reconciliationEpoch);chatRecoveryBlocked=false;
      return true;
    }
    function reconcileVisibleChats(d, snapshot) {
      if (!d || !Array.isArray(d.rec)) throw new Error('latest record scope unavailable');
      var visible = Object.create(null), confirmedMessages = Object.create(null);
      d.rec.forEach(function (row) {
        if (!row || typeof row.id !== 'string' || !row.id || visible[row.id]) throw new Error('latest record scope invalid');
        visible[row.id] = true;
      });
      // The child snapshot and core pull are separate requests. A same-session
      // owner transfer between them must be resolved by the more recent parent
      // records before any child row reaches the UI or shared cache.
      var currentChats = snapshot.chats.filter(function (row) { return row && typeof row.job_id === 'string' && visible[row.job_id]; });
      var currentMessages = snapshot.messages.filter(function (row) { return row && typeof row.job_id === 'string' && visible[row.job_id]; });
      currentMessages.forEach(function (row) {
        if (!row || typeof row.uid !== 'string') return;
        var data = clone(row.data || {}); if (!data.uid) data.uid = row.uid;
        confirmedMessages[row.job_id+'|'+row.uid] = data;
      });
      if (visibleHistoryIdentity === snapshot.identity && !stashPendingForIdentity(snapshot.identity)) throw new Error('pending chat recovery could not be saved');
      importLegacyPending(snapshot.identity);
      if (!preserveUnclassifiedChatCache(snapshot.identity, confirmedMessages, currentChats)) throw new Error('unclassified legacy chat cache could not be preserved');
      var recovery = [], candidates=Object.create(null);
      chatJournalItems().forEach(function (entry) {
        var item=entry.value, server=item.message && item.message.uid && confirmedMessages[item.jobId+'|'+item.message.uid];
        var acknowledged = (item.kind==='pending' && item.identity===snapshot.identity || item.kind==='unclassified-message')
          && server && json(server)===json(item.message);
        if (item.kind==='unclassified-room') acknowledged=currentChats.some(function (row) {
          var data=clone(row.data || {}); data.jobId=row.job_id; delete data.messages;
          return row.job_id===item.jobId && json(data)===json(item.data);
        });
        if (acknowledged) {
          // Content-addressed immutable keys cannot remove a sibling variant.
          retireChatEntry(entry);
        } else if (item.kind==='pending' && item.identity===snapshot.identity) {
          recovery.push(item); var id=item.jobId+'|'+item.message.uid;
          candidates[id]=(candidates[id] || 0)+1;
        }
      });
      confirmedChatData=confirmedMessages;
      var pendingByRoom = Object.create(null);
      recovery.forEach(function (item) {
        var id=item.jobId+'|'+item.message.uid;
        // Same-uid conflicts remain recoverable but are never arbitrarily
        // selected for replay against another variant or a server version.
        if (visible[item.jobId] && candidates[id]===1 && !confirmedMessages[id]) {
          (pendingByRoom[item.jobId] || (pendingByRoom[item.jobId]=[])).push(item.message);
        }
      });
      d.cht = currentChats.map(function (row) {
        return {job_id:row.job_id, data:row.data, updated_at:row.updated_at};
      });
      d.msg = currentMessages.map(function (row) {
        var data = clone(row.data || {});
        if (row.uid && !data.uid) data.uid = row.uid;
        return {uid:row.uid, job_id:row.job_id, ts:row.ts, data:data, updated_at:row.updated_at};
      });
      // The sealed full apply merges the existing global chat array into the
      // server result. Replace it with the approved room set first, carrying
      // only explicit pending entries for those rooms.
      if (typeof chats !== 'undefined' && Array.isArray(chats)) {
        chats = currentChats.map(function (row) {
          var data = clone(row.data || {}), keep = pendingByRoom[row.job_id] || [];
          data.jobId = row.job_id;
          data.messages = keep.map(clone);
          return data;
        });
      }
      try {localStorage.setItem('fs_chat_cache_owner_v1',snapshot.identity);} catch (error) {if (!quotaError(error)) throw error;chatQuotaRecovered=true;}
      visibleHistoryIdentity = snapshot.identity;
      visibleIdentity = snapshot.identity;
    }
    var startupPhase = delegatedBoot ? 'core-loading' : 'local';
    var startupActorReady = !delegatedBoot, bootstrapPromise = null, retryBootstrap = null;
    function connectionFailure(stage, error) {
      // Only fixed internal signatures and explicit HTTP statuses may leave
      // this closure. Never report arbitrary error text or actor/cache data.
      try {
        var reason='unknown', status=error && error.status, message=error && error.message;
        if (status===401) reason='unauthorized401';
        else if (status===403) reason='forbidden403';
        else if (status===503) reason='service-unavailable503';
        else switch (message) {
          case 'central read timed out': if (status===408) reason='timedout'; break;
          case 'pending chat recovery could not be saved':
          case 'chat recovery identity collision': case 'chat recovery readback failed': case 'chat recovery entry invalid':
          case 'legacy pending chat journal invalid': case 'legacy pending chat item invalid': case 'chat import receipt not durable':
            reason='pending-chat-journal'; break;
          case 'unclassified legacy chat cache could not be preserved': reason='legacy-chat-preserve'; break;
          case 'chat cache save failed': case 'old chat cache could not be cleared safely': case 'visible chat cache could not be safely updated':
            reason='local-chat-cache-update'; break;
          case 'trusted session changed': case 'session changed during bootstrap':
          case 'user or role changed during scope read': case 'visible scope changed during read':
          case 'user changed during visible chat read': case 'user or role changed during visible chat read':
          case 'ผู้ใช้งานเปลี่ยนแล้ว จึงหยุดบันทึกครั้งนี้': reason='identity-scope-changed'; break;
          case 'session actor unavailable': case 'trusted session unavailable': reason='actor-unavailable'; break;
          case 'visible chat snapshot unavailable': case 'visible chat snapshot incomplete or session changed':
          case 'visible record scope unavailable': case 'visible record scope malformed':
          case 'latest record scope unavailable': case 'latest record scope invalid': case 'core profiles unavailable':
          case 'scoped history incomplete': case 'scoped history invalid': case 'scoped history duplicate':
          case 'profile inventory incomplete': case 'profile inventory invalid': case 'room inventory invalid': case 'approval inventory invalid':
          case 'newly visible parent incomplete': case 'incremental read incomplete': case 'visible snapshot page range invalid':
          case 'central read page incomplete': case 'central read row invalid': case 'central read identity invalid':
          case 'central message identity invalid': case 'central approval identity invalid': case 'central read data invalid':
            reason='central-page-incomplete'; break;
        }
        diag('', 'connection:'+stage, reason, JSON.stringify({centralReady:window.__fsCentralReady===true,
          sbReady:sbReady===true,actorReady:startupActorReady===true && !!actor,permissionReady:permissionReady===true,
          storageError:!!storageError,chatRecoveryBlocked:!!chatRecoveryBlocked,hasVisibleScope:currentVisibleJobIds!==null}));
      } catch (_) {}
    }
    if (delegatedBoot) {
      // Readers outside this controller can fail between its own awaits.
      // Reuse the monotonic save-failure boundary so a later healthy writer
      // cannot erase that failure or revive an earlier event pause.
      if (chatAdapter() && typeof chatAdapter().subscribe==='function') chatAdapter().subscribe(function (status) {
        if (status.state==='failed' || status.code==='chat-journal-versionchange') failChatSave(false);
      });
      window.__fsCentralReady = false;
      window.__fsHandshakeReady = false;
      window.__fsPermissionReady = permissionReady;
      var markHandshakeReady = function () {
        if (window.__fsHandshakeReady === true) return;
        window.__fsHandshakeReady = true;
        sbChip(); paint();
      };
      if (window.__fsSessionHandshake && typeof window.__fsSessionHandshake.then === 'function') {
        window.__fsSessionHandshake.then(function (result) {
          if (result && result.status === 200 && result.authenticated === true) markHandshakeReady();
        }).catch(function () {});
      }
      if (startupPermission) {
        // Permission is a write gate, not a read gate.  Do not let a slow IAM
        // response hold the central read handshake past the two-second UX
        // budget; keep creation fail-closed until the answer arrives.
        permissionReady = false; window.__fsPermissionReady = false; sbCanEdit = false;
        sbLoadWritePermission = function () {
          var result;
          try { result = Promise.resolve(startupPermission.apply(this, arguments)); }
          catch (error) { result = Promise.reject(error); }
          window.__fsPermissionPromise = result.then(function () {
            permissionReady = true; window.__fsPermissionReady = true; openPendingChat(); sbChip(); paint();
          }).catch(function (error) {
            permissionReady = true; window.__fsPermissionReady = true;
            sbErr = String(error && error.message || error); sbChip(); paint();
          });
          return Promise.resolve();
        };
      }
      // The first pull carries the authoritative record/user/chat baseline.
      // Message and approval history can be large, so leave those two tables
      // out of the critical path and hydrate them only after the core baseline
      // is ready. Returning null preserves sbPartial=true and therefore keeps
      // deletion/reconciliation fail-closed during the partial phase.
      sbReq = async function (path) {
        if (historyDeferred && /^(?:fs_chats|fs_messages|fs_approvals)\?/.test(String(path || ''))) return null;
        return startupRequest.apply(this, arguments);
      };
      // Own the whole cycle, including preflight failure. The sealed scheduler's
      // minute full rebuild is reserved for explicit recovery below.
      if (typeof sbNextDelay === 'function') sbNextDelay = function () { return 20000; };
      var startupTry = typeof sbTry === 'function' ? sbTry : null;
      if (startupTry) sbTry = async function (cap, fn, fallback) {
        if (!sbCap[cap]) return fallback;
        var denial = null;
        var value = await startupTry(cap, async function () {
          try { return await fn(); }
          catch (error) {
            if (error && (error.status === 401 || error.status === 403)) {
              denial = error;
              // Keep the original compatibility helper from classifying an
              // authorization denial as a missing schema capability.
              var wrapped = new Error('authorization denied'); wrapped.status = 401; throw wrapped;
            }
            throw error;
          }
        }, fallback).catch(function (error) { throw denial || error; });
        if (denial) throw denial;
        return value;
      };
      function filterVisibleRecords(ids) {
        records = records.filter(function (row) {
          var pending=row && queue[row.id];
          return row && !parentScopeBlocked(row.id) && (ids[row.id] || pending && pending.expected===null && canSeeRecord(row));
        });
        Object.keys(confirmed).forEach(function (id) { if (!ids[id]) delete confirmed[id]; });
        Object.keys(sbSnap.records).forEach(function (id) { if (!ids[id]) delete sbSnap.records[id]; });
        Object.keys(sbSnap.chats).forEach(function (id) { if (!ids[id]) delete sbSnap.chats[id]; });
        Object.keys(sbSnap.apvs).forEach(function (key) { if (!ids[key.split('|')[0]]) delete sbSnap.apvs[key]; });
        Object.keys(confirmedChatData).forEach(function (key) { if (!ids[key.split('|')[0]]) delete confirmedChatData[key]; });
        sbPendMsg = sbPendMsg.filter(function (row) { return row && ids[row.job_id]; });
      }
      async function stageScopedChanges(scope, data) {
        var rooms = await scopedRows('fs_chats','job_id,updated_at',scope.ids,'job_id','job_id.asc');
        var approvals = sbCap.apv ? await scopedRows('fs_approvals','job_id,part,updated_at',scope.ids,'job_id','job_id.asc,part.asc') : null;
        var users=await sbReqAll('fs_users?select=name,updated_at&order=name.asc'), userIds=Object.create(null);
        if (!Array.isArray(users)) throw new Error('profile inventory incomplete');
        users.forEach(function (row) { if (!row || typeof row.name!=='string' || !row.name || own(userIds,row.name)) throw new Error('profile inventory invalid'); userIds[row.name]=true; });
        var roomIds=Object.create(null), apvIds=Object.create(null), hydrate=Object.create(null);
        rooms.forEach(function (row) {
          if (roomIds[row.job_id]) throw new Error('room inventory invalid');
          roomIds[row.job_id]=row.updated_at || '';
          if (roomVersions[row.job_id]!==roomIds[row.job_id] && !data.cht.some(function (item) { return item.job_id===row.job_id; })) hydrate[row.job_id]=true;
        });
        (approvals || []).forEach(function (row) {
          var key=row.job_id+'|'+row.part;
          if (typeof row.part!=='string' || own(apvIds,key)) throw new Error('approval inventory invalid');
          apvIds[key]=row.updated_at || '';
          if (approvalVersions[key]!==apvIds[key] && !(data.apv || []).some(function (item) { return item.job_id===row.job_id && item.part===row.part; })) hydrate[row.job_id]=true;
        });
        Object.keys(scope.ids).forEach(function (id) { if (!currentVisibleJobIds || !currentVisibleJobIds[id] || parentScopeBlocked(id)) pendingHydration[id]=true; });
        Object.keys(pendingHydration).forEach(function (id) { if (scope.ids[id]) hydrate[id]=true; else delete pendingHydration[id]; });
        if (Object.keys(hydrate).length) {
          data.rec=data.rec.concat(await scopedRows('fs_records','id,data,updated_at',hydrate,'id','id.asc'));
          data.cht=data.cht.concat(await scopedRows('fs_chats','job_id,data,updated_at',hydrate,'job_id','job_id.asc'));
          if (sbCap.apv) data.apv=(data.apv || []).concat(await scopedRows('fs_approvals','job_id,part,data,updated_at',hydrate,'job_id','job_id.asc,part.asc'));
        }
        var newJobs=Object.create(null);
        Object.keys(pendingHydration).forEach(function (id) { if (scope.ids[id]) newJobs[id]=true; });
        if (Object.keys(newJobs).length && sbCap.msg) {
          var history=await readScopedChatHistory(newJobs);
          data.cht=data.cht.filter(function (row) {return !newJobs[row.job_id];}).concat(history.chats);
          data.msg=(data.msg || []).filter(function (row) {return !newJobs[row.job_id];}).concat(history.messages);
        }
        Object.keys(newJobs).forEach(function (id) {
          if (!data.rec.some(function (row) { return row.id===id && row.data && row.data.id===id; })) throw new Error('newly visible parent incomplete');
        });
        return {rooms:roomIds,approvals:approvals===null?null:apvIds,hydrated:newJobs,users:userIds};
      }
      function applyInventories(inventory) {
        var beforeInventoryUI=json([chats,userList]);
        if (!stashPendingForIdentity(visibleIdentity)) throw new Error('pending chat recovery could not be saved');
        var removed=Object.create(null);
        chats = chats.filter(function (room) {
          if (own(sbSnap.chats,room.jobId) && !own(inventory.rooms,room.jobId)) { removed[room.jobId]=true; return false; }
          if (inventory.approvals) Object.keys(room.approvals || {}).forEach(function (part) {
            var key=room.jobId+'|'+part;
            if (own(sbSnap.apvs,key) && !own(inventory.approvals,key) && json(room.approvals[part])===sbSnap.apvs[key]) delete room.approvals[part];
          });
          return true;
        });
        Object.keys(removed).forEach(function (id) {
          delete sbSnap.chats[id];
          Object.keys(confirmedChatData).forEach(function (key) { if (key.indexOf(id+'|')===0) { delete sbSnap.msgs[key.slice(id.length+1)]; delete confirmedChatData[key]; } });
        });
        if (inventory.approvals) Object.keys(sbSnap.apvs).forEach(function (key) { if (!own(inventory.approvals,key)) delete sbSnap.apvs[key]; });
        sbPendMsg=sbPendMsg.filter(function (row) { return !removed[row.job_id]; });
        if (chatOpenId && removed[chatOpenId]) closeChatForUnknownScope();
        userList=userList.filter(function (user) {
          var name=user && user.name;
          if (name && own(sbSnap.users,name) && !own(inventory.users,name) && !own(deferredUsers,name) && json(user)===sbSnap.users[name]) { delete sbSnap.users[name]; return false; }
          return true;
        });
        roomVersions=inventory.rooms;
        if (inventory.approvals) approvalVersions=inventory.approvals;
        Object.keys(inventory.hydrated).forEach(function (id) { delete pendingHydration[id]; });
        return beforeInventoryUI!==json([chats,userList]);
      }
      function resumableChatEventPause(pause,scope,generation) {
        return !!pause && pause===chatStorageEventPause && pause.epoch===chatSaveFailureEpoch && pause.failure===chatPauseFailureEpoch
          && sameChatGeneration(pause.generation) && sameChatGeneration(generation)
          && pause.identity===visibleIdentity && visibleHistoryIdentity===visibleIdentity && scope.identity===pause.identity
          && pause.scope===json(scope.ids) && pause.scope===json(currentVisibleJobIds)
          && sbReady && !storageError && !chatRecoveryBlocked && window.__fsPermissionReady===true
          && (!chatAdapter() || chatAdapter().status().state==='ready');
      }
      if (startupCycle) sbCycle = function (urgent) {
        if (!startupActorReady) return retryBootstrap ? retryBootstrap() : false;
        if (targetedOpenWork && !cyclePromise && !historyRunning) return targetedOpenWork.then(function () {return sbCycle(urgent);});
        if (cyclePromise || historyRunning) {
          if (urgent) cycleAgain = true;
          var joinedCycle=cyclePromise, joinedPause=chatStorageEventPause;
          if (!joiningChatEventCycle && joinedCycle && joinedPause && window.__fsCentralReady!==true) return joinedCycle.then(function (result) {
            if (joinedPause!==chatStorageEventPause || joinedPause.epoch!==chatSaveFailureEpoch || joinedPause.failure!==chatPauseFailureEpoch
              || !sameChatGeneration(joinedPause.generation) || window.__fsPermissionReady!==true || window.__fsCentralReady===true) return result;
            // Join at most one reconciliation already queued by this same
            // event. The internal call cannot recursively follow another join.
            joiningChatEventCycle=true;
            try {return sbCycle(false);} finally {joiningChatEventCycle=false;}
          });
          return joinedCycle || false;
        }
        switchActor();
        var owner=currentUser || '', scopeVerified=false, oldWatermarks=clone(sbWM), oldCapabilities=clone(sbCap), oldLastFull=sbLastFull, oldPendingHydration=clone(pendingHydration), scopeDisplayChanged=false, chatCycleEpoch=chatSaveFailureEpoch;
        sbBusy=true;
        if (typeof sbTimer!=='undefined') clearTimeout(sbTimer);
        // This fresh cycle includes intent already queued by the sealed app.
        // A background tab may delay that separate send timer well past this
        // read. Consume it now; edits queued during the await keep their timer.
        if (typeof sbPushTimer!=='undefined') { clearTimeout(sbPushTimer); sbPushTimer=null; }
        cyclePromise = Promise.resolve().then(async function () {
          var cycleGeneration=chatGeneration(), eventPause=null, resumingEvent=false;
          if (chatBarrier) {var initialBarrierOutcome=await chatBarrier;if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');assertChatSaveAttempt(chatCycleEpoch);if (initialBarrierOutcome===false) throw new Error('pending chat recovery could not be saved');if (initialBarrierOutcome===CHAT_DEFERRED) throw CHAT_DEFERRED;}
          if (chatAdapter()) {rememberChatSnapshot(await chatAdapter().load());if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');}
          assertChatSaveAttempt(chatCycleEpoch);
          if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');
          // Only a freshly confirmed replacement identity may bypass draining
          // old-tuple evidence. Same-identity recovery keeps ordinary preflight.
          if (!sbReady && !currentVisibleJobIds && visibleIdentity) {
            var recoverySession=await trustedSession(owner);
            assertChatSaveAttempt(chatCycleEpoch);
            if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');
            if (recoverySession.identity!==visibleIdentity) return startHistoryRefresh ? startHistoryRefresh() : false;
          }
          await drainChatWaiting(visibleIdentity,cycleGeneration,chatCycleEpoch);
          var scope=await readVisibleJobIds(owner);
          assertChatSaveAttempt(chatCycleEpoch);
          if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');
          if (visibleIdentity && scope.identity!==visibleIdentity) {
            hideUnknownScope();
            connectionFailure('cycle',new Error('visible scope changed during read'));
            assertChatSaveAttempt(chatCycleEpoch);
            if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');
            return startHistoryRefresh ? startHistoryRefresh() : false;
          }
          // A known revocation is an authority failure, even when unrelated
          // local evidence must wait. Never keep that old room visible by
          // classifying the attempt as a benign deferred read.
          if ((hasChatWaiting() || chatBarrier || chatInFlight)
            && currentVisibleJobIds && Object.keys(currentVisibleJobIds).some(function (id) {return !scope.ids[id];})) throw new Error('visible scope changed during read');
          assertChatWaitingSettled(cycleGeneration,chatCycleEpoch);
          // A storage pause may start and finish during the preflight await.
          // Choose its current verified evidence here, then keep that exact
          // marker for the final authority checks below.
          eventPause=chatStorageEventPause;
          resumingEvent=window.__fsCentralReady!==true && resumableChatEventPause(eventPause,scope,cycleGeneration);
          if (!visibleIdentity || scope.identity!==visibleIdentity || !sbReady || window.__fsCentralReady!==true && !resumingEvent || sbGuardTake) {
            hideUnknownScope();
            return startHistoryRefresh ? startHistoryRefresh() : false;
          }
          scopeVerified=true;
          var beforeRecordCount=records.length, beforeRoomCount=chats.length;
          scopeVerified=false;
          // A sender can publish durable evidence during the scope await.
          // Join its verified publication before synchronous preservation;
          // a newly queued event barrier instead defers this read attempt.
          if (chatBarrier) {var barrierOutcome=await chatBarrier;assertChatSaveAttempt(chatCycleEpoch);if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');if (barrierOutcome===false) throw new Error('pending chat recovery could not be saved');if (barrierOutcome===CHAT_DEFERRED) throw CHAT_DEFERRED;}
          if (chatAdapter()) {rememberChatSnapshot(await chatAdapter().load());if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');}
          assertChatWaitingSettled(cycleGeneration,chatCycleEpoch);
          observeVisibleScope(scope.ids);
          pruneChatsToVisibleScope(scope.ids); filterVisibleRecords(scope.ids);
          scopeDisplayChanged=beforeRecordCount!==records.length || beforeRoomCount!==chats.length;
          scopeVerified=true;
          // Writes have their own durable ACK path. Never race them against a
          // read deadline: a late successful write must still acknowledge once.
          if (sbReady && sbCanEdit) await sbPush();
          assertChatSaveAttempt(chatCycleEpoch);
          var data=await startupPull(false);
          if (!data || data.partial || data.msg===null && sbCap.msg || data.apv===null && sbCap.apv) throw new Error('incremental read incomplete');
          var inventory=await stageScopedChanges(scope,data);
          scopeVerified=false;
          var finalScope=await readVisibleJobIds(owner);
          if (scope.identity!==finalScope.identity || json(scope.ids)!==json(finalScope.ids) || owner!==currentUser) { scopeVerified=false; throw new Error('visible scope changed during read'); }
          scopeVerified=true; currentVisibleJobIds=scope.ids;
          if (chatAdapter()) {
            var deltaSnapshot={identity:scope.identity,chats:data.cht || [],messages:data.msg || []}, deltaData={rec:Object.keys(scope.ids).map(function (id) {return {id:id};})};
            if (!await prepareChatReconciliation(deltaData,deltaSnapshot,cycleGeneration)) throw new Error('pending chat recovery could not be saved');
          }
          if (chatBarrier) {var barrierOutcome=await chatBarrier;assertChatSaveAttempt(chatCycleEpoch);if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');if (barrierOutcome===false) throw new Error('pending chat recovery could not be saved');if (barrierOutcome===CHAT_DEFERRED) throw CHAT_DEFERRED;}
          if (chatAdapter()) {rememberChatSnapshot(await chatAdapter().load());if (!sameChatGeneration(cycleGeneration)) throw new Error('trusted session changed');}
          assertChatWaitingSettled(cycleGeneration,chatCycleEpoch);
          var inventoryChanged=applyInventories(inventory);
          // Inventory is newer than delta/targeted room payloads. Never let a
          // deleted compound approval re-enter the sealed merger or receipt.
          if (inventory.approvals) {
            data.apv=(data.apv || []).filter(function (row) { return own(inventory.approvals,row.job_id+'|'+row.part); });
            data.cht.forEach(function (row) {
              if (!row.data || !row.data.approvals) return;
              row.data=clone(row.data);
              Object.keys(row.data.approvals).forEach(function (part) { if (!own(inventory.approvals,row.job_id+'|'+part)) delete row.data.approvals[part]; });
            });
          }
          Object.keys(inventory.hydrated).forEach(function (id) { delete revokedCentralRecords[id]; });
          data.cht=data.cht.filter(function (row) { return own(inventory.rooms,row.job_id); });
          data.msg=(data.msg || []).filter(function (row) { return own(inventory.rooms,row.job_id); });
          data.usr=(data.usr || []).filter(function (row) { return own(inventory.users,row.data && row.data.name || row.name); });
          assertChatSaveAttempt(chatCycleEpoch);
          var changed=sbApply(data);assertChatSaveAttempt(chatCycleEpoch);filterVisibleRecords(scope.ids);
          if (!changed && (scopeDisplayChanged || inventoryChanged) && typeof sbRerender==='function') sbRerender();
          scopeDisplayChanged=false;
          if (resumingEvent) {
            // The pause authorizes reads only. Restore writes after the same
            // durable/save guards and an additional fresh final authority check.
            var eventFinalScope=await readVisibleJobIds(owner);
            if (!resumableChatEventPause(eventPause,eventFinalScope,cycleGeneration)) {scopeVerified=false;throw new Error('visible scope changed during read');}
            var eventFinalSession=await trustedSession(owner);
            if (!resumableChatEventPause(eventPause,eventFinalScope,cycleGeneration) || eventFinalSession.identity!==eventPause.identity) {scopeVerified=false;throw new Error('trusted session changed');}
            assertChatSaveAttempt(chatCycleEpoch);
            window.__fsCentralReady=true;chatStorageEventPause=null;
            openPendingChat();assertChatSaveAttempt(chatCycleEpoch);
          }
          sbErr=''; startupPhase='ready';
          return true;
        }).catch(function (error) {
          if (error===CHAT_DEFERRED) {
            // No delta was applied. Keep committed durable archives, but do
            // not skip the unapplied central rows on the next ordinary read.
            sbWM=oldWatermarks;sbCap=oldCapabilities;sbLastFull=oldLastFull;pendingHydration=oldPendingHydration;
            return false;
          }
          invalidateChatStoragePause();sbWM=oldWatermarks;
          if (error && (error.status===401 || error.status===403)) { sbCap=oldCapabilities; scopeVerified=false; }
          if (!scopeVerified) hideUnknownScope();
          else if (scopeDisplayChanged && typeof sbRerender==='function') sbRerender();
          sbErr=String(error && error.message || error); startupPhase='failed';
          connectionFailure('cycle',error);
          return false;
        }).finally(function () {
          cyclePromise=null; sbBusy=false; sbChip(); paint();
          if (cycleAgain) { cycleAgain=false; setTimeout(function () { sbCycle(true); },0); }
          else if (typeof sbSchedule==='function') sbSchedule();
        });
        return cyclePromise;
      };
      if (startupFillIds) {
        sbFillIdPool = function (want) {
          // The allocator is server-owned and remains a save prerequisite;
          // warm it in the background rather than holding the connection chip.
          if (!idWarmPromise) {
            try { idWarmPromise = Promise.resolve(startupFillIds.apply(this, arguments)).catch(function () {}).finally(function () { idWarmPromise = null; }); }
            catch (error) { idWarmPromise = Promise.reject(error).finally(function () { idWarmPromise = null; }); }
          }
          return historyDeferred && !historyRunning ? Promise.resolve() : idWarmPromise;
        };
      }
      if (startupChip) {
        sbChip = function () {
          startupChip.apply(this, arguments);
          var el = document && document.getElementById ? document.getElementById('syncChip') : null;
          if (!el || startupPhase === 'local') return;
          el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
          if (startupPhase === 'history-loading') {
            el.className = 'sync-chip on busy';
            el.textContent = 'เชื่อมต่อระบบกลางแล้ว · กำลังโหลดข้อมูลล่าสุด';
            el.title = 'ระบบกลางตอบแล้ว แต่กำลังโหลดประวัติให้ครบก่อนเปิดการบันทึก';
          } else if (startupPhase === 'core-loading') {
            el.className = 'sync-chip on busy';
            if (window.__fsHandshakeReady === true) {
              el.textContent = 'เชื่อมต่อระบบกลางแล้ว · กำลังโหลดข้อมูลล่าสุด';
              el.title = 'ระบบกลางตอบแล้ว แต่กำลังโหลดข้อมูลล่าสุดก่อนเปิดการบันทึก';
            } else {
              el.textContent = 'กำลังโหลดข้อมูลล่าสุดจากระบบกลาง…';
              el.title = 'กำลังตรวจสอบข้อมูลและสิทธิ์จากระบบกลาง';
            }
          } else if (startupPhase === 'failed') {
            el.className = 'sync-chip on err';
            el.textContent = currentVisibleJobIds ? 'ข้อมูลล่าสุดล่าช้า · ระบบจะลองใหม่อัตโนมัติ' : 'ยังตรวจสอบข้อมูลไม่ได้ · ระบบจะลองใหม่อัตโนมัติ';
            el.title = 'ระบบจะลองโหลดอีกครั้งหลังรอบนี้ 20 วินาที';
          } else if (startupPhase === 'ready' && window.__fsPermissionReady !== true) {
            el.className = 'sync-chip on busy';
            el.textContent = 'เชื่อมต่อระบบกลางแล้ว · กำลังตรวจสิทธิ์การบันทึก';
            el.title = 'ระบบกลางตอบแล้ว แต่กำลังรอผลตรวจสิทธิ์ก่อนเปิดการบันทึก';
          }
        };
      }
    }
    installed = true; window.__fsJobSync = {version:1, installed:true, ready:false, canCreate:function () { switchActor(); return !!actor && !storageError && (!delegatedBoot || (window.__fsCentralReady === true && window.__fsPermissionReady === true)); }, verifyCentralRecord:verifyCentralRecord, useServer:useServer, useLocalCreate:useLocalCreate, recoverLegacy:recoverLegacy, checkVersion:checkVersion};
    startVersionWatch();
    Object.defineProperty(window.__fsJobSync, 'storageProblem', {get:function () { return storageProblem; }});
    Object.defineProperty(window.__fsJobSync, 'recoveryDiagnostic', {get:function () { return recoveryDiagnostic ? clone(recoveryDiagnostic) : null; }});
    var early = [];
    if (currentUser && recTrackReady && !sbApplying) {
      records.forEach(function (r) {
        if (valid(r) && r.createdBy === currentUser && recTouched[r.id] && canSeeRecord(r)) {
          early.push({data:clone(r),hasSnapshot:own(sbSnap.records,r.id),snapshot:sbSnap.records[r.id]});
        }
      });
    }
    switchActor(); restore(); baseline();
    early.forEach(function (item) {
      var r = item.data, p = queue[r.id], expected = null;
      if (item.hasSnapshot) {
        try {
          expected = JSON.parse(item.snapshot);
          if (!valid(expected) || expected.id !== r.id) throw new Error('invalid expected record');
        } catch (_) { expected = {__fsJobSyncUnknownBaseline:true}; }
      } else if (p && json(p.data) === json(r)) {
        return; // An unchanged durable value already has its captured condition.
      } else if (p && p.expected !== null) {
        expected = {__fsJobSyncUnknownBaseline:true};
      }
      // A legacy snapshot supplies only a compare-and-swap condition. It is
      // never evidence that this local value was saved. Untouched cache has no
      // current-session recTouched provenance and never enters this path.
      if (p && json(p.data) === json(r) && json(p.expected) === json(expected)) return;
      // Actor ownership cannot prove that an earlier immutable draft came
      // from this document. Preserve differing versions as a fork, using this
      // edit's own condition rather than rebasing onto another draft's token.
      queue[r.id] = {data:r,expected:expected,status:unknownExpected(expected) ? 'invalid' : p ? 'conflict' : 'pending',keys:p ? p.keys : [],variants:p ? p.variants || [] : []};
    });
    if (early.length) { persist(); restore(); baseline(); }
    var save = saveRecordsStore, apply = sbApply, push = sbPush, upsert = sbUpsert, request = sbReq;
    // Same two statements as the sealed saveChats(), plus: the failure is
    // reported instead of swallowed, and the seen map is persisted on its own.
    // tests/chat-seen-client.test.mjs pins the sealed body so drift is caught.
    // Only the sealed writer is replaced; a page without that exact statement
    // (another release, or a test stub) keeps its own saveChats untouched.
    if (typeof window.saveChats === 'function' && /localStorage\.setItem\('fs_chats'/.test(String(window.saveChats))) {
      // 14–16 ต.ค. 2569: every pull refilled fs_chats with all 243 rooms' messages
      // (1.84M), the write hit the quota and the store was slimmed again — for
      // every person, every day (119–151 slimmed writes a day). Store the slim
      // form every time instead; central holds the acknowledged messages.
      window.saveChats = function () {
        // The initial legacy pull is only a partial bootstrap. Preserve the
        // exact pre-existing bytes until the trusted scoped snapshot arrives.
        if (delegatedBoot && !visibleHistoryIdentity) return;
        if (delegatedBoot && (!stashPendingForIdentity(visibleHistoryIdentity) || !preserveUnclassifiedChatCache(visibleHistoryIdentity,confirmedChatData,[]))) return failChatSave();
        var encoded = '', slim = slimChats();
        try {
          encoded = JSON.stringify(slim || chatList()); writeChatCache(encoded);
          if (slim && !compactReported) { compactReported = true; diag('', 'chat-storage', 'compact', 'fs_chats ' + encoded.length + ' ' + storageProfile()); }
        }
        catch (error) {
          reportChatStorage(error, encoded.length);
          if (quotaError(error) && !delegatedBoot) slimChatStore(encoded.length);
          else if (delegatedBoot) return failChatSave(true);
        }
        persistSeen();
        if (typeof sbQueue === 'function') sbQueue();
      };
    }
    if (typeof window.markChatSeen === 'function') {
      var markSeen = window.markChatSeen;
      window.markChatSeen = function () {
        var changed = markSeen.apply(this,arguments);
        if (changed) persistSeen();
        return changed;
      };
    }
    hydrateSeen(); loadSeen();
    sbReq = async function () {
      var path = arguments[0], options = arguments[1] || {}, snapshotTable = String(path || '').split('?')[0];
      if (activeVisibleSnapshot && (snapshotTable === 'fs_chats' || snapshotTable === 'fs_messages')
        && (!options.method || String(options.method).toUpperCase() === 'GET')) {
        var sourceRows = snapshotTable === 'fs_chats' ? activeVisibleSnapshot.chats : activeVisibleSnapshot.messages;
        var rangeHeader = options.headers && (options.headers.Range || options.headers.range) || '0-999';
        var bounds = /^(\d+)-(\d+)$/.exec(String(rangeHeader));
        if (!bounds) throw new Error('visible snapshot page range invalid');
        return sourceRows.slice(Number(bounds[1]),Number(bounds[2])+1).map(clone);
      }
      var owner = pushingOwner;
      if (owner && currentUser !== owner) throw new Error('ผู้ใช้งานเปลี่ยนแล้ว จึงหยุดบันทึกครั้งนี้');
      var requestThis=this, requestArgs=arguments;
      var result = delegatedBoot && (!options.method || String(options.method).toUpperCase()==='GET')
        ? await readWithinDeadline(function () { return request.apply(requestThis,requestArgs); })
        : await request.apply(this,arguments);
      if (owner && currentUser !== owner) throw new Error('ผู้ใช้งานเปลี่ยนแล้ว จึงหยุดบันทึกครั้งนี้');
      if (delegatedBoot && (!options.method || String(options.method).toUpperCase()==='GET')
        && /^(fs_records|fs_chats|fs_messages|fs_approvals|fs_users|fs_activities)\?/.test(String(path))
        && !(historyDeferred && /^(fs_chats|fs_messages|fs_approvals)\?/.test(String(path)))) {
        if (!Array.isArray(result)) throw new Error('central read page incomplete');
        var selection=/[?&]select=([^&]+)/.exec(String(path)), columns=selection?decodeURIComponent(selection[1]).split(','):['*'];
        result.forEach(function (row) {
          if (!row || typeof row!=='object' || Array.isArray(row)) throw new Error('central read row invalid');
          var identity=snapshotTable==='fs_records'?'id':snapshotTable==='fs_users'?'name':snapshotTable==='fs_activities'?'uid':'job_id';
          if (typeof row[identity]!=='string' || !row[identity]) throw new Error('central read identity invalid');
          if (snapshotTable==='fs_messages' && (typeof row.uid!=='string' || !row.uid)) throw new Error('central message identity invalid');
          if (snapshotTable==='fs_approvals' && (typeof row.part!=='string' || !row.part)) throw new Error('central approval identity invalid');
          if ((columns.indexOf('data')>=0 || columns.indexOf('*')>=0) && (!row.data || typeof row.data!=='object' || Array.isArray(row.data))) throw new Error('central read data invalid');
        });
      }
      return result;
    };
    saveRecordsStore = function () {
      var result = save.apply(this,arguments);
      if (!generatorTransaction) capture();
      Object.keys(queue).forEach(function (id) { forgetRecordCacheOmission(id); });
      Object.keys(recTouched || {}).forEach(function (id) { forgetRecordCacheOmission(id); });
      compactVerifiedRecordCache();
      return result;
    };
    sbApply = function (d) {
      var chatApplyEpoch=chatSaveFailureEpoch;
      switchActor();
      if (delegatedBoot && d) {
        records=records.filter(function (row) { return row && !parentScopeBlocked(row.id); });
        if (Array.isArray(d.rec)) d.rec=d.rec.filter(function (row) { return row && !parentScopeBlocked(row.id); });
        if (Array.isArray(d.apv)) d.apv=d.apv.filter(function (row) { return row && !parentScopeBlocked(row.job_id); });
      }
      if (delegatedBoot && currentVisibleJobIds && visibleHistoryIdentity && d && d.full && !d.partial
        && Array.isArray(d.rec) && Array.isArray(d.cht) && Array.isArray(d.msg)) {
        reconcileVisibleChats(d,{identity:visibleHistoryIdentity,chats:d.cht,messages:d.msg});
      }
      if (delegatedBoot && currentVisibleJobIds && d) {
        if (!stashPendingForIdentity(visibleIdentity)) throw new Error('pending chat recovery could not be saved');
        if (!d.full && Array.isArray(d.rec)) d.rec=d.rec.filter(function (row) { return row && currentVisibleJobIds[row.id]; });
        if (!d.full && Array.isArray(d.apv)) d.apv=d.apv.filter(function (row) { return row && currentVisibleJobIds[row.job_id]; });
        if (Array.isArray(chats)) chats = chats.filter(function (room) { return room && currentVisibleJobIds[room.jobId]; });
        if (Array.isArray(d.cht)) d.cht = d.cht.filter(function (row) { return row && currentVisibleJobIds[row.job_id]; });
        if (Array.isArray(d.msg)) d.msg = d.msg.filter(function (row) { return row && currentVisibleJobIds[row.job_id]; });
      }
      if (delegatedBoot && d && !d.full && currentVisibleJobIds && visibleHistoryIdentity===visibleIdentity) {
        (d.msg || []).forEach(function (row) {
          if (row && currentVisibleJobIds[row.job_id] && typeof row.uid==='string') {
            var message=clone(row.data || {}); if (!message.uid) message.uid=row.uid;
            confirmedChatData[row.job_id+'|'+row.uid]=message;
          }
        });
        chatJournalItems().forEach(function (entry) {
          var item=entry.value, central=item.message && confirmedChatData[item.jobId+'|'+item.message.uid];
          if ((item.kind==='pending' && item.identity===visibleIdentity || item.kind==='unclassified-message')
            && currentVisibleJobIds[item.jobId] && central && json(central)===json(item.message)) retireChatEntry(entry);
        });
      }
      // A transient session failure deferred these rows, not their edits.
      // Preserve the latest local values across the sealed server-list rebuild.
      var retainedUsers = Object.keys(deferredUsers).map(function (name) {
        var user = userList.find(function (item) { return item.name === name; }) || deferredUsers[name].data;
        deferredUsers[name].data = clone(user);
        return clone(user);
      });
      protectRemovedCopies(d);
      // The sealed rebuild keeps local.seen, so restore the durable map first;
      // rooms that arrive new in this pull are covered by the second pass.
      hydrateSeen();
      var result = apply.apply(this,arguments);
      if (delegatedBoot) assertChatSaveAttempt(chatApplyEpoch);
      if (retainedUsers.length) {
        retainedUsers.forEach(function (user) {
          var index = userList.findIndex(function (stored) { return stored.name === user.name; });
          if (index < 0) userList.push(user); else userList[index] = user;
          delete sbSnap.users[user.name];
        });
        var applyingUsers = sbApplying; sbApplying = true;
        try { saveUsers(); } finally { sbApplying = applyingUsers; }
      }
      if (hydrateSeen() && typeof renderChatMenu === 'function') { try { renderChatMenu(); } catch (_) {} }
      if (d.full && !d.partial) confirmed = {};
      (d.rec || []).forEach(function (row) { if (row.data && row.data.id === row.id) confirmed[row.id] = clone(row.data); });
      restore(); baseline();
      // Preserve drafts in the legacy cache as well, without marking a pull as
      // a new local edit. The durable queue is retained even when this fails.
      var applying = sbApplying; sbApplying = true;
      try { save(); } finally { sbApplying = applying; }
      if (d.full && !d.partial) applyRecordCacheOmissions();
      if (delegatedBoot) assertChatSaveAttempt(chatApplyEpoch);
      if (delegatedBoot && d && d.full && !d.partial) {
        window.__fsCentralReady = true; startupPhase = 'ready'; sbErr = '';
      }
      if (delegatedBoot && d && d.full && Array.isArray(d.rec) && Array.isArray(d.usr)) markHandshakeReady();
      openPendingChat();
      if (delegatedBoot) assertChatSaveAttempt(chatApplyEpoch);
      paint(); return result;
    };
    sbPush = async function () {
      switchActor();
      // A delegated startup may have a core baseline while message/approval
      // history or IAM permission is still pending. Keep the immutable local
      // journal intact and close every write path until the authoritative
      // baseline is complete; the normal scheduled cycle will replay it.
      if (delegatedBoot && (window.__fsCentralReady !== true || window.__fsPermissionReady !== true)) {
        if (Object.keys(queue).length) diag('', 'push-gate', window.__fsCentralReady !== true ? 'central-not-ready' : 'permission-not-ready');
        paint(); return false;
      }
      if (delegatedBoot && hasChatWaiting()) return false;
      if (delegatedBoot && visibleIdentity) {
        try {
          var readSession = await trustedSession(actor);
          if (readSession.identity !== visibleIdentity) {
            sbReady = false; window.__fsCentralReady = false;
            if (startHistoryRefresh) await startHistoryRefresh();
            paint(); return false;
          }
        } catch (_) {
          sbReady = false; window.__fsCentralReady = false; paint(); return false;
        }
      }
      // Only a same-actor, session-indexed key may be read; this never scans
      // the shared origin store and cannot reveal another account's journal.
      // Avoid yielding on the ordinary legacy path: its capture ordering is a
      // compatibility contract for edits made immediately after sbPush starts.
      if (fallbackIndex().length) { try { await resumeFallback(actor); } catch (_) {} }
      capture(); blockedLegacy = false;
      var owner = actor, readApprovalReceipts=delegatedBoot && visibleHistoryIdentity && visibleHistoryIdentity===visibleIdentity ? clone(sbSnap.apvs) : null;
      var saved = await flush();
      if (currentUser !== owner || actor !== owner) return saved;
      if (readApprovalReceipts && currentVisibleJobIds) {
        // Parent ACK clears legacy child markers to retry filtered pending
        // writes. Keep exact prior read receipts: replaying unchanged other-
        // role approvals would be an unauthorized new approval request.
        chats.forEach(function (room) {
          if (!currentVisibleJobIds[room.jobId]) return;
          Object.keys(room.approvals || {}).forEach(function (part) {
            var key=room.jobId+'|'+part;
            if (readApprovalReceipts[key]===json(room.approvals[part])) sbSnap.apvs[key]=readApprovalReceipts[key];
          });
          (room.messages || []).forEach(function (message) {
            var uid=msgUid(room.jobId,message), server=confirmedChatData[room.jobId+'|'+uid];
            if (server && json(server)===json(message)) sbSnap.msgs[uid]=1;
          });
        });
      }
      // Other jobs and append-only logs must keep syncing even when one job
      // conflicts. The legacy record call is suppressed and its apparent
      // acknowledgements are undone in finally; only the RPC confirms jobs.
      suppressed = {}; suppressedRecords = {}; pushingOwner = owner;
      try { return (await push.apply(this,arguments)) || saved; }
      finally {
        pushingOwner = null;
        // A missing session decision did not acknowledge user edits. Restore
        // their prior markers so the next push still sees unacknowledged edits.
        if (currentUser === owner && actor === owner) Object.keys(deferredUsers).forEach(function (name) {
          var previous = deferredUsers[name];
          if (previous.present) sbSnap.users[name] = previous.value; else delete sbSnap.users[name];
        });
        Object.keys(suppressedRecords).forEach(function (id) {
          if (own(confirmed,id)) sbSnap.records[id] = json(confirmed[id]); else delete sbSnap.records[id];
          if (own(queue,id)) recTouched[id] = 1;
        });
        Object.keys(suppressed).forEach(function (id) {
          delete sbSnap.chats[id];
          chats.filter(function (c) { return c.jobId === id; }).forEach(function (c) { (c.messages || []).forEach(function (m) { delete sbSnap.msgs[msgUid(id,m)]; }); });
          CHAT_PARTS.forEach(function (part) { delete sbSnap.apvs[id+'|'+part.key]; });
        });
        blockedLegacy = Object.keys(suppressed).length > 0 || Object.keys(suppressedRecords).length > 0; paint();
      }
    };
    sbUpsert = async function (table, rows) {
      if (table === 'fs_users') {
        if (!rows || !rows.length) return null;
        // The sealed sync sends its whole local user list before Activities.
        // Consult the server session, never the browser role; suppress this
        // automatic write successfully so independent append-only logs continue.
        switchActor();
        var userSession;
        try { userSession = await trustedSession(actor); }
        catch (_) {
          if (pushingOwner && currentUser === pushingOwner && actor === pushingOwner) (rows || []).forEach(function (row) {
            deferredUsers[row.name] = {present:own(sbSnap.users,row.name),value:sbSnap.users[row.name],data:clone(row.data)};
          });
          diag('', 'user-sync', 'session-unavailable', 'fs_users'); return null;
        }
        if (userSession.role !== 'admin') {
          rows.forEach(function (row) { delete deferredUsers[row.name]; });
          diag('', 'user-sync', 'non-admin', 'fs_users role=' + userSession.role);
          return null;
        }
        var usersWritten = await upsert.call(this,table,rows);
        rows.forEach(function (row) { delete deferredUsers[row.name]; });
        return usersWritten;
      }
      if (table === 'fs_records') {
        (rows || []).forEach(function (r) { suppressedRecords[r.id] = true; });
        return null; // no network call and no lasting acknowledgement
      }
      if (['fs_chats','fs_messages','fs_approvals'].indexOf(table) >= 0) {
        switchActor(); var owner = actor;
        var eligible = (rows || []).filter(function (r) { if (ready(r.job_id)) return true; suppressed[r.job_id] = true; return false; });
        if (!eligible.length) return null;
        var result = await sbReq(table, {method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=representation'}, body:eligible});
        if (currentUser !== owner || actor !== owner) throw new Error('ผู้ใช้งานเปลี่ยนแล้ว จึงหยุดบันทึกครั้งนี้');
        if (!Array.isArray(result) || !eligible.every(function (r) {
          return result.some(function (x) {
            return x.job_id === r.job_id && (table !== 'fs_messages' || x.uid === r.uid)
              && (table !== 'fs_approvals' || x.part === r.part) && json(x.data) === json(r.data);
          });
        })) throw new Error('บันทึกข้อความหรือการอนุมัติยังไม่สำเร็จ ระบบจะลองส่งให้อีกครั้ง');
        return result;
      }
      if (currentUser !== actor) throw new Error('ผู้ใช้งานเปลี่ยนแล้ว จึงหยุดบันทึกครั้งนี้');
      return upsert.call(this,table,rows);
    };
    var reset = window.resetForm;
    if (typeof reset === 'function') window.resetForm = function () {
      var recovery=recoveryState();
      if (!recovery) return reset.apply(this,arguments);
      recoveryFocusRequested=true;
      var copy=recoveryCopy(recovery), field=document.getElementById('gen_err');
      if (field) { field.textContent=copy.status; field.setAttribute('role','alert'); }
      window.alert(copy.status); paint(); return false;
    };
    var generate = window.generateDash;
    if (typeof generate === 'function') window.generateDash = function () {
      switchActor();
      function warn(warning) {
        var field = document.getElementById('gen_err');
        if (field) { field.textContent = warning; field.setAttribute('role', 'alert'); }
        window.alert(warning); paint();
      }
      if (!window.__fsJobSync.ready || storageError) {
        if (storageError) recoveryFocusRequested=true;
        warn(storageError ? 'ยังบันทึกใบงานไม่ได้ เพราะ ' + storageRecoveryMessage()
          : 'กำลังเตรียมระบบบันทึกใบงาน กรุณารอให้ระบบพร้อมก่อนบันทึก');
        return;
      }
      var id = window._editingRecordId;
      if (id && !records.some(function (r) { return r.id === id; })) {
        var warning = 'ยังบันทึกการแก้ไข ' + id + ' ไม่ได้ เพราะไม่พบใบงานเดิมในข้อมูลที่โหลด ข้อมูลในฟอร์มยังอยู่ กรุณาตรวจสอบใบงานเดิมก่อนลองบันทึกอีกครั้ง และอย่าเพิ่งโหลดหน้าหรือปิดหน้านี้';
        warn(warning);
        return;
      }
      var clear = window.clearCustomerForm, previousDash = window._lastDash;
      var originalLog = logAct, activities = [], activitiesStaged = false, activityError = false, recoveryPending = false;
      function stageActivities() {
        if (activitiesStaged || !activities.length) return;
        activitiesStaged = true;
        activities.forEach(function (activity) {
          generatorActivities[activity.job] = mergeActivities(generatorActivities[activity.job], [activity]);
        });
      }
      function captureGeneratorJournal() {
        stageActivities(); capture();
        return !storageError && activities.every(function (activity) {
          var pending = queue[activity.job];
          if (!pending) return false;
          // IndexedDB is asynchronous. A staging revision is not a licence to
          // clear the sealed form; keep it in place until a later recovery UI
          // can make the fully-acknowledged transition.
          if (fallbackStaging[activity.job] || pending.status === 'fallback-staging' || pending.fallback) {
            recoveryPending=true; return false;
          }
          return activitiesOf(pending.activities || pending.activity).some(function (candidate) { return json(candidate) === json(activity); });
        });
      }
      if (typeof clear === 'function') window.clearCustomerForm = function () {
        // The sealed generator saves twice. Hold capture until it is ready to
        // clear the form, then persist the parent and its deferred Activity as
        // one immutable revision so low local-storage headroom is sufficient.
        if (!captureGeneratorJournal()) {
          // Both an IDB write/readback in flight and a failed durable write
          // must retain the visible form. The eventual state is painted by the
          // asynchronous fallback handler; neither case may clear here.
          var activity=activities[0];
          if (recoveryPending && activity && activity.job && !generatorCompletions[activity.job]) {
            generatorCompletions[activity.job]={owner:actor,clear:clear,snapshot:pendingFormSnapshot()};
          } else if (!recoveryPending) activityError = !storageError;
          return;
        }
        return clear.apply(this, arguments);
      };
      logAct = function (cat, action, detail, job) {
        var activity = {cat:cat, action:action, detail:detail == null ? '' : String(detail), job:job};
        if (recordActivity(activity) && ['สร้างชุดข้อมูลใหม่','แก้ไขชุดข้อมูล'].indexOf(action) >= 0) {
          activities.push(activity); return;
        }
        return originalLog.apply(this, arguments);
      };
      generatorTransaction = true;
      try { return generate.apply(this, arguments); }
      finally {
        generatorTransaction = false;
        logAct = originalLog;
        if (typeof clear === 'function') window.clearCustomerForm = clear;
        if (!activitiesStaged && activities.length && !captureGeneratorJournal() && !recoveryPending) activityError = !storageError;
        if (storageError || activityError || recoveryPending) {
          recoveryFocusRequested=true;
          var saved = window._lastDash;
          if (id) window._editingRecordId = id;
          else if (saved && saved !== previousDash && records.some(function (r) { return r.id === saved.id; })) window._editingRecordId = saved.id;
          if (window._editingRecordId && typeof window.showEditingBanner === 'function') window.showEditingBanner(window._editingRecordId);
          switchView('input');
          if (storageError || activityError) warn(activityError && !storageError
            ? 'บันทึกใบงาน' + (window._editingRecordId ? ' ' + window._editingRecordId : '') + ' ในเครื่องไม่สำเร็จ · พื้นที่เก็บข้อมูลของเบราว์เซอร์ไม่พอ ข้อมูลในฟอร์มยังอยู่และยังไม่ยืนยันในระบบกลาง กรุณาสำรองใบงานก่อนโหลดใหม่หรือปิดหน้านี้'
            : 'บันทึกใบงาน' + (window._editingRecordId ? ' ' + window._editingRecordId : '') + ' ในเครื่องไม่สำเร็จ · ' + storageRecoveryMessage());
        }
        paint();
      }
    };
    function deferRecordActivity(name, label) {
      var original = window[name];
      if (typeof original !== 'function' || typeof logAct !== 'function') return;
      window[name] = function (jobId) {
        var id = typeof jobId === 'string' ? jobId : jobId && jobId.id;
        if (!/^[A-Z]+[0-9]{5}$/.test(id || '')) return original.apply(this,arguments);
        switchActor();
        if (!window.__fsJobSync || !window.__fsJobSync.ready || storageError || !sbReady || !sbCanEdit) {
          notices[id] = {kind:'failed',text:label + ' · ระบบยังไม่พร้อม'};
          paint(); return null;
        }
        delete notices[id];
        if (own(queue,id)) { window.alert(message(id)); paint(); return null; }
        var originalLog = logAct, activities = [], result, transaction = generatorTransaction;
        var formulaCommit = name === '__fsCommitChatFormula' || name === '__fsCommitModify';
        // The sealed app can save a changed record, then immediately create
        // the matching Activity (which updates the record's movement time and
        // saves again). Capturing the first save under a full localStorage
        // quota used to stage an incomplete fallback revision before that
        // second mutation. Hold capture until the whole user action finishes
        // so one durable revision contains the final Record and Activity.
        generatorTransaction = true;
        logAct = function (cat,action,detail,job) {
          var activity = {cat:cat,action:action,detail:detail == null ? '' : String(detail),job:job};
          if (job === id && recordActivity(activity)) {
            // Preserve the sealed app's movement timestamp as part of this
            // same record revision. Calling noteJobMovement while the
            // transaction gate is held keeps its save from capturing a
            // premature journal, while the prepared Activity supplies the
            // stable UID/timestamp required by a fallback POST.
            activity = finalizeActivities([activity])[0];
            activities.push(activity);
            if (typeof noteJobMovement === 'function' && ['job','formula','close'].indexOf(cat) >= 0) noteJobMovement(job,activity.ts);
            return;
          }
          return originalLog.apply(this,arguments);
        };
        try { result = original.apply(this,arguments); }
        finally {
          logAct = originalLog; generatorTransaction = transaction;
          if (activities.length) {
            generatorActivities[id] = mergeActivities(generatorActivities[id], activities);
            capture();
            var pending = queue[id];
            // A verified fallback stages asynchronously. It is not an error
            // state and must not leave a red failure notice after its exact
            // Record and Activity acknowledgements complete.
            if (!pending || (!fallbackStaging[id] && !(pending && pending.fallback))) {
              if (formulaCommit && pending) delete notices[id];
              else {
              notices[id] = {kind:'failed',text: pending ? label + 'ในเครื่องไม่สำเร็จ' : 'ยังยืนยัน' + label + 'ไม่ได้'};
              }
            }
          }
          paint();
          if (formulaCommit && typeof window.__fsUpdateFormulaSaveStatuses === 'function') window.__fsUpdateFormulaSaveStatuses();
        }
        return result;
      };
    }
    var sealedChatSaveFormula = window.chatSaveFormula;
    deferRecordActivity('toggleJobTag','การบันทึกแท็ก');
    deferRecordActivity('saveJobSection','การบันทึกการแก้ไข');
    ['chatIngEdit','chatIngAdd','chatIngDel'].forEach(function (name) { deferRecordActivity(name,'การบันทึกการแก้สูตร'); });
    ['chatSaveFormula','saveChatFormula'].forEach(function (name) { deferRecordActivity(name,'การบันทึกการแก้สูตร'); });
    // Confirmation dialogs can stay open while an automatic sync captures a
    // new local revision. Re-check the same server-acknowledgement gate from
    // the sealed callback immediately before a destructive delete, so a race
    // cannot remove a local row or emit a delete Activity for a draft that is
    // still pending.
    window.__fsBeforeDeleteJob = function (id) {
      // The sealed confirmation callback can run after the actor or the row
      // changes. Re-check the current authorization before the callback is
      // allowed to append a delete Activity or remove the local row. If the
      // sealed permission function is unavailable, fail closed.
      switchActor();
      var row = records.find(function (item) { return item.id === id; });
      if (!row || typeof canDeleteJob !== 'function' || !canDeleteJob(row)) {
        window.alert(row ? deletePermissionMessage(id) : deleteMessage(id));
        paint();
        return false;
      }
      return gate(id, 'ลบใบงาน');
    };
    var targetedOpenSequence=0, targetedRooms=Object.create(null), targetedOpenWork=null;
    async function openScopedChat(id) {
      var sequence=++targetedOpenSequence, owner=currentUser || '', generation=chatGeneration();
      try {
        if (!owner || storageError || chatRecoveryBlocked || own(queue,id) || legacyBlocked(id)) return null;
        var scope=await readVisibleJobIdsNow(owner);
        if (visibleIdentity && scope.identity!==visibleIdentity) throw new Error('trusted session changed');
        if (!scope.ids[id]) throw new Error('visible scope changed during read');
        var ids=Object.create(null);ids[id]=true;
        var parents=await scopedRows('fs_records','id,data,updated_at',ids,'id','id.asc');
        var history=await readScopedChatHistory(ids), rooms=history.chats, messages=history.messages;
        var finalParents=await scopedRows('fs_records','id,data,updated_at',ids,'id','id.asc');
        var finalScope=await readVisibleJobIdsNow(owner), session=await trustedSession(owner);
        if (sequence!==targetedOpenSequence) return null;
        if (!sameChatGeneration(generation) || scope.identity!==finalScope.identity || session.identity!==scope.identity
          || json(scope.ids)!==json(finalScope.ids) || !finalScope.ids[id] || parents.length!==1 || parents[0].data.id!==id
          || json(parents)!==json(finalParents) || rooms.length>1 || own(queue,id) || storageError || chatRecoveryBlocked) throw new Error('visible scope changed during read');
        var local=getChat(id), roomData=rooms.length?rooms[0].data:{jobId:id,createdBy:parents[0].data.createdBy,parts:[],approvals:{}}, next=clone(roomData), byUid=Object.create(null);
        if (local) {next.approvals=clone(local.approvals || {});if (local.seen) next.seen=clone(local.seen);mergeParts(next,local.parts);}
        next.jobId=id;next.messages=[];
        messages.forEach(function (row) {var message=clone(row.data);if (!message.uid) message.uid=row.uid;if (message.uid!==row.uid) throw new Error('scoped history invalid');byUid[row.uid]=true;next.messages.push(message);});
        // Preserve embedded legacy history only when no normalized rows exist.
        if (!messages.length) (roomData.messages || []).forEach(function (message) {next.messages.push(clone(message));byUid[message.uid]=true;});
        (local && local.messages || []).forEach(function (message) {if (!byUid[message.uid] && json(confirmedChatData[id+'|'+message.uid])!==json(message)) next.messages.push(clone(message));});
        next.messages.sort(function (a,b) {return (a.ts || 0)-(b.ts || 0);});
        // No journal retirement here: only the full-baseline/ACK controller
        // owns durable recovery and receipt transitions.
        if (visibleHistoryIdentity===scope.identity && !stashPendingForIdentity(scope.identity)) throw new Error('pending chat recovery could not be saved');
        preserveHiddenChatInput();
        messages.forEach(function (row) {var message=clone(row.data);if (!message.uid) message.uid=row.uid;confirmedChatData[id+'|'+row.uid]=message;sbSnap.msgs[row.uid]=1;});
        records=records.filter(function (row) {return row.id!==id;}).concat([clone(parents[0].data)]);
        chats=chats.filter(function (room) {return room.jobId!==id;}).concat([next]);
        readOnlyChatRooms[id]=!rooms.length;
        targetedRooms[id]={identity:scope.identity,generation:generation};
        chatOpenId=id;if (typeof switchView==='function') switchView('chat');renderChat();updateFormulaSaveStatuses();return true;
      } catch (error) {
        if (sequence===targetedOpenSequence) {
          delete targetedRooms[id];
          if (error && (error.status===401 || error.status===403)) hideUnknownScope();
          else if (/trusted session/.test(error && error.message || '')) hideUnknownScope();
          else if (chatOpenId===id && /visible scope changed/.test(error && error.message || '')) {preserveHiddenChatInput();chatOpenId=null;sbReady=false;window.__fsCentralReady=false;renderChat();}
          diag(id,'gate:openChatRoom:targeted','read-failed');
        }
        return null;
      }
    }
    ['createChat','openChatRoom','newChatFromRecord','toggleChatApprove','approveOn','approveOff','closeJob','reopenJob','rejectJob','deleteChat','exportChatExcel'].forEach(function (name) {
      var original = window[name];
      if (typeof original !== 'function') return;
      if (name === 'openChatRoom') {
        window[name] = function (id) {
          targetedOpenSequence++;
          if (delegatedBoot && !own(queue,id) && !legacyBlocked(id)) {
            var request=openScopedChat(id);
            // A later room may finish before an older transport. Keep refresh
            // waiting for both, while returning this room's own result promptly.
            var opening=Promise.allSettled([targetedOpenWork,request]).then(function () {}).finally(function () {if (targetedOpenWork===opening) targetedOpenWork=null;});
            targetedOpenWork=opening;return request;
          }
          if (ready(id)) return original.apply(this,arguments);
          if (storageError) { gate(id, 'openChatRoom'); return null; }
          // The room is only waiting for the central baseline (page just
          // opened, or a history pull failed under load and the next full
          // cycle has not landed yet). Remember the request and open the room
          // as soon as the next full pull applies, instead of a hard "no".
          // 16 ต.ค. 2569: แยม/เชอรี่/โต hit this 0–953 s after sign-in while
          // the host was loaded; the red chip cleared by itself a cycle later.
          var why = readyReason(id);
          if ((why === 'central-not-ready' || why === 'permission-not-ready') && !own(queue, id) && !legacyBlocked(id)) {
            pendingChatOpen = {id:id, at:Date.now()};
            notices[id] = {kind:'pending', text:'กำลังโหลดข้อมูลจากระบบกลาง… จะเปิดห้องให้เมื่อพร้อม'};
            diag(id, 'gate:openChatRoom', why + ':waiting');
            paint(); return null;
          }
          diag(id, 'gate:openChatRoom', why, queue[id] && queue[id].reason);
          // A stale browser snapshot can be visible even when it has no local
          // edit proof or legacy suppression marker. Always run the same
          // read-only reconciliation before showing a hard failure; central
          // data may already be authoritative and ready, while a local-only
          // orphan remains safely blocked. No source-choice prompt is exposed
          // to the user and no write happens before the existing gates pass.
          var self = this, args = arguments;
          return autoReconcile(id).then(function (ok) {
            if (!ok || !ready(id)) { diag(id, 'gate:openChatRoom:reconciled', readyReason(id), recoveryDiagnostic && recoveryDiagnostic.id === id ? recoveryDiagnostic.stage + ':' + recoveryDiagnostic.outcome : ''); return null; }
            return original.apply(self,args);
          });
        };
        return;
      }
      window[name] = function (id) { if (!gate(id)) return null; return original.apply(this,arguments); };
    });
    var originalOpenRecordPopup = window.openRecordPopup;
    if (typeof originalOpenRecordPopup === 'function') window.openRecordPopup = function (id) {
      var result=originalOpenRecordPopup.apply(this,arguments), modal=document.getElementById('gModal');
      var acts=modal && modal.querySelector ? modal.querySelector('.modal-acts') : null;
      if (legacyBlocked(id) && acts && !document.getElementById('fsLegacyRecovery')) {
        var panel=document.createElement('div'); panel.id='fsLegacyRecovery'; panel.setAttribute('role','group');
        panel.style.cssText='flex-basis:100%;margin-top:8px;padding:8px 10px;border:1px solid #d97706;border-radius:7px;background:#fffbeb;color:#78350f;font-size:12px';
        var note=document.createElement('div'); note.textContent='ใบงานนี้ยังไม่ยืนยันการบันทึก ระบบจะตรวจสอบข้อมูลกลางและดำเนินการให้อัตโนมัติก่อนเปิดแชต'; panel.appendChild(note);
        if (acts.parentNode && typeof acts.parentNode.insertBefore === 'function') acts.parentNode.insertBefore(panel,acts); else if (modal.appendChild) modal.appendChild(panel);
      }
      return result;
    };
    var originalDeleteJob = window.deleteJob;
    if (typeof originalDeleteJob === 'function') window.deleteJob = function (id) {
      if (!gate(id, 'ลบใบงาน')) return null;
      return originalDeleteJob.apply(this,arguments);
    };
    var preparedChatSend=null, chatSendRunning=null, chatInputRevision=0;
    if (document && typeof document.addEventListener==='function') document.addEventListener('input',function (event) {
      if (event.target && event.target.id==='chatInput') chatInputRevision++;
    },true);
    function paintChatSendStatus() {
      var input=document.getElementById('chatInput'), pending=preparedChatSend;
      var sendButton=input && input.parentNode && input.parentNode.querySelector && input.parentNode.querySelector('button');
      if (sendButton) {sendButton.style.minHeight='44px';sendButton.style.minWidth='44px';}
      if (!input || !pending || pending.identity!==visibleIdentity || pending.jobId!==chatOpenId) return;
      var status=document.getElementById('fsChatSendStatus');
      if (!status) {
        status=document.createElement('div');status.id='fsChatSendStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
        status.style.cssText='font-size:12px;line-height:1.5;padding:6px 0;color:var(--muted,#64748b)';
        if (input.parentNode && input.parentNode.parentNode) input.parentNode.parentNode.appendChild(status);
      }
      var central=confirmedChatData[pending.jobId+'|'+pending.message.uid];
      if (pending.state==='pending' && central && json(central)===json(pending.message)) pending.state='saved';
      status.textContent=pending.state==='saving' ? 'กำลังเก็บข้อความในเครื่อง · กรุณารอก่อนปิดหน้านี้'
        : pending.state==='failed' ? 'ยังส่งไม่สำเร็จ · ข้อความยังอยู่ กรุณาลองส่งอีกครั้งเมื่อเชื่อมต่อได้'
        : pending.state==='saved' ? 'บันทึกข้อความในระบบกลางแล้ว' : 'เก็บข้อความในเครื่องแล้ว · รอยืนยันจากระบบกลาง';
    }
    var originalSendChatMsg=sendChatMsg;
    sendChatMsg = function () {
      if (chatSendRunning) return chatSendRunning;
      if (!gate(chatOpenId)) return false;
      // Older supported pages have no delegated trusted-history tuple. Keep
      // their sealed sender behind the same confirmed-parent/permission gate.
      if (!delegatedBoot) return originalSendChatMsg.apply(this,arguments);
      var room=getChat(chatOpenId);
      if (!room || !requirePerm('chat','บัญชีนี้ยังไม่มีสิทธิ์ส่งข้อความ')) return false;
      var input=document.getElementById('chatInput'), raw=input && (input.value || ''), text=(raw || '').trim();
      if (!text) {if (input) input.focus();return false;}
      var identity=visibleHistoryIdentity, generation=chatGeneration();
      if (!identity || identity!==visibleIdentity) return false;
      var pending=preparedChatSend;
      if (!pending || pending.state==='pending' || pending.state==='saved' || pending.identity!==identity || pending.jobId!==chatOpenId || pending.raw!==raw || !sameChatGeneration(pending.generation)) {
        var message={type:'msg',user:currentUser,text:text,ts:nowTs()};msgUid(room.jobId,message);
        pending={identity:identity,jobId:room.jobId,raw:raw,message:message,generation:generation,input:input,revision:chatInputRevision,state:'saving'};
        preparedChatSend=pending;
      } else {pending.input=input;pending.revision=chatInputRevision;pending.state='saving';}
      paintChatSendStatus();
      // Keep the existing pending-v2 payload and original click timestamp/UID.
      // No composer, activity, room mutation or dispatch precedes this barrier.
      chatSendRunning=(async function () {
        try {
          var entry=chatItemEntry({kind:'pending',identity:identity,jobId:pending.jobId,message:pending.message});
          if (!await ensureChatDurability({items:[{key:entry.key,raw:entry.raw}],raws:[],receipts:[]},identity,generation)) throw new Error('chat sender durability failed');
          if (!sameChatGeneration(generation) || chatOpenId!==pending.jobId || visibleIdentity!==identity || visibleHistoryIdentity!==identity) throw new Error('chat sender changed');
          if (delegatedBoot) {
            var scope=await readVisibleJobIds(generation.owner);
            if (!sameChatGeneration(generation) || scope.identity!==identity || !scope.ids[pending.jobId]) throw new Error('chat sender scope changed');
          }
          if (chatOpenId!==pending.jobId || visibleIdentity!==identity || visibleHistoryIdentity!==identity || !ready(pending.jobId)
            || !requirePerm('chat','บัญชีนี้ยังไม่มีสิทธิ์ส่งข้อความ')) throw new Error('chat sender changed');
          var current=getChat(pending.jobId);
          if (!current) throw new Error('chat sender changed');
          var existing=(current.messages || []).filter(function (m) {return msgUid(current.jobId,m)===pending.message.uid;});
          if (existing.some(function (m) {return json(m)!==json(pending.message);})) throw new Error('chat recovery identity collision');
          if (!existing.length) {
            current.messages.push(clone(pending.message));
            logAct('chat','ส่งข้อความ',pending.message.text.length>160 ? pending.message.text.slice(0,160)+'…' : pending.message.text,current.jobId);
            touchChatPart(current,pending.message.user,true);
          }
          var currentInput=document.getElementById('chatInput');
          if (currentInput===pending.input && chatInputRevision===pending.revision && currentInput.value===pending.raw) currentInput.value='';
          pending.state='pending';
          saveChats();
          // Reuse the focused-field guard: async completion cannot rebuild a
          // formula/worksheet editor entered while the sender was waiting. Its
          // next ordinary render will display the already durable message.
          var active=document.activeElement, tag=active && String(active.tagName || '').toUpperCase();
          var editing=active!==currentInput && (tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || active && active.isContentEditable);
          if (!editing) {
            preserveHiddenChatInput();renderChat();
            var next=document.getElementById('chatInput');if (next && !next.value) next.focus();
          }
          paintChatSendStatus();
          return true;
        } catch (error) {
          invalidateChatStoragePause();pending.state='failed';sbReady=false;window.__fsCentralReady=false;
          if (error.message==='chat sender durability failed' || error.message==='chat recovery identity collision') chatRecoveryBlocked=true;
          paintChatSendStatus();return false;
        }
      })().finally(function () {chatSendRunning=null;});
      return chatSendRunning;
    };
    function canDisplayRoom(id) {
      var targeted=targetedRooms[id];
      if (targeted && sameChatGeneration(targeted.generation) && (!visibleIdentity || targeted.identity===visibleIdentity) && actor===(currentUser || '')) return true;
      return !!(delegatedBoot && actor===(currentUser || '') && visibleHistoryIdentity && visibleHistoryIdentity===visibleIdentity
        && currentVisibleJobIds && currentVisibleJobIds[id] && own(confirmed,id));
    }
    var room = window.chatRoomHTML;
    if (typeof room === 'function') window.chatRoomHTML = function (c,r) {
      if (!c || !canDisplayRoom(c.jobId) && !ready(c.jobId)) return '<div role="status">แชตใช้งานได้หลังใบงานบันทึกในระบบกลางสำเร็จ</div>';
      return room.apply(this,arguments);
    };
    // The sealed create form links ingredient inputs to #ing_list, but the
    // reopened chat formula editor does not. Repair that missing association
    // at the runtime boundary so the chooser remains available without
    // editing the immutable upstream HTML.
    function repairChatIngredientInputs() {
      var doc = typeof document !== 'undefined' ? document : null;
      var list = doc && typeof doc.getElementById === 'function' ? doc.getElementById('ing_list') : null;
      if (!list || typeof doc.querySelectorAll !== 'function') return;
      Array.prototype.forEach.call(doc.querySelectorAll('input[id^="cfin-"][id$="-name"]'), function (input) {
        if (input && input.getAttribute('list') !== 'ing_list') input.setAttribute('list','ing_list');
      });
    }

    // Formula editors in the sealed page still contain legacy onchange
    // handlers.  Those handlers used to mutate `records` and save as soon as
    // a field lost focus.  Keep edits in an actor-scoped draft until the
    // explicit Save button is pressed.  A draft must never enter `records`:
    // capture() treats that array as an authoritative local revision and
    // would otherwise queue an edit before the user confirms it.
    var formulaDrafts = Object.create(null), modifyDrafts = Object.create(null);
    function clearDraftsForActor(owner) {
      Object.keys(formulaDrafts).forEach(function (id) { if (formulaDrafts[id].owner !== owner) delete formulaDrafts[id]; });
      Object.keys(modifyDrafts).forEach(function (id) { if (modifyDrafts[id].owner !== owner) delete modifyDrafts[id]; });
    }
    function formulaDraftFor(id) {
      if ((currentUser || '') !== actor) switchActor();
      clearDraftsForActor(actor);
      var r = records.find(function (x) { return x && x.id === id; });
      if (!r) return null;
      var d = formulaDrafts[id];
      if (d && d.owner === actor) return d;
      if (d) delete formulaDrafts[id];
      d = formulaDrafts[id] = {owner:actor, base:clone(r), baseFingerprint:json(r), rows:clone(r.rows || []), dirty:false};
      return d;
    }
    function formulaDraftView(r, d) {
      if (!d || d.owner !== actor) return r;
      var view = clone(r); view.rows = clone(d.rows || []); return view;
    }
    function modifyDraftFor(id) {
      if ((currentUser || '') !== actor) switchActor();
      clearDraftsForActor(actor);
      var r = records.find(function (x) { return x && x.id === id; });
      if (!r) return null;
      var d = modifyDrafts[id];
      if (d && d.owner === actor) return d;
      if (d) delete modifyDrafts[id];
      // `modifyIngs` is a mutable singleton owned by the sealed page.  Build
      // a fresh draft from the authoritative record so a user switch cannot
      // carry the previous actor's unsaved values into this account.
      var ings = (r.rows || []).map(function (row) {
        var w = Number(row.w) || 0, p = Number(row.p) || 0, actual = Number(row.actual);
        if (!Number.isFinite(actual)) actual = w * p / 100;
        var fda = row.fda || (typeof checkFDA === 'function' ? checkFDA(row.name || '', actual) : null);
        return {name:row.name || '', w:w.toFixed(2), o:row.o || '', p:String(p), actual:actual.toFixed(2), note:row.note || '', hero:!!row.hero,
          fdaIcon:fda && fda.icon ? fda.icon : '⚪', editedBy:'', editedAt:'', verifiedBy:'', verifiedAt:''};
      });
      d = modifyDrafts[id] = {owner:actor, base:clone(r), baseFingerprint:json(r), ings:ings, dirty:false};
      return d;
    }
    function formulaDraftStatus(id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text || 'แก้ไขแล้ว — กด “บันทึกสูตร” เพื่อยืนยัน';
    }
    function draftFormulaDetails(baseRows, rows) {
      var details = [];
      if ((baseRows || []).length !== (rows || []).length) details.push('จำนวนรายการ ' + (baseRows || []).length + ' → ' + (rows || []).length);
      (rows || []).forEach(function (row, i) {
        var before = (baseRows || [])[i] || {}, fields = ['name','w','o','p','note'];
        fields.forEach(function (field) {
          var left = field === 'w' || field === 'p' ? Number(before[field] || 0).toFixed(2) : String(before[field] || '');
          var right = field === 'w' || field === 'p' ? Number(row[field] || 0).toFixed(2) : String(row[field] || '');
          if (left !== right) details.push((row.name || '(ไม่มีชื่อ)') + ' · ' + field + ': ' + (left || '—') + ' → ' + (right || '—'));
        });
      });
      return details;
    }
    function sameRows(left, right) { return json(left || []) === json(right || []); }
    function updateFormulaSaveStatuses() {
      var chatId = typeof chatOpenId === 'string' ? chatOpenId : null;
      var modifyId = typeof modifyRec !== 'undefined' && modifyRec && modifyRec.id ? modifyRec.id : null;
      [['fxStateChat', chatId], ['fxStateMod', modifyId]].forEach(function (entry) {
        var id = entry[1], marker = document.getElementById(entry[0]);
        if (!id || !marker) return;
        var draft = entry[0] === 'fxStateChat'
          ? (formulaDrafts[id] && formulaDrafts[id].owner === actor ? formulaDrafts[id] : null)
          : (modifyDrafts[id] && modifyDrafts[id].owner === actor ? modifyDrafts[id] : null);
        if ((draft && draft.dirty) || (typeof fxDirtyOn !== 'undefined' && fxDirtyOn)) {
          marker.textContent = 'แก้ไขแล้ว — กด “บันทึกสูตร” เพื่อยืนยัน';
          return;
        }
        var current = state(id);
        if (!current) return;
        if (current.kind === 'saved') {
          // The sealed page uses one dirty flag for the formula surface. Clear
          // it only after the matching record receipt exists, never when Save
          // merely queued a local revision.
          var dirtyDraft = Object.keys(formulaDrafts).some(function (key) { return formulaDrafts[key].owner === actor && formulaDrafts[key].dirty; })
            || Object.keys(modifyDrafts).some(function (key) { return modifyDrafts[key].owner === actor && modifyDrafts[key].dirty; });
          if (!dirtyDraft) {
            if (typeof fxDirtyOn !== 'undefined') fxDirtyOn = false;
            if (document.querySelectorAll) Array.prototype.forEach.call(document.querySelectorAll('tr.fx-row-dirty'), function (row) { row.classList.remove('fx-row-dirty'); });
          }
        }
        marker.textContent = current.kind === 'saved' ? 'บันทึกแล้ว'
          : current.kind === 'failed' ? 'บันทึกไม่สำเร็จ · ตรวจสอบสถานะใบงาน'
          : 'กำลังบันทึก…';
      });
    }
    window.__fsUpdateFormulaSaveStatuses = updateFormulaSaveStatuses;
    function markFormulaDraftDirty() {
      if (typeof fxState === 'function') fxState('มีการแก้ไขที่ยังไม่ได้บันทึก — กด "บันทึกสูตร"', 'warn');
      if (typeof fxDirtyOn !== 'undefined') fxDirtyOn = true;
    }
    function clearFormulaDirtyAfterCommit() {
      var anotherDirty = Object.keys(formulaDrafts).some(function (key) { return formulaDrafts[key].owner === actor && formulaDrafts[key].dirty; })
        || Object.keys(modifyDrafts).some(function (key) { return modifyDrafts[key].owner === actor && modifyDrafts[key].dirty; });
      if (!anotherDirty && typeof fxDirtyOn !== 'undefined') fxDirtyOn = false;
    }
    function applyDraftIng(d, i, field, value) {
      var row = (d.rows || [])[i]; if (!row) return null;
      var before = field === 'w' || field === 'p' ? Number(row[field] || 0).toFixed(2) : String(row[field] || '');
      if (field === 'w' || field === 'p') row[field] = parseFloat(value) || 0; else row[field] = value;
      row.actual = (Number(row.w) || 0) * (Number(row.p) || 0) / 100;
      if (typeof checkFDA === 'function') row.fda = checkFDA(row.name || '', row.actual);
      var after = field === 'w' || field === 'p' ? Number(row[field] || 0).toFixed(2) : String(row[field] || '');
      return before === after ? null : {detail:(row.name || '(ไม่มีชื่อ)') + ' · ' + field + ': ' + (before || '—') + ' → ' + (after || '—')};
    }

    var formulaEditor = window.chatFormulaEditorHTML;
    if (typeof formulaEditor === 'function') window.chatFormulaEditorHTML = function (r) {
      var d = r && formulaDrafts[r.id] && formulaDrafts[r.id].owner === actor ? formulaDrafts[r.id] : null;
      var html = formulaEditor.call(this, formulaDraftView(r, d));
      return String(html).replace('แก้ไขได้ทันที — ทุกการเปลี่ยนแปลงถูกบันทึกเป็นข้อความในแชท', 'แก้ไขได้ตามต้องการ — ระบบจะบันทึกเมื่อกด “บันทึกสูตร” เท่านั้น');
    };

    // Commit helpers are wrapped by the same acknowledgement gate as the
    // legacy mutations.  They deliberately use the sealed save primitive
    // only after the CAS baseline is still current.
    window.__fsCommitChatFormula = function (jobId) {
      var d = formulaDraftFor(jobId), r = records.find(function (x) { return x && x.id === jobId; });
      if (!d || !r) return null;
      if (json(r) !== d.baseFingerprint) { window.alert('ใบงานนี้มีการเปลี่ยนแปลงจากผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกสูตร'); return null; }
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','แก้สูตรได้เฉพาะ Role: Admin, PD')) return null;
      // Read the DOM once more so clicking Save while a field still has focus
      // includes its current value even if the browser has not fired change.
      (d.rows || []).forEach(function (row, i) {
        ['name','w','o','p','note'].forEach(function (field) {
          var el = document.getElementById('cfin-' + i + '-' + field);
          if (!el) return;
          if (typeof chatApplyIng === 'function') chatApplyIng({rows:d.rows}, i, field, el.value);
          else applyDraftIng(d, i, field, el.value);
        });
      });
      var details = draftFormulaDetails(d.base.rows || [], d.rows || []);
      if (!details.length) { delete formulaDrafts[jobId]; clearFormulaDirtyAfterCommit(); formulaDraftStatus('fxStateChat','บันทึกแล้ว — ไม่มีค่าไหนเปลี่ยน'); return null; }
      r.rows = clone(d.rows || []);
      r.rows.forEach(function (row, i) { row.num = i + 1; });
      r.rdUpdated = true;
      formulaDraftStatus('fxStateChat','กำลังบันทึก…');
      logAct('formula','แก้สูตรในห้องแชท (กดบันทึก)', details.join(' | ').slice(0, 1000), r.id);
      var message = (currentUser || 'ผู้ใช้') + ' บันทึกการแก้สูตร: ' + details.join(' | ');
      var result = sealedChatSaveFormula.call(this, r, message);
      delete formulaDrafts[jobId];
      clearFormulaDirtyAfterCommit();
      if (typeof renderChat === 'function') renderChat();
      updateFormulaSaveStatuses();
      if (typeof paint === 'function') paint();
      return result;
    };

    window.__fsCommitModify = function (jobId) {
      var d = modifyDraftFor(jobId), r = records.find(function (x) { return x && x.id === jobId; });
      if (!d || !r) return null;
      if (json(r) !== d.baseFingerprint) { window.alert('ใบงานนี้มีการเปลี่ยนแปลงจากผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกสูตร'); return null; }
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','แก้สูตรได้เฉพาะ Role: Admin, PD')) return null;
      (d.ings || []).forEach(function (mi, i) {
        ['name','w','o','p','actual','note'].forEach(function (field) {
          var el = document.getElementById('mdin-' + i + '-' + field);
          if (el) mi[field] = el.value;
        });
      });
      var nextRows = (d.ings || []).map(function (mi, i) { return modifyIngToRow(mi, i); });
      if (sameRows(r.rows || [], nextRows)) { delete modifyDrafts[jobId]; clearFormulaDirtyAfterCommit(); formulaDraftStatus('fxStateMod','บันทึกแล้ว — ไม่มีค่าไหนเปลี่ยน'); return null; }
      var next = clone(r); next.rows = nextRows; next.rdUpdated = true;
      var idx = records.findIndex(function (x) { return x.id === jobId; });
      if (idx < 0) return null;
      formulaDraftStatus('fxStateMod','กำลังบันทึก…');
      records[idx] = next; modifyRec = next; window._lastDash = next;
      logAct('formula','แก้สูตร (PD Modify Data)', 'บันทึกสูตร ' + nextRows.length + ' รายการ', jobId);
      saveRecordsStore();
      renderDashboard(next); renderRecordsList();
      delete modifyDrafts[jobId]; clearFormulaDirtyAfterCommit(); buildModifyData(); renderModify();
      updateFormulaSaveStatuses();
      if (typeof paint === 'function') paint();
      return next;
    };

    deferRecordActivity('__fsCommitChatFormula','การบันทึกสูตร');
    deferRecordActivity('__fsCommitModify','การบันทึกสูตร');
    var deferredChatCommit = window.__fsCommitChatFormula;
    var deferredModifyCommit = window.__fsCommitModify;
    window.chatIngEdit = function (jobId, i, field, value) {
      var d = formulaDraftFor(jobId); if (!d || !d.rows[i]) return null;
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','แก้สูตรได้เฉพาะ Role: Admin, PD')) return null;
      var change = typeof chatApplyIng === 'function' ? chatApplyIng({rows:d.rows}, i, field, value) : applyDraftIng(d, i, field, value);
      if (change) { d.dirty = true; formulaDraftStatus('fxStateChat'); }
      return change;
    };
    window.chatIngAdd = function (jobId) {
      var d = formulaDraftFor(jobId); if (!d) return null;
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','เพิ่มสารได้เฉพาะ Role: Admin, PD')) return null;
      d.rows.push({num:d.rows.length + 1, name:'', w:0, o:'', p:100, actual:0, note:'', hero:false, fda:typeof checkFDA === 'function' ? checkFDA('',0) : undefined});
      d.dirty = true; markFormulaDraftDirty(); if (typeof renderChat === 'function') renderChat(); formulaDraftStatus('fxStateChat'); return d.rows[d.rows.length - 1];
    };
    window.chatIngDel = function (jobId, i) {
      var d = formulaDraftFor(jobId); if (!d || !d.rows[i]) return null;
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','ลบสารได้เฉพาะ Role: Admin, PD')) return null;
      var nm = d.rows[i].name || '(ยังไม่ระบุชื่อ)';
      if (typeof confirm === 'function' && !confirm('ลบสาร "' + nm + '" ออกจากสูตร?')) return null;
      d.rows.splice(i,1); d.rows.forEach(function (row,n) { row.num = n + 1; }); d.dirty = true; markFormulaDraftDirty();
      if (typeof renderChat === 'function') renderChat(); formulaDraftStatus('fxStateChat'); return true;
    };
    window.saveChatFormula = function (jobId) { return deferredChatCommit.call(this, jobId); };

    var sealedRenderModify = window.renderModify;
    if (typeof sealedRenderModify === 'function') window.renderModify = function () {
      if ((currentUser || '') !== actor) switchActor();
      clearDraftsForActor(actor);
      var id = modifyRec && modifyRec.id, d = id && modifyDrafts[id] && modifyDrafts[id].owner === actor ? modifyDrafts[id] : null;
      if (!d) {
        var plain = sealedRenderModify.apply(this, arguments);
        formulaDraftStatus('fxStateMod','แก้ไขแล้ว — กด “บันทึกสูตร” เพื่อยืนยัน');
        return plain;
      }
      var savedRec = modifyRec, savedIngs = modifyIngs;
      var view = clone(savedRec); view.rows = (d.ings || []).map(function (mi, i) { return modifyIngToRow(mi, i); });
      modifyRec = view; modifyIngs = d.ings;
      try {
        var rendered = sealedRenderModify.apply(this, arguments);
        formulaDraftStatus('fxStateMod','แก้ไขแล้ว — กด “บันทึกสูตร” เพื่อยืนยัน');
        return rendered;
      }
      finally { modifyRec = savedRec; modifyIngs = savedIngs; }
    };
    window.editIng = function (i, field, value) {
      var id = modifyRec && modifyRec.id, d = id && modifyDraftFor(id);
      if (!d || !d.ings[i]) return null;
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','แก้สูตรได้เฉพาะ Role: Admin, PD')) return null;
      d.ings[i][field] = value; d.ings[i].editedBy = currentUser; d.ings[i].editedAt = new Date().toLocaleString('th-TH');
      d.ings[i].verifiedBy = ''; d.ings[i].verifiedAt = ''; d.dirty = true; formulaDraftStatus('fxStateMod'); return d.ings[i];
    };
    window.addModifyIng = function () {
      var id = modifyRec && modifyRec.id, d = id && modifyDraftFor(id); if (!d) return null;
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','เพิ่มสารได้เฉพาะ Role: Admin, PD')) return null;
      d.ings.push({name:'',w:'0.00',o:'',p:'100',actual:'0.00',note:'',hero:false,fdaIcon:'⚪',editedBy:currentUser,editedAt:new Date().toLocaleString('th-TH'),verifiedBy:'',verifiedAt:''});
      d.dirty = true; markFormulaDraftDirty(); renderModify(); return d.ings[d.ings.length - 1];
    };
    window.delModifyIng = function (i) {
      var id = modifyRec && modifyRec.id, d = id && modifyDraftFor(id); if (!d || !d.ings[i]) return null;
      if (typeof requirePerm === 'function' && !requirePerm('editFormula','ลบสารได้เฉพาะ Role: Admin, PD')) return null;
      var nm = d.ings[i].name || '(ยังไม่ระบุชื่อ)';
      if (typeof confirm === 'function' && !confirm('ลบสาร "' + nm + '" ออกจากสูตร?')) return null;
      d.ings.splice(i,1); d.dirty = true; markFormulaDraftDirty(); renderModify(); return true;
    };
    window.saveModifyFormula = function () {
      var id = modifyRec && modifyRec.id; if (!id) return null;
      return deferredModifyCommit.call(this, id);
    };

    preserveHiddenChatInput=function () {
      composingChat=null;
      var inputIdentity=chatOpenId && targetedRooms[chatOpenId] && sameChatGeneration(targetedRooms[chatOpenId].generation)?targetedRooms[chatOpenId].identity:visibleHistoryIdentity===visibleIdentity?visibleIdentity:'';
      if (!inputIdentity || !chatOpenId) return;
      var input=document.getElementById('chatInput'), scroll=document.getElementById('chatScroll');
      if (!input || typeof input.value!=='string') return;
      hiddenChatInputs[json([inputIdentity,chatOpenId])]={value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input,scroll:scroll?scroll.scrollTop:null};
    };
    function restoreHiddenChatInput() {
      if (!chatOpenId || !canDisplayRoom(chatOpenId)) return;
      var inputIdentity=targetedRooms[chatOpenId]?targetedRooms[chatOpenId].identity:visibleIdentity;
      var key=json([inputIdentity,chatOpenId]), saved=hiddenChatInputs[key], input=document.getElementById('chatInput');
      if (!saved || !input) return;
      // A newer local input always wins over the hidden room's saved draft.
      if (!input.value) {
        input.value=saved.value;
        if (saved.focused && input.focus) input.focus();
        if (input.setSelectionRange) try { input.setSelectionRange(saved.start,saved.end); } catch (_) {}
        var scroll=document.getElementById('chatScroll'); if (scroll && saved.scroll!==null) scroll.scrollTop=saved.scroll;
      }
      delete hiddenChatInputs[key];
    }
    var composingChat=null;
    if (document && typeof document.addEventListener==='function') {
      document.addEventListener('compositionstart',function (event) {
        if (event.target && event.target.id==='chatInput' && chatOpenId && canDisplayRoom(chatOpenId)) composingChat={target:event.target,identity:visibleIdentity,jobId:chatOpenId};
      },true);
      document.addEventListener('compositionend',function (event) {
        var pending=composingChat; composingChat=null;
        if (pending && pending.target===event.target && pending.identity===visibleIdentity && pending.jobId===chatOpenId && canDisplayRoom(chatOpenId)) renderChat();
      },true);
    }
    var ignoreLegacyCacheRender=false;
    function skipLegacyCacheRender() {
      ignoreLegacyCacheRender=true;
      // Only suppress the legacy listener's synchronous redraw. A listener
      // for a hidden view must not suppress a later explicit room navigation.
      Promise.resolve().then(function () { ignoreLegacyCacheRender=false; });
    }
    var legacyLoadRecords=window.loadRecords;
    if (delegatedBoot && typeof legacyLoadRecords==='function') window.loadRecords=function () {
      if (visibleHistoryIdentity || Object.keys(targetedRooms).length) { skipLegacyCacheRender(); return; }
      return legacyLoadRecords.apply(this,arguments);
    };
    var legacyLoadChats=window.loadChats;
    if (delegatedBoot && typeof legacyLoadChats==='function') window.loadChats=function () {
      // Window-target storage listeners can run in registration order before
      // this deferred asset's capture listener. A slim disk cache is recovery
      // material, never a replacement for verified in-memory server history.
      if (visibleHistoryIdentity || Object.keys(targetedRooms).length) { skipLegacyCacheRender(); return; }
      return legacyLoadChats.apply(this,arguments);
    };
    var render = renderChat;
    renderChat = function () {
      if ((currentUser || '') !== actor) switchActor();
      clearDraftsForActor(actor);
      if (ignoreLegacyCacheRender) { ignoreLegacyCacheRender=false; if (chatOpenId && canDisplayRoom(chatOpenId)) return; }
      if (composingChat && composingChat.identity===visibleIdentity && composingChat.jobId===chatOpenId && canDisplayRoom(chatOpenId)) return;
      if (chatOpenId && !canDisplayRoom(chatOpenId) && !ready(chatOpenId)) chatOpenId = null;
      var result = render.apply(this,arguments);
      restoreHiddenChatInput();
      repairChatIngredientInputs();
      paintChatSendStatus();
      return result;
    };
    window.addEventListener('online', function () { switchActor(); sbQueue(); paint(); });
    // The sealed app's legacy fs_records storage listener reloads the entire
    // local cache from another tab. That snapshot may predate an in-progress
    // formula edit and make the value appear to bounce backwards. Keep the
    // server as the cross-tab authority: suppress that stale cache reload and
    // request a fresh central read instead.
    window.addEventListener('storage', function (event) {
      if (!delegatedBoot || !event || !(event.key==='fs_chats' || event.key && event.key.indexOf(CHAT_JOURNAL)===0)) return;
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      // An unchanged notification replaces no original. Ignore it before
      // archival can pause readiness and force a full room rebuild.
      if (event.oldValue===event.newValue) return;
      if (event.key==='fs_chats') {
        // A removal/compaction notification may be the final surviving copy.
        // Persist both sides before starting a refresh that can clear caches.
        var eventRaws=[event.oldValue,event.newValue].filter(function (raw) {return typeof raw==='string';});
        var eventPause=window.__fsCentralReady===true && sbReady && startupPhase==='ready' && visibleIdentity && visibleHistoryIdentity===visibleIdentity && currentVisibleJobIds && window.__fsPermissionReady===true
          ? {identity:visibleIdentity,generation:chatGeneration(),epoch:chatSaveFailureEpoch,failure:chatPauseFailureEpoch,scope:json(currentVisibleJobIds)} : null;
        var captured=preserveChatWork(function () {
          eventRaws.forEach(function (raw) {captureChatRaw('fs_chats',raw);});
          return eventRaws.every(function (raw) {return preserveUnclassifiedChatCache(visibleHistoryIdentity,confirmedChatData,[],raw);});
        },visibleHistoryIdentity);
        if (!captured) {
          if (eventPause && eventPause.epoch===chatSaveFailureEpoch && eventPause.failure===chatPauseFailureEpoch && chatBarrier) chatStorageEventPause=eventPause;
          chatRecoveryBlocked=true;window.__fsCentralReady=false;return;
        }
      }
      // Never install another tab's replaceable cache over this tab's drafts.
      // Journal first; the fresh authorized snapshot merges immutable entries.
      // Replaceable caches are notifications, not new local save intents.
      // The normal 20-second read reconciles them without a cross-tab loop.
      if (event.key==='fs_chats') {
        if (visibleHistoryIdentity && !stashPendingForIdentity(visibleHistoryIdentity)) window.__fsCentralReady=false;
        return;
      }
      // A new immutable entry still present byte-for-byte is already durable.
      // Removal/unequal replacement can leave event.oldValue as its sole copy:
      // capture exact strings synchronously as opaque evidence, never replay.
      var immutableAddition=false;
      try {immutableAddition=event.oldValue===null && typeof event.newValue==='string' && localStorage.getItem(event.key)===event.newValue;} catch (_) {}
      if (!immutableAddition) mergeChatBatch(chatWaiting,{raws:[event.oldValue,event.newValue].filter(function (raw) {return typeof raw==='string';}).map(function (raw) {return {sourceKey:event.key,raw:raw};})});
      // Do not stash or start an adapter operation inside this notification:
      // the owning cycle preserves memory and drains evidence before apply.
      if (!cacheWake) cacheWake=Promise.resolve().then(function () { cacheWake=null; return sbCycle(true); });
    }, true);
    window.addEventListener('storage', function (event) {
      if (!actor || !event || (event.key!=='fs_records' && event.key!=='fs_reccounter')) return;
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      switchActor();
      if (!delegatedBoot && typeof sbCycle === 'function') sbCycle(true);
    }, true);
    window.addEventListener('storage', function (event) {
      if (!actor || !event.key || event.key.indexOf(key()) !== 0) return;
      // Each tab has immutable revision keys. Disjoint drafts combine; forks
      // remain stored and are reviewed before either version can be sent.
      load(); restore(); baseline(); paint();
    });
    window.__fsJobSync.ready = true;
    if (!delegatedBoot) {
      // Keep the legacy harness/older pages' refresh contract.  The sealed
      // production page delegates boot above, so this branch cannot create a
      // second production pull.
      if (typeof sbLastFull !== 'undefined') sbLastFull = 0;
      if (typeof sbCycle === 'function') sbCycle(true);
    } else {
      var startHistory = function () {
        if (!startupActorReady) return false;
        if (historyRunning) { historyFollowup = true; return; }
        if (delegatedBoot) closeChatForUnknownScope();
        historyDeferred = false; historyRunning = true; startupPhase = 'history-loading';
        currentVisibleJobIds = null;
        // Keep all write paths closed until the complete baseline is present.
        sbReady = false; window.__fsCentralReady = false; sbChip(); paint();
        if (startupFillIds) sbFillIdPool(2).catch(function () {});
        var owner = currentUser || '', generation = visibleGeneration, historySessionGeneration=window.__fsSessionGeneration, chatHistoryEpoch=chatSaveFailureEpoch, historyWatermarks=clone(sbWM), historyCapabilities=clone(sbCap), historyLastFull=sbLastFull;
        return readVisibleSnapshot(owner).then(function (snapshot) {
          if (owner!==currentUser || historySessionGeneration!==window.__fsSessionGeneration) throw new Error('user changed during visible chat read');
          generation = visibleGeneration;
          activeVisibleSnapshot = snapshot;
          return startupPull(true).then(async function (d) {
            var finalSession = await trustedSession(owner);
            if (generation!==visibleGeneration || owner!==currentUser || historySessionGeneration!==window.__fsSessionGeneration || finalSession.identity!==snapshot.identity) {
              throw new Error('user or role changed during visible chat read');
            }
            if (!await prepareChatReconciliation(d,snapshot,{visible:generation,session:historySessionGeneration,owner:owner})) throw new Error('pending chat recovery could not be saved');
            reconcileVisibleChats(d, snapshot);
            return d;
          });
        }).then(function (d) {
          if (d && !d.partial) {
            var fullIds=Object.create(null); (d.rec || []).forEach(function (row) { fullIds[row.id]=true; });
            observeVisibleScope(fullIds);
            Object.keys(fullIds).forEach(function (id) { delete revokedCentralRecords[id]; });
          }
          assertChatSaveAttempt(chatHistoryEpoch);
          assertChatWaitingSettled({visible:generation,session:historySessionGeneration,owner:owner},chatHistoryEpoch);
          sbApply(d);assertChatSaveAttempt(chatHistoryEpoch);
          if (d && !d.partial) {
            sbReady = true; window.__fsCentralReady = true; startupPhase = 'ready'; sbErr = '';
            currentVisibleJobIds=Object.create(null); (d.rec || []).forEach(function (row) { currentVisibleJobIds[row.id]=true; });
            pendingHydration=Object.create(null); roomVersions=Object.create(null); approvalVersions=Object.create(null);
            (d.cht || []).forEach(function (row) { roomVersions[row.job_id]=row.updated_at || ''; });
            (d.apv || []).forEach(function (row) { approvalVersions[row.job_id+'|'+row.part]=row.updated_at || ''; });
          } else {
            startupPhase = 'failed'; sbErr = 'ยังโหลดประวัติจากระบบกลางไม่ครบ';
            connectionFailure('history',{message:'central read page incomplete'});
          }
        }).catch(function (error) {
          sbWM=historyWatermarks;
          if (error===CHAT_DEFERRED) {sbCap=historyCapabilities;sbLastFull=historyLastFull;return false;}
          if (error && (error.status===401 || error.status===403)) sbCap=historyCapabilities;
          // Keep the on-disk copy for recovery, but never leave a stale room
          // set exposed in memory when the current server scope is unknown.
          if (owner === currentUser && visibleIdentity && !chatRecoveryBlocked
            && stashPendingForIdentity(visibleIdentity) && typeof chats !== 'undefined' && Array.isArray(chats)) {
            if (clearConfirmedChatCache(visibleIdentity)) chats = [];
            else chatRecoveryBlocked = true;
          }
          closeChatForUnknownScope();
          startupPhase = 'failed'; sbErr = String(error && error.message || error);
          connectionFailure('history',error);
        }).finally(function () {
          activeVisibleSnapshot = null;
          historyRunning = false; sbChip(); paint();
          if (historyFollowup || cycleAgain) { historyFollowup = false; cycleAgain=false; setTimeout(function () { sbCycle(true); },0); }
          else if (typeof sbSchedule === 'function') sbSchedule();
        });
      };
      startHistoryRefresh = startHistory;
      resumeChatDurability=function () {if (historyRunning || cyclePromise) {cycleAgain=true;return;}if (!cacheWake) cacheWake=Promise.resolve().then(function () {cacheWake=null;return sbCycle(true);});};
      if (document && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible' && typeof sbCycle === 'function') sbCycle(true);
        });
      }
      if (window && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', function () { if (typeof sbCycle === 'function') sbCycle(true); });
      }
      retryBootstrap = function (initial) {
        if (bootstrapPromise) return bootstrapPromise;
        if (!initial && typeof window.__fsRetrySessionActor !== 'function') return false;
        if (typeof sbTimer !== 'undefined') clearTimeout(sbTimer);
        sbReady = false; window.__fsCentralReady = false; startupPhase = 'core-loading';
        var owner = currentUser || '', generation = window.__fsSessionGeneration;
        bootstrapPromise = Promise.resolve().then(function () {
          if (initial) return window.__fsRuntimeBoot();
          // sbBoot may seed legacy rows and install listeners. Retry only its
          // read baseline, keeping the existing history/write guards closed.
          return startupPull(true).then(function (data) {
            if (owner !== (currentUser || '') || generation !== window.__fsSessionGeneration) throw new Error('session changed during bootstrap');
            if (!data || !Array.isArray(data.usr)) throw new Error('core profiles unavailable');
            sbApply(data); sbReady = false;
            return window.__fsRetrySessionActor(data.usr);
          });
        }).then(function (retried) {
          sbReady = false;
          var actorReady = initial ? window.__fsSessionActorReady : Promise.resolve(retried);
          if (!actorReady || typeof actorReady.then !== 'function') throw new Error('session actor unavailable');
          return actorReady;
        }).then(function (ready) {
          if (ready !== true) throw new Error('session actor unavailable');
          startupActorReady = true;
          return startHistory();
        }).catch(function (error) {
          sbReady = false; window.__fsCentralReady = false;
          startupPhase = 'failed'; sbErr = String(error && error.message || error);
          connectionFailure('bootstrap',error); sbChip(); paint();
          return false;
        }).finally(function () {
          bootstrapPromise = null;
          if (typeof sbSchedule === 'function') sbSchedule();
        });
        return bootstrapPromise;
      };
      retryBootstrap(true);
    }
    integritySchedule();
    paint();
  }
  install();
})();
