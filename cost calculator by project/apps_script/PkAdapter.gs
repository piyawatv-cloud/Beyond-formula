/** Synthetic-only transport contract. No PU-PK physical mapper, network or pricing engine. */
var PkAdapter = (function () {
  'use strict';
  function check(ok, code) { if (!ok) throw new Error(code); }
  function nonempty(x) { return typeof x === 'string' && x.trim() !== ''; }
  function number(x, positive) { return typeof x === 'number' && Number.isFinite(x) && (positive ? x > 0 : x >= 0); }
  function version(x) { return Number.isInteger(x) && x > 0; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(x[k]); }).join(',') + '}';
    return JSON.stringify(x);
  }
  function date(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x; }
  function time(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x) && date(x.slice(0,10)) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,19) === x.slice(0,19); }
  function validateContext(c) {
    check(c && ['projectId','scenarioId','requirementId','specVersion'].every(function(k){return nonempty(c[k]);}) && version(c.requirementRevision),'CONTEXT_IDENTITY_REQUIRED');
    check(number(c.sellingUnits,true) && Number.isInteger(c.sellingUnits) && number(c.unitsPerPack,true) && Number.isInteger(c.unitsPerPack) && number(c.fillAmount,true) && ['g','kg','mg','ml','l','piece'].includes(c.fillUnit),'CONTEXT_UNIT_REQUIRED');
    check(Array.isArray(c.componentIds) && c.componentIds.length > 0 && c.componentIds.every(nonempty) && new Set(c.componentIds).size === c.componentIds.length,'CONTEXT_COMPONENTS_REQUIRED');
  }
  function assertAvailable(value) {
    if (typeof value === 'number') check(Number.isFinite(value),'PK_NONFINITE_SOURCE_VALUE');
    if (!value || typeof value !== 'object') return;
    var unavailable = ['withdrawn','obsolete','stale','syncFailed','excluded','ambiguous','revoked','superseded'];
    Object.keys(value).forEach(function (key) {
      var v = value[key];
      if (unavailable.includes(key)) check(v == null || v === false || v === 0 || v === '' || v === 'false' || v === '0','PK_SOURCE_UNAVAILABLE');
      assertAvailable(v);
    });
  }
  function validate(raw, expected, mapping, now) {
    assertAvailable(raw);
    check(time(now),'INVALID_EVALUATION_TIME'); validateContext(expected);
    check(raw && nonempty(raw.id) && version(raw.version),'SNAPSHOT_IDENTITY_REQUIRED');
    validateContext(raw.context);
    check(canonical(raw.context) === canonical(expected) && raw.requestId === expected.requirementId,'CONTEXT_MISMATCH');
    check(['draft','confirmed'].includes(raw.status),'EXPLICIT_STATUS_REQUIRED');
    check(date(raw.validFrom) && date(raw.validUntil) && raw.validFrom <= now.slice(0,10) && raw.validUntil >= now.slice(0,10),'PK_VALIDITY_MISMATCH');
    check(raw.currency === 'THB' && raw.basis === 'lot','PK_CURRENCY_OR_BASIS_UNSUPPORTED');
    check(nonempty(raw.evidenceRef) && (raw.baseTotal === null || number(raw.baseTotal)) && (raw.adjustedTotal === null || number(raw.adjustedTotal)),'PK_AMOUNTS_OR_EVIDENCE_INVALID');
    check(Array.isArray(raw.components) && raw.components.length === expected.componentIds.length,'PK_COMPONENTS_INCOMPLETE');
    var seen = {};
    raw.components.forEach(function(c){
      check(c && nonempty(c.id) && !seen[c.id] && expected.componentIds.includes(c.id),'PK_COMPONENT_ID_INVALID'); seen[c.id] = true;
      check(nonempty(c.itemId) && nonempty(c.tierId) && number(c.quantity,true) && ['piece','pcs','pack','roll','kg','g','m','m2'].includes(c.unit) && nonempty(c.evidenceRef),'PK_COMPONENT_TERMS_INVALID');
    });
    if (raw.status === 'confirmed') {
      var e = raw.confirmation, a = raw.specAcceptance;
      check(e && nonempty(e.actorId) && time(e.at) && Date.parse(e.at) <= Date.parse(now) && e.snapshotId === raw.id && e.version === raw.version && nonempty(e.evidenceRef),'PK_CONFIRMATION_INVALID');
      check(mapping.verifyConfirmation(clone(e),clone(raw)) === true,'PK_CONFIRMATION_UNVERIFIED');
      check(a && nonempty(a.actorId) && time(a.at) && Date.parse(a.at) <= Date.parse(e.at) && a.specVersion === expected.specVersion && a.requirementRevision === expected.requirementRevision,'PK_SPEC_ACCEPTANCE_INVALID');
      check(mapping.verifySpecAcceptance(clone(a),clone(raw)) === true,'PK_SPEC_ACCEPTANCE_UNVERIFIED');
    }
  }
  function receive(sourceResult, expectedContext, mapping, storage, now) {
    check(mapping && mapping.mode === 'synthetic-only' && nonempty(mapping.verificationEvidenceRef) && typeof mapping.normalize === 'function' && typeof mapping.verifyConfirmation === 'function' && typeof mapping.verifySpecAcceptance === 'function','VERIFIED_SYNTHETIC_MAPPING_REQUIRED');
    check(storage && typeof storage.transaction === 'function' && typeof storage.get === 'function' && typeof storage.append === 'function','PERSISTENT_STORAGE_CONTRACT_REQUIRED');
    // The injected mapping is trusted reviewed code, never inferred from a sheet header.
    assertAvailable(sourceResult); // Reject before mapping can omit a withdrawal/failure flag.
    var raw = mapping.normalize(clone(sourceResult));
    validate(raw,expectedContext,mapping,now);
    var envelope = clone(raw), fingerprint = canonical(envelope), c = envelope.context;
    var candidate = {
      id:envelope.id, version:envelope.version, envelope:envelope, fingerprint:fingerprint,
      mappingEvidenceRef:mapping.verificationEvidenceRef, receivedAt:now, syntheticOnly:true,
      coreSnapshot:{id:envelope.id,version:envelope.version,projectId:c.projectId,scenarioId:c.scenarioId,requirementId:c.requirementId,requirementRevision:c.requirementRevision,sellingUnits:c.sellingUnits,unitsPerPack:c.unitsPerPack,fillAmount:c.fillAmount,fillUnit:c.fillUnit,specVersion:c.specVersion,status:envelope.status,validFrom:envelope.validFrom,validUntil:envelope.validUntil,evidenceRef:envelope.evidenceRef,currency:envelope.currency,baseTotal:envelope.baseTotal,adjustedTotal:envelope.adjustedTotal,syntheticOnly:true}
    };
    return storage.transaction(function () {
      var old = storage.get(candidate.id);
      if (old) {
        check(old.fingerprint === fingerprint,'PK_SNAPSHOT_CONTENT_CONFLICT');
        return {status:'DUPLICATE',autoAdopt:false,candidate:clone(old)};
      }
      // append must atomically insert-if-absent or throw, with no scenario/adoption writes.
      storage.append(clone(candidate));
      return {status:'AVAILABLE',autoAdopt:false,candidate:clone(candidate)};
    });
  }
  return {receive:receive};
}());
