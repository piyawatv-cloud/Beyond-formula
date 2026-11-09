/* Testable client contract for the existing Formula Runtime save gateway.
 * No credentials, network configuration, role decisions, or persistence live here.
 * Used by the offline preview simulator; not connected to a real gateway.
 */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormulaRuntimeJobSave = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const clone = value => JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw Error('พบตัวเลขที่ไม่ถูกต้อง กรุณาตรวจข้อมูลก่อนบันทึก');
    return item;
  }));
  const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (recordObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  // Temporary safety stop: the shared legacy concept/claim derivation is not integrated.
  function guardConceptChange(baseline, data) {
    if (baseline && ['allConcepts','allSP'].some(k=>Object.hasOwn(baseline,k)) && canonical(baseline.conceptStr)!==canonical(data.conceptStr))
      throw Error('ยังแก้คอนเซปของงานที่มีข้อมูลประกอบผ่านตัวอย่างนี้ไม่ได้ กรุณาตรวจในระบบเดิม');
  }
  function prepareSave({id, baseline, changes}) {
    if (!/^[A-Z]+[0-9]{5}$/.test(String(id))) throw Error('รหัสงานไม่ถูกต้อง');
    if (baseline === undefined || (baseline !== null && !recordObject(baseline))) throw Error('ต้องมีข้อมูลตั้งต้นที่ยืนยันแล้ว');
    if (!recordObject(changes)) throw Error('ข้อมูลแก้ไขไม่ถูกต้อง');
    if (Object.hasOwn(changes,'id')) throw Error('ห้ามเปลี่ยนรหัสงาน');
    if (baseline !== null && baseline.id !== id) throw Error('รหัสงานไม่ตรงกับข้อมูลตั้งต้น');
    if (baseline !== null && ['createdBy','ownerEmail'].some(k => Object.hasOwn(changes,k))) throw Error('ห้ามเปลี่ยนผู้สร้างหรือเจ้าของผ่านฟอร์มนี้');
    const expected = baseline === null ? null : clone(baseline);
    const data = {...(expected || {}), ...clone(changes), id};
    guardConceptChange(expected, data);
    if (!Array.isArray(data.rows) || ![data.customer,data.brand].some(v=>typeof v==='string' && v.trim())) throw Error('ข้อมูลลูกค้าหรือแบรนด์และรายการสารไม่ครบ');
    return {p_id:id,p_data:data,p_expected:expected};
  }
  async function submitSave(request, send, isCurrent) {
    if (!recordObject(request) || typeof send !== 'function') throw Error('คำขอบันทึกไม่ถูกต้อง');
    if (typeof isCurrent!=='function') throw Error('ต้องตรวจรุ่นเซสชันก่อนบันทึก');
    if (!Object.hasOwn(request,'p_expected') || (request.p_expected !== null && !recordObject(request.p_expected))) throw Error('ต้องมีข้อมูลตั้งต้นที่ยืนยันแล้ว');
    if (Object.keys(request).some(k=>!['p_id','p_data','p_expected'].includes(k)) || !recordObject(request.p_data) || !/^[A-Z]+[0-9]{5}$/.test(String(request.p_id)) || request.p_data.id!==request.p_id || (request.p_expected!==null && request.p_expected.id!==request.p_id)) throw Error('รหัสหรือข้อมูลบันทึกไม่ถูกต้อง');
    if (!Array.isArray(request.p_data.rows) || ![request.p_data.customer,request.p_data.brand].some(v=>typeof v==='string' && v.trim())) throw Error('ข้อมูลลูกค้าหรือแบรนด์และรายการสารไม่ครบ');
    if (request.p_expected!==null && ['createdBy','ownerEmail'].some(k=>canonical(request.p_expected[k])!==canonical(request.p_data[k]))) throw Error('ห้ามเปลี่ยนผู้สร้างหรือเจ้าของผ่านฟอร์มนี้');
    guardConceptChange(request.p_expected, request.p_data);
    const sent = clone(request);
    const current=()=>{try{return isCurrent()===true}catch{return false}};
    if(!current())return {status:'session-changed'};
    try {
      const result = await send('rpc/fs_save_record',clone(sent));
      if(!current())return {status:'session-changed-unconfirmed'};
      if (!recordObject(result) || (Object.hasOwn(result,'id') && result.id !== sent.p_id)) return {status:'unconfirmed'};
      if (result.status === 'saved') return result.id === sent.p_id && recordObject(result.data) && canonical(result.data) === canonical(sent.p_data)
        ? {status:'saved',data:clone(result.data)} : {status:'unconfirmed'};
      if (result.status === 'queued') return {status:result.id === sent.p_id ? 'queued' : 'unconfirmed'};
      if (['conflict','forbidden','invalid','retry'].includes(result.status)) return {status:result.status};
      return {status:'unconfirmed'};
    } catch { return current()?{status:'unconfirmed'}:{status:'session-changed-unconfirmed'}; }
  }
  // Read-only acknowledgement for a queued or uncertain save. A different
  // current row is not proof of failure: it may be pending or changed later.
  // isCurrent must compare a captured session generation, not only a username;
  // callers must invalidate it on logout, role change or any session switch.
  async function reconcileSave(request, read, isCurrent) {
    if (!recordObject(request) || !Object.hasOwn(request,'p_expected') || (request.p_expected!==null && (!recordObject(request.p_expected) || request.p_expected.id!==request.p_id)) || !recordObject(request.p_data) || !/^[A-Z]+[0-9]{5}$/.test(String(request.p_id)) || request.p_data.id!==request.p_id || typeof read!=='function' || typeof isCurrent!=='function') throw Error('ข้อมูลติดตามการบันทึกไม่ครบ');
    const sent=clone(request);
    const current=()=>{try{return isCurrent()===true}catch{return false}};
    if(!current())return {status:'session-changed'};
    try {
      const rows=await read('fs_records?select=id,data&id=eq.'+encodeURIComponent(sent.p_id));
      if(!current())return {status:'session-changed'};
      if(!Array.isArray(rows)||rows.length>1)return {status:'unconfirmed'};
      if(rows.length===0)return {status:'pending'};
      const row=rows[0];if(!recordObject(row)||row.id!==sent.p_id||!recordObject(row.data)||row.data.id!==sent.p_id)return {status:'unconfirmed'};
      return canonical(row.data)===canonical(sent.p_data)?{status:'record-confirmed',data:clone(row.data)}:{status:'pending'};
    }catch {return current()?{status:'unconfirmed'}:{status:'session-changed'}}
  }
  return {prepareSave,submitSave,reconcileSave};
});
