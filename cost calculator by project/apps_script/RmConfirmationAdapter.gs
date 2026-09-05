/** Human-run A03/A04 preparation. No physical sheet/column contract is assumed.
 * Binding is deliberately unset: an operator must supply a reviewed pilot binding.
 * No trigger, source-row editing, authorization fallback or status-based confirmation.
 */
var RmConfirmationAdapter = (function () {
  'use strict';
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function text(x) { return typeof x === 'string' && x.trim() !== ''; }
  function check(x, message) { if (!x) throw new Error(message); }
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+canonical(x[k]);}).join(',') + '}';
    return JSON.stringify(x);
  }
  function bindingOK(b) {
    check(b && text(b.reviewedEvidenceRef) && ['read','authorize','withLock','backup','readBackup','appendEvent','writeGate','flush'].every(function(k){return typeof b[k] === 'function';}),'REVIEWED_PILOT_BINDING_REQUIRED');
  }
  function read(b) {
    var items = copy(b.read()), seen = Object.create(null);
    check(Array.isArray(items),'BINDING_ROWS_REQUIRED');
    items.forEach(function(item){
      check(item && text(item.key) && !seen[item.key],'DUPLICATE_OR_MISSING_IDENTITY'); seen[item.key] = true;
      check(item.record && item.context && typeof item.context === 'object' && ['READY','BLOCKED'].includes(item.gate),'BINDING_RECORD_REQUIRED');
    });
    return items;
  }
  function preview(b, requests, actor, now) {
    bindingOK(b); check(actor && text(actor.id) && b.authorize(actor,'confirm-rm') === true,'NOT_AUTHORIZED');
    check(typeof now === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(now) && Number.isFinite(Date.parse(now)) && new Date(now).toISOString().slice(0,19)===now.slice(0,19),'INVALID_TIME');
    check(Array.isArray(requests),'SELECTIONS_REQUIRED');
    var items=read(b), selections=Object.create(null), changes=[], skipped=[];
    requests.forEach(function(r){check(r && text(r.key) && text(r.expectedVersion) && !selections[r.key],'DUPLICATE_OR_INVALID_SELECTION');selections[r.key]=r;});
    items.forEach(function(item){
      var event=null, confirmation=item.confirmation, selection=selections[item.key];
      if (selection) {
        delete selections[item.key];
        try {
          check(selection.expectedVersion === item.record.version,'VERSION_CONFLICT');
          // Existing exact eligible event means idempotent confirmation, not another log entry.
          if (!RmData.eligible(item.record,confirmation,now,item.context).ready) {
            event=RmData.confirm(item.record,selection.expectedVersion,actor,now,b.authorize);
            check(RmData.eligible(item.record,event,now,item.context).ready,'CURRENT_CONTEXT_UNAVAILABLE');
            confirmation=event;
          }
        } catch (error) {
          event=null; confirmation=item.confirmation;
          skipped.push({key:item.key,reason:'REVIEW_REQUIRED'});
        }
      }
      var gate=RmData.eligible(item.record,confirmation,now,item.context).ready ? 'READY' : 'BLOCKED';
      if (event || item.gate !== gate) changes.push({key:item.key,gate:gate,event:event});
    });
    Object.keys(selections).forEach(function(key){skipped.push({key:key,reason:'IDENTITY_NOT_FOUND'});});
    var effect=changes.map(function(c){return {key:c.key,gate:c.gate,version:c.event ? c.event.version : null};});
    // Sensitive preview token: internal only, never log canonical commercial data.
    return {token:canonical({items:items,requests:requests,actorId:actor.id,effect:effect}),changes:changes,skipped:skipped,total:items.length,at:now};
  }
  function report(p) { return 'ตรวจ '+p.total+' รายการ · จะปรับสถานะ/บันทึก '+p.changes.length+' รายการ · รอตรวจ '+p.skipped.length+' รายการ (ยังไม่เขียนข้อมูล)'; }
  function apply(b, approvedPreview, requests, actor, now) {
    bindingOK(b);
    return b.withLock(function(){
      var p=preview(b,requests,actor,now);
      check(approvedPreview && approvedPreview.token === p.token,'PREVIEW_CHANGED');
      if (!p.changes.length) return {status:'UNCHANGED',changed:0,skipped:p.skipped.length};
      var before=read(b).filter(function(i){return p.changes.some(function(c){return c.key===i.key;});});
      var backup={before:before,changes:p.changes,at:now,actorId:actor.id};
      var ref=b.backup(copy(backup));
      check(text(ref) && canonical(b.readBackup(ref))===canonical(backup),'BACKUP_VERIFICATION_FAILED');
      // Remove stale READY gates first; event failure can never leave a new READY label.
      p.changes.forEach(function(c){var old=before.find(function(i){return i.key===c.key;});if(old.gate!=='BLOCKED')b.writeGate(c.key,'BLOCKED');});
      b.flush();
      p.changes.forEach(function(c){if(c.event)b.appendEvent(c.key,copy(c.event));});
      b.flush();
      p.changes.forEach(function(c){
        if(c.gate!=='READY')return;
        var current=read(b).find(function(i){return i.key===c.key;}),old=before.find(function(i){return i.key===c.key;});
        check(current && canonical(current.record)===canonical(old.record) && canonical(current.context)===canonical(old.context),'SOURCE_CHANGED_DURING_APPLY');
        check(RmData.eligible(current.record,current.confirmation,now,current.context).ready,'EVENT_PERSISTENCE_NOT_VERIFIED');
        b.writeGate(c.key,'READY');
      });
      b.flush();
      var after=read(b);
      var unsafe=after.filter(function(item){return p.changes.some(function(c){return c.key===item.key;}) && item.gate==='READY' && !RmData.eligible(item.record,item.confirmation,now,item.context).ready;});
      if(unsafe.length){unsafe.forEach(function(item){b.writeGate(item.key,'BLOCKED');});b.flush();throw new Error('POST_WRITE_ELIGIBILITY_CHANGED');}
      p.changes.forEach(function(c){var item=after.find(function(i){return i.key===c.key;});check(item && item.gate===c.gate,'GATE_WRITE_NOT_VERIFIED');});
      return {status:'APPLIED',changed:p.changes.length,skipped:p.skipped.length,backupRef:ref};
    });
  }
  return {preview:preview,report:report,apply:apply};
}());
// Human-run entry points require an explicitly installed/reviewed binding. No source IDs.
var RM_CONFIRMATION_BINDING = null;
function previewRmConfirmation(requests, actor, now) {
  return RmConfirmationAdapter.preview(RM_CONFIRMATION_BINDING,requests,actor,now);
}
function applyRmConfirmation(preview, requests, actor, now) {
  return RmConfirmationAdapter.apply(RM_CONFIRMATION_BINDING,preview,requests,actor,now);
}
