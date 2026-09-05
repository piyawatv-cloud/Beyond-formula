/**
 * Cost workflow orchestration, SYNTHETIC ONLY. This module has no web endpoint,
 * authentication implementation, credentials, deployed store or chat transport.
 * Every injected adapter is a trusted server dependency, never a request field.
 * Production integration requires independently reviewed server authentication,
 * transactional storage and recipient-side idempotency. Enablement is not auth.
 */
var CostWorkflow = (function () {
  'use strict';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(function(k){return value[k]!==undefined;}).map(function(k){return JSON.stringify(k)+':'+stable(value[k]);}).join(',') + '}';
    return JSON.stringify(value);
  }
  function create(config, adapters) {
    if (!config || config.enabled !== true) throw Error('WORKFLOW_DISABLED');
    if (config.environment !== 'synthetic') throw Error('SYNTHETIC_ONLY');
    var a=adapters || {};
    if (!a.calculator || typeof a.calculator.calculate!=='function' || typeof a.calculator.project!=='function' || !a.store || typeof a.store.transaction!=='function' || ['authorize','now','readCurrentVersion','sendReceipt','digest'].some(function(k){return typeof a[k]!=='function';})) throw Error('DEPENDENCY_REQUIRED');
    if (!/^https:\/\/[a-z0-9.-]+(?:\/[a-zA-Z0-9_.\/-]*)?$/.test(config.formulaBaseUrl || '')) throw Error('FORMULA_LINK_CONFIGURATION_REQUIRED');
    var formulaBaseUrl=config.formulaBaseUrl;
    function identity(request) {
      if (!request || !/^[A-Za-z0-9_-]{1,80}$/.test(request.projectId || '') || !/^[A-Za-z0-9_-]{1,80}$/.test(request.scenarioId || '') || !Number.isInteger(request.expectedRevision) || request.expectedRevision<1) throw Error('INVALID_IDENTITY');
      return {projectId:request.projectId,scenarioId:request.scenarioId,revision:request.expectedRevision};
    }
    function authority(session,command,id) {
      var granted=a.authorize(session,command,id.projectId);
      if (!granted || typeof granted.actorId!=='string' || !granted.actorId.trim() || !Array.isArray(granted.permissions) || granted.permissions.indexOf(command)<0) throw Error('VERIFIED_SERVER_AUTHORITY_REQUIRED');
      return granted.actorId;
    }
    function timestamp() {
      var at=a.now();
      if (typeof at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString().slice(0,19)!==at.slice(0,19)) throw Error('SERVER_TIME_REQUIRED');
      return at;
    }
    function key(kind,id) { return kind+':'+id.projectId+':'+id.scenarioId+':'+id.revision; }
    function read(tx,id) {
      if (!tx || ['get','put','insert'].some(function(k){return typeof tx[k]!=='function';})) throw Error('TRANSACTION_CONTRACT_REQUIRED');
      var s=a.readCurrentVersion(tx,id.projectId,id.scenarioId);
      if (!s || s.projectId!==id.projectId || s.scenarioId!==id.scenarioId || s.revision!==id.revision) throw Error('STALE_OR_MISMATCHED_REVISION');
      return copy(s);
    }
    function fingerprint(s) {
      var digest=a.digest(stable(s));
      if (typeof digest!=='string' || !/^[a-f0-9]{64}$/.test(digest)) throw Error('SHA256_DIGEST_REQUIRED');
      return digest;
    }
    function safeSummary(s,at) {
      var r=a.calculator.calculate(s,at.slice(0,10)), projected=a.calculator.project(r,'Sales');
      // Only approved display aliases cross this boundary; full names and source
      // item objects are never copied. A missing approved alias gets a placeholder.
      var names=(s.rmLines || []).map(function(line,i){return line.displayNameApproved===true && typeof line.alias==='string' && line.alias.trim()?line.alias.trim():'รายการวัสดุ '+(i+1);});
      return {projectId:s.projectId,scenarioId:s.scenarioId,revision:s.revision,sellingUnits:s.sellingUnits,pack:{unitsPerPack:s.unitsPerPack,fillAmount:s.fillAmount,fillUnit:s.fillUnit},displayNames:names,currency:'THB',amounts:{RM:projected.rm.adjustedTotal,PK:projected.pk.adjustedTotal,Operation:projected.operation.adjustedTotal},finalPerSellingUnit:projected.complete?projected.finalPerSellingUnit:null,complete:projected.complete,label:projected.complete?'ราคาคำนวณพร้อมตรวจอนุมัติ (ยังไม่ใช่การอนุมัติ CEO)':'ยังไม่ใช่ต้นทุนรวมต่อชิ้นหรือราคาพร้อมเสนอ',pending:copy(projected.pending),link:formulaBaseUrl+'#project='+encodeURIComponent(s.projectId)+'&scenario='+encodeURIComponent(s.scenarioId)+'&revision='+s.revision};
    }
    function sendSummary(request,session) {
      var id=identity(request), actor=authority(session,'send-cost-summary',id), at=timestamp(), eventKey=key('summary',id);
      var record=a.store.transaction(function(tx){
        var existing=tx.get(eventKey);
        if (existing) {
          var current=a.readCurrentVersion(tx,id.projectId,id.scenarioId);
          if (!current || current.projectId!==id.projectId || current.scenarioId!==id.scenarioId || current.revision<id.revision) throw Error('STALE_OR_MISMATCHED_REVISION');
          if (current.revision===id.revision && existing.sourceDigest!==fingerprint(current)) throw Error('REVISION_CONTENT_CONFLICT');
          // A new draft does not erase delivery of the already committed old
          // revision. Retry its saved body, never rebuild it using current prices.
          return existing;
        }
        var s=read(tx,id),sourceDigest=fingerprint(s);
        var event={idempotencyKey:eventKey,projectId:id.projectId,summary:safeSummary(s,at)};
        var created={kind:'summary-outbox',id:eventKey,sourceDigest:sourceDigest,event:event,status:'pending',createdBy:actor,createdAt:at,receiptId:null};
        tx.insert(eventKey,created);
        return created;
      });
      if (record.status!=='pending') return copy({id:record.id,status:record.status,receiptId:record.receiptId});
      // The outbox is committed before send. An exception may mean the receiver
      // accepted the message: leave pending and retry the EXACT key and payload.
      // sendReceipt MUST deduplicate durably at the receiver across attempts.
      var receipt;
      try { receipt=a.sendReceipt(copy(record.event)); } catch (_) { receipt={status:'pending'}; }
      if (!receipt || ['sent','failed'].indexOf(receipt.status)<0 || typeof receipt.receiptId!=='string' || !receipt.receiptId) return copy({id:record.id,status:'pending',receiptId:null});
      var persisted=a.store.transaction(function(tx){
        var current=tx.get(eventKey);
        if (!current || current.sourceDigest!==record.sourceDigest) throw Error('OUTBOX_CONFLICT');
        if (current.status==='pending') {current.status=receipt.status;current.receiptId=receipt.receiptId;current.receivedAt=timestamp();tx.put(eventKey,current);}
        return current;
      });
      return copy({id:persisted.id,status:persisted.status,receiptId:persisted.receiptId});
    }
    function approve(request,session) {
      var id=identity(request),actor=authority(session,'approve-cost-quotation',id),at=timestamp(),approvalKey=key('approval',id);
      return a.store.transaction(function(tx){
        var s=read(tx,id),sourceDigest=fingerprint(s),existing=tx.get(approvalKey);
        if (existing) {
          if(existing.sourceDigest!==sourceDigest)throw Error('REVISION_CONTENT_CONFLICT');
          return copy(existing);
        }
        var result=a.calculator.calculate(s,at.slice(0,10));
        if (!result.complete) throw Error('INCOMPLETE_QUOTATION');
        var approval={kind:'approval',id:approvalKey,projectId:id.projectId,scenarioId:id.scenarioId,revision:id.revision,sourceDigest:sourceDigest,actorId:actor,approvedAt:at,snapshot:{scenario:s,result:copy(result)}};
        // Approval is append-only. Revisions get new keys; no update path exists.
        tx.insert(approvalKey,approval);
        return copy(approval);
      });
    }
    return Object.freeze({sendSummary:sendSummary,approve:approve});
  }
  return Object.freeze({create:create});
})();
