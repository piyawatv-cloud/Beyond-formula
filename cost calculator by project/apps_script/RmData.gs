/** Deterministic RM domain core. No Sheets writes, triggers or browser authorization.
 * Physical source mapping, authenticated actors and durable event/generation storage
 * are mandatory adapter responsibilities; see docs/RM_IMPLEMENTATION.md.
 */
var RmData = (function () {
  'use strict';
  var numberPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  var units = '(kg|g|mg|piece|pcs|pack|l)';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function text(value) { return value == null ? '' : String(value).trim(); }
  function requireValue(value, message) { if (!value) throw new Error(message); }
  // Collision-free canonical serialization, NOT an authorization token or public identifier.
  // Do not expose versions to users without commercial-data permission.
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function positive(value) {
    var s = text(value);
    if (!(new RegExp('^' + numberPattern + '$')).test(s)) return null;
    var n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function quantity(value) {
    var match = text(value).match(new RegExp('^(' + numberPattern + ')\\s*' + units + '\\.?$', 'i'));
    return match && positive(match[1]) ? {quantity:positive(match[1]),unit:match[2].toLowerCase()} : null;
  }
  function price(value) {
    var match = text(value).match(new RegExp('^(?:THB\\s*)?(' + numberPattern + ')(?:\\s*\\/\\s*(' + numberPattern + ')?\\s*' + units + '\\.?)?$', 'i'));
    if (!match || !positive(match[1]) || (match[2] && !positive(match[2]))) return null;
    return {price:positive(match[1]),currency:'THB',priceBasisQuantity:match[2] ? positive(match[2]) : 1,priceUnit:match[3] ? match[3].toLowerCase() : 'kg'};
  }
  function pair(q, p, index) {
    var qty = quantity(q), money = price(p);
    return {position:index + 1,rawQuantity:q,rawPrice:p,moq:qty ? qty.quantity : null,moqUnit:qty ? qty.unit : null,price:money ? money.price : null,priceUnit:money ? money.priceUnit : null,priceBasisQuantity:money ? money.priceBasisQuantity : null,currency:'THB',valid:!!qty && !!money};
  }
  // Slash is list punctuation here. Use arrays when a token itself contains '/kg'.
  function parsePaired(quantities, prices) {
    var qs = Array.isArray(quantities) ? quantities : text(quantities).split(/\s*\/\s*|\r?\n/);
    var ps = Array.isArray(prices) ? prices : text(prices).split(/\s*\/\s*|\r?\n/);
    var positions = [];
    for (var i = 0; i < Math.max(qs.length, ps.length); i++) positions.push(pair(qs[i] == null ? '' : text(qs[i]), ps[i] == null ? '' : text(ps[i]), i));
    return {ok:qs.length === ps.length && positions.length > 0 && positions.every(function (p) { return p.valid; }), positions:positions};
  }
  function parseNotes(note) {
    var positions = text(note).split(/\r?\n/).map(function (line, i) {
      var match = line.trim().match(/^MOQ\s*\(?([^():]+)\)?\s*:\s*(.+)$/i);
      return match ? pair(match[1].trim(), match[2].trim(), i) : pair('', line, i);
    });
    return {ok:positions.length > 0 && positions.every(function (p) { return p.valid; }), positions:positions};
  }
  function validDate(value) {
    var s = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var date = new Date(s + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0,10) === s;
  }
  function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && validDate(value.slice(0,10)) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19); }
  function strings(value) {
    if (value == null) return [];
    if (typeof value === 'object') return Object.keys(value).reduce(function (a,k) { return a.concat(strings(value[k])); }, []);
    return [String(value)];
  }
  function normalize(input) {
    var raw = clone(input), reasons = [];
    var forbidden = /ยกเลิก|ยังไม่เคยซื้อ|ไม่ผ่าน\s*อย\.?|cancelled|canceled|never purchased|regulatory fail/i;
    var excluded = strings(raw).some(function (s) { return forbidden.test(s); });
    if (excluded) reasons.push('EXCLUDED_STATUS');
    if (!text(raw.sourceDate)) { excluded = true; reasons.push('MISSING_DATE'); }
    else if (!validDate(raw.sourceDate)) reasons.push('INVALID_DATE');
    ['materialId','specVersion','vendorId','sourceRef','evidenceRef'].forEach(function (k) { if (!text(raw[k])) reasons.push('MISSING_' + k); });
    if (!timestamp(raw.observedAt)) reasons.push('INVALID_OBSERVED_AT');
    if (raw.orderIncrement != null && (!positive(raw.orderIncrement.quantity) || !quantity(String(raw.orderIncrement.quantity) + ' ' + text(raw.orderIncrement.unit)))) reasons.push('INVALID_ORDER_INCREMENT');
    if (!Number.isFinite(raw.leadTimeDays) || raw.leadTimeDays < 0) reasons.push('INVALID_LT');
    if (!validDate(raw.validUntil) || (validDate(raw.sourceDate) && raw.validUntil < raw.sourceDate)) reasons.push('INVALID_VALIDITY');
    if (!raw.scope || !['central','project'].includes(raw.scope.type) || (raw.scope.type === 'project' && !text(raw.scope.projectId))) reasons.push('INVALID_SCOPE');
    var parsed = raw.tierNotes !== undefined ? parseNotes(raw.tierNotes) : parsePaired(raw.quantityText,raw.priceText);
    if (!parsed.ok) reasons.push('AMBIGUOUS_TIERS');
    // Extra price evidence must be explicitly resolved by the source mapper; never choose latest silently.
    if (raw.unresolvedEvidence === true) reasons.push('UNRESOLVED_EVIDENCE');
    var terms = {materialId:raw.materialId,specVersion:raw.specVersion,vendorId:raw.vendorId,sourceDate:raw.sourceDate,validUntil:raw.validUntil,leadTimeDays:raw.leadTimeDays,scope:raw.scope,orderIncrement:raw.orderIncrement || null,constraints:raw.constraints || {},evidenceRef:raw.evidenceRef,tiers:parsed.positions};
    terms = clone(terms); // DQ fields may be absent: preserve a JSON-roundtrippable generation.
    return {materialId:raw.materialId || null,classification:excluded ? 'excluded' : reasons.length ? 'dq' : 'accepted',reasons:reasons,terms:terms,version:canonical(terms),observation:canonical(raw),raw:raw,specAccepted:true};
  }
  function authorize(actor, action, check) { requireValue(actor && text(actor.id) && typeof check === 'function' && check(actor,action) === true,'NOT_AUTHORIZED'); }
  function specReady(record) {
    if (record.specAccepted !== true) return false;
    if (!record.request) return true; // Existing authoritative catalog identity, supplied by trusted mapper.
    var accepted = record.specAcceptance;
    return !!accepted && text(accepted.actorId) !== '' && timestamp(accepted.at) && accepted.materialId === record.materialId && accepted.specVersion === record.terms.specVersion;
  }
  function confirm(record, expectedVersion, actor, at, check) {
    authorize(actor,'confirm-rm',check);
    requireValue(timestamp(at),'INVALID_TIME');
    requireValue(record.classification === 'accepted' && specReady(record),'NOT_ELIGIBLE');
    requireValue(!record.specAcceptance || Date.parse(record.specAcceptance.at) <= Date.parse(at),'FUTURE_SPEC_ACCEPTANCE');
    requireValue(expectedVersion === record.version && canonical(record.terms) === record.version,'VERSION_CONFLICT');
    requireValue(at.slice(0,10) >= record.terms.sourceDate && at.slice(0,10) <= record.terms.validUntil,'OUTSIDE_VALIDITY');
    return {type:'RM_CONFIRMED',version:record.version,materialId:record.materialId,actorId:actor.id,at:at,evidenceRef:record.terms.evidenceRef};
  }
  // Confirmation must be loaded from protected append-only storage, never caller/UI JSON.
  function eligible(record, confirmation, at, context) {
    var reason = null, c = context || {};
    if (!timestamp(at)) reason = 'INVALID_TIME';
    else if (record.classification !== 'accepted' || !specReady(record)) reason = 'NOT_ELIGIBLE';
    else if (canonical(record.terms) !== record.version) reason = 'TERMS_CHANGED';
    else if (!confirmation || confirmation.type !== 'RM_CONFIRMED' || !text(confirmation.actorId) || !timestamp(confirmation.at) || confirmation.version !== record.version || confirmation.materialId !== record.materialId || confirmation.evidenceRef !== record.terms.evidenceRef) reason = 'UNCONFIRMED';
    else if (Date.parse(confirmation.at) > Date.parse(at) || (record.specAcceptance && (Date.parse(record.specAcceptance.at) > Date.parse(at) || Date.parse(record.specAcceptance.at) > Date.parse(confirmation.at)))) reason = 'FUTURE_CONFIRMATION_OR_SPEC';
    else if (Object.keys(record.terms.constraints).length > 0 && c.conditionsSatisfied !== true) reason = 'CONDITIONS_UNVERIFIED';
    else if (c.withdrawn || c.obsolete || c.syncFailed || c.stale) reason = 'UNAVAILABLE';
    else if (record.terms.scope.type === 'project' && record.terms.scope.projectId !== c.projectId) reason = 'SCOPE_MISMATCH';
    else if (at.slice(0,10) < record.terms.sourceDate || at.slice(0,10) > record.terms.validUntil) reason = 'OUTSIDE_VALIDITY';
    return {ready:reason === null,reason:reason};
  }
  function requestMaterial(input, actor, check, at) {
    authorize(actor,'request-rm',check); requireValue(timestamp(at),'INVALID_TIME');
    ['requestId','projectId','revisionId','requirements'].forEach(function(k){ requireValue(text(input[k]),'MISSING_' + k); });
    return {requestId:input.requestId,projectId:input.projectId,revisionId:input.revisionId,requirements:input.requirements,requestedBy:actor.id,requestedAt:at,status:'REQUESTED'};
  }
  function propose(request, input, actor, check, at) {
    authorize(actor,'propose-rm',check); requireValue(timestamp(at),'INVALID_TIME');
    requireValue(request && request.status === 'REQUESTED' && text(request.requestId),'INVALID_REQUEST');
    var record = normalize(input); record.specAccepted = false;
    record.request = clone(request); record.proposedBy = actor.id; record.proposedAt = at;
    return record;
  }
  function acceptSpec(candidate, actor, check, at) {
    authorize(actor,'accept-rm-spec',check); requireValue(timestamp(at),'INVALID_TIME');
    requireValue(candidate.request && candidate.classification === 'accepted' && canonical(candidate.terms) === candidate.version,'INVALID_CANDIDATE');
    var record = clone(candidate); record.specAccepted = true;
    record.specAcceptance = {actorId:actor.id,at:at,materialId:record.materialId,specVersion:record.terms.specVersion};
    return record;
  }
  function refresh(inputs, storage, generationId, at) {
    requireValue(text(generationId) && timestamp(at) && Array.isArray(inputs),'INVALID_GENERATION');
    // All readers consume only current(). Storage must stage and atomically CAS its pointer
    // together with append-only history under a lock. No clear-before-write path exists.
    return storage.withLock(function () {
      var current = storage.current(), expected = current ? current.id : null;
      requireValue(generationId !== expected,'DUPLICATE_GENERATION');
      try {
        var observations = inputs.map(normalize), counts = {input:inputs.length,accepted:0,excluded:0,dq:0};
        observations.forEach(function (o) { counts[o.classification]++; });
        var generation = {id:generationId,at:at,observations:observations,counts:counts};
        var checksum = canonical(generation);
        storage.stage(generation);
        var readback = storage.readStage(generationId);
        requireValue(readback && canonical(readback) === checksum,'STAGING_RECONCILIATION_FAILED');
        requireValue(counts.input === counts.accepted + counts.excluded + counts.dq,'COUNT_RECONCILIATION_FAILED');
        storage.commit(generationId,expected);
        return clone(generation);
      } catch (error) {
        // Failure event excludes source data. Adapter must keep last successful pointer/history.
        storage.failure({generationId:generationId,at:at,status:'FAILED',previousGenerationId:expected});
        throw error;
      }
    });
  }
  return {parsePaired:parsePaired,parseNotes:parseNotes,normalize:normalize,confirm:confirm,eligible:eligible,requestMaterial:requestMaterial,propose:propose,acceptSpec:acceptSpec,refresh:refresh};
}());
