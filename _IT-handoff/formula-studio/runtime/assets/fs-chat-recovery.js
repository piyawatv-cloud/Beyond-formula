/* Read-only recovery surface, deliberately independent of the sealed app and
 * fs-job-sync. Retain this asset and /__formula/chat-recovery during rollback.
 * No payload is displayed/exported before a fresh server session/scope check. */
(function () {
  'use strict';
  if (window.__fsChatRecovery) return;
  var panel, label, button;
  var recoveryPage=!!(window.location && window.location.pathname==='/__formula/chat-recovery');
  async function entries() {
    if (!window.__fsChatJournal) throw new Error('chat-journal-unavailable');
    var fallback=await window.__fsChatJournal.snapshot();
    var result=[];
    for (var n=0;n<localStorage.length;n++) {
      var key=localStorage.key(n), raw=localStorage.getItem(key), value;
      if (!key || raw===null || !/^(fs_chat_journal_v2:|fs_chat_pending_v1:|fs_chat_unclassified_recovery_v1$|fs_chats$)/.test(key)) continue;
      try { value=JSON.parse(raw); } catch (_) { value={kind:'opaque',raw:raw}; }
      if (key.indexOf('fs_chat_pending_v1:')===0 && Array.isArray(value)) {
        var identity; try { identity=decodeURIComponent(key.slice('fs_chat_pending_v1:'.length)); } catch (_) { identity=''; }
        value.forEach(function (item) { result.push({source:key,raw:raw,value:{kind:'pending',identity:identity,jobId:item && item.jobId,message:item && item.message}}); });
      } else result.push({source:key,raw:raw,value:value});
    }
    fallback.items.forEach(function (entry) {
      if (!result.some(function (row) {return row.source===entry.key && row.raw===entry.raw;})) result.push({source:entry.key,raw:entry.raw,value:entry.value,backend:'indexeddb'});
    });
    fallback.raws.forEach(function (entry) {result.push({source:'indexeddb-raw',sourceKey:entry.sourceKey,raw:entry.raw,value:{kind:'opaque'},backend:'indexeddb'});});
    return result;
  }
  var refreshing=0;
  async function refresh() {
    var generation=++refreshing;
    if (!panel) {
      panel=document.createElement('section'); panel.id='fsChatRecoveryStatus'; panel.setAttribute('role','status');
      panel.style.cssText='padding:10px 16px;border-top:1px solid #d4d4d4;font-size:13px';
      label=document.createElement('span'); panel.appendChild(label);
      if (recoveryPage) {
        button=document.createElement('button'); button.type='button'; button.className='btn btn-s btn-sm';
        button.style.cssText='min-height:44px;padding:8px 12px;margin:8px 0;font:inherit;cursor:pointer'; button.textContent='ดาวน์โหลดข้อมูลแชตรอกู้คืน';
        button.onclick=function () { return download().catch(function () { label.textContent='ยังตรวจสอบสิทธิ์กู้คืนไม่ได้ ข้อมูลยังอยู่ในเครื่อง กรุณาลองใหม่'; }); }; panel.appendChild(button);
      }
      var link=document.createElement('a'); link.style.cssText='display:inline-flex;align-items:center;min-height:44px;padding:8px 12px;box-sizing:border-box'; link.href='/__formula/chat-recovery'; link.textContent=' เปิดหน้ากู้คืนแยก'; panel.appendChild(link);
      var main=typeof document.querySelector==='function' && document.querySelector('.main');
      if (main) main.insertBefore(panel,main.firstChild);
      else document.body.appendChild(panel);
    }
    panel.hidden=false;if (button) button.disabled=true;label.textContent='กำลังอ่านสำเนาแชตในเครื่อง…';
    var count;try {count=(await entries()).length;} catch (_) {count=-1;}
    if (generation!==refreshing) return;
    if (button) button.disabled=false;panel.hidden=count===0;
    label.textContent=count<0?'อ่านพื้นที่กู้คืนไม่ได้ ข้อมูลยังไม่ถูกลบ': 'มีสำเนาแชตในเครื่อง '+count+' รายการ · จะตรวจสอบกับระบบกลางก่อนดาวน์โหลด รายการที่ไม่ทราบเจ้าของต้องให้ Admin ตรวจสอบ · ';
  }
  async function read(path) {
    var response=await window.fetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('recovery authorization unavailable');
    return response.json();
  }
  function identity(session) {
    if (!session || session.authenticated!==true || !session.name || !session.centralUserId
      || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt)<=Date.now()) throw new Error('recovery session invalid');
    var values=[session.name,session.centralUserId,session.role || ''], email=String(session.email || '').trim().toLowerCase();
    if (email) values.push(email);
    return JSON.stringify(values);
  }
  function canonical(value) {
    if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
    if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(function (key) {return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
    return JSON.stringify(value);
  }
  async function snapshot() {
    var before=await read('/sb/session'), owner=identity(before);
    var history=await read('/__formula/visible-chat-snapshot');
    if (!history || !Array.isArray(history.messages)) throw new Error('recovery readback unavailable');
    var central=new Map();
    history.messages.forEach(function (row) {
      if (!row || typeof row.job_id!=='string' || typeof row.uid!=='string' || !row.data || typeof row.data!=='object') throw new Error('recovery readback invalid');
      var key=JSON.stringify([row.job_id,row.uid]), data=JSON.parse(JSON.stringify(row.data));
      if (!data.uid) data.uid=row.uid;
      if (central.has(key)) throw new Error('recovery readback ambiguous');
      central.set(key,canonical(data));
    });
    // Re-read current visibility after history; old payload cannot authorize
    // an export after a same-session owner transfer.
    var rows=await entries();
    var scope=await read('/__formula/visible-record-ids');
    if (!scope || !Array.isArray(scope.ids) || scope.ids.some(function (id) { return typeof id!=='string'; })) throw new Error('recovery scope invalid');
    var visible=new Set(scope.ids);
    var after=await read('/sb/session');
    if (identity(after)!==owner) throw new Error('recovery session changed');
    var confirmedCount=0, unresolved=rows.filter(function (entry) {
      var item=entry.value;
      if (!(after.role==='admin' || item && item.kind==='pending' && item.identity===owner && visible.has(item.jobId))) return false;
      if (item && (item.kind==='pending' || item.kind==='unclassified-message') && item.message && typeof item.message.uid==='string'
        && central.get(JSON.stringify([item.jobId,item.message.uid]))===canonical(item.message)) {
        confirmedCount++; return false;
      }
      return true;
    });
    if (after.role!=='admin') unresolved=unresolved.map(function (entry) {
      // A v1 source array can contain hidden parents. Only Admin may receive
      // the original composite string; other users receive the scoped item.
      if (entry.source.indexOf('fs_chat_pending_v1:')===0) return {source:entry.source,value:entry.value};
      return entry;
    });
    if (label) label.textContent='ยืนยันกับระบบกลางแล้ว '+confirmedCount+' รายการ · ยังต้องตรวจสอบ '+unresolved.length+' รายการ · สำเนาเดิมในเครื่องยังไม่ถูกลบ · ';
    return {version:2,confirmedCount:confirmedCount,entries:unresolved};
  }
  async function download() {
    var payload=await snapshot();
    if (typeof Blob!=='function' || !window.URL || !window.URL.createObjectURL) throw new Error('download unavailable');
    var url=window.URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));
    var link=document.createElement('a'); link.href=url; link.download='formula-chat-recovery.json';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(function () { window.URL.revokeObjectURL(url); },1000);
    return payload.entries.length;
  }
  window.__fsChatRecovery={refresh:refresh,snapshot:snapshot,download:download};
  window.addEventListener('storage',refresh);
  window.addEventListener('focus',refresh);
  if (recoveryPage) {
    document.body.style.cssText='font:16px/1.6 system-ui,sans-serif;color:#202124;background:#fff;max-width:960px;margin:24px auto;padding:0 16px;overflow-wrap:anywhere';
  }
  refresh();
}());
