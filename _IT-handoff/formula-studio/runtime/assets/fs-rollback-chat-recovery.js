/* Standalone rollback recovery. No sealed-app/job-sync dependency, storage
 * migration, acknowledgement, deletion, replay or upstream data request. */
(function () {
  'use strict';
  if (window.__fsRollbackChatRecovery) return;
  var label, button;
  async function verifiedSession() {
    var response = await window.fetch('/sb/session', { method: 'GET', credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('recovery session unavailable');
    var session = await response.json();
    if (!session || session.authenticated !== true || typeof session.name !== 'string' || !session.name
      || typeof session.centralUserId !== 'string' || !session.centralUserId || typeof session.role !== 'string' || !session.role
      || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new Error('recovery session invalid');
    return session;
  }
  function identity(session) {
    var values = [session.name, session.centralUserId, session.role], email = String(session.email || '').trim().toLowerCase();
    if (email) values.push(email);
    return JSON.stringify(values);
  }
  function permitted(key, raw, session, owner) {
    if (session.role === 'admin') return true;
    try {
      var value = JSON.parse(raw);
      if (key.indexOf('fs_chat_journal_v2:') === 0) return value && value.kind === 'pending' && value.identity === owner;
      if (key.indexOf('fs_chat_pending_v1:') === 0) return decodeURIComponent(key.slice('fs_chat_pending_v1:'.length)) === owner && Array.isArray(value);
    } catch (_) { /* Unknown or malformed ownership evidence is Admin-only. */ }
    return false;
  }
  async function snapshot() {
    var before = await verifiedSession(), owner = identity(before), entries = [];
    if (!window.__fsChatJournal) throw new Error('chat-journal-unavailable');
    var fallback=await window.__fsChatJournal.snapshot();
    for (var index = 0; index < localStorage.length; index++) {
      var key = localStorage.key(index);
      if (!key || !/^(fs_chat_journal_v2:|fs_chat_pending_v1:|fs_chat_unclassified_recovery_v1$|fs_chats$)/.test(key)) continue;
      var raw = localStorage.getItem(key);
      if (raw !== null && permitted(key, raw, before, owner)) entries.push({ key: key, raw: raw });
    }
    fallback.items.forEach(function (entry) {
      if (permitted(entry.key,entry.raw,before,owner) && !entries.some(function (row) {return row.key===entry.key && row.raw===entry.raw;})) entries.push({key:entry.key,raw:entry.raw});
    });
    if (before.role==='admin') fallback.raws.forEach(function (entry) {
      if (!entries.some(function (row) {return row.key===entry.sourceKey && row.raw===entry.raw;})) entries.push({key:entry.sourceKey,raw:entry.raw});
    });
    var after = await verifiedSession();
    if (identity(after) !== owner) throw new Error('recovery session changed');
    return { format: 'formula-rollback-chat-recovery-v1', entries: entries };
  }
  async function download() {
    var payload = await snapshot();
    if (typeof Blob !== 'function' || !window.URL || !window.URL.createObjectURL) throw new Error('download unavailable');
    var url = window.URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
    var link = document.createElement('a'); link.href = url; link.download = 'formula-chat-recovery.json';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    if (label) label.textContent = 'ดาวน์โหลดสำเนาแล้ว ' + payload.entries.length + ' รายการ · ข้อมูลเดิมยังอยู่ในเครื่อง · ไฟล์นี้ยังไม่ได้ถูกนำกลับเข้าระบบ';
    return payload.entries.length;
  }
  window.__fsRollbackChatRecovery = { snapshot: snapshot, download: download };
  var panel = document.createElement('section');
  label = document.createElement('p'); label.id = 'fsRollbackRecoveryStatus'; label.setAttribute('role', 'status');
  label.textContent = 'กรุณาเข้าสู่ระบบ Formula ในแท็บอื่นก่อนดาวน์โหลด โดยใช้เบราว์เซอร์และที่อยู่เว็บไซต์เดียวกัน'; panel.appendChild(label);
  button = document.createElement('button'); button.id = 'fsRollbackRecoveryDownload'; button.type = 'button';
  button.textContent = 'ดาวน์โหลดข้อมูลแชตในเครื่อง'; button.setAttribute('aria-describedby', label.id);
  button.style.cssText = 'min-height:44px;max-width:100%;padding:10px 16px;font:inherit;cursor:pointer';
  button.onclick = async function () {
    button.disabled = true;
    label.textContent='กำลังอ่านสำเนาแชตและตรวจสอบสิทธิ์…';
    try { await download(); }
    catch (_) { label.textContent = 'ยังดาวน์โหลดไม่ได้ กรุณาตรวจสอบการเข้าสู่ระบบและลองใหม่ · ข้อมูลเดิมยังอยู่ในเครื่อง'; }
    finally { button.disabled = false; }
  };
  panel.appendChild(button); document.body.appendChild(panel);
}());
