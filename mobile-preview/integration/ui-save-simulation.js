/* In-memory scenarios for the offline demo; no real gateway, queue or identity. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./runtime-job-save.js'));
  else root.FormulaSaveSimulation = factory(root.FormulaRuntimeJobSave);
})(typeof globalThis === 'object' ? globalThis : this, function (client) {
  async function run(scenario, request) {
    if (!['saved','queued','conflict','forbidden','invalid','retry','unconfirmed'].includes(scenario)) throw Error('สถานการณ์จำลองไม่ถูกต้อง');
    return client.submitSave(request, async (_route,body) => {
      if(scenario==='unconfirmed') throw Error('จำลองการติดต่อไม่สำเร็จ');
      if(scenario==='saved') return {status:'saved',id:body.p_id,data:body.p_data};
      return {status:scenario,id:body.p_id};
    },()=>true);
  }
  async function simulateSave(scenario, baseline, changes) {
    return run(scenario,client.prepareSave({id:baseline.id,baseline,changes}));
  }
  async function simulateCreate(scenario, id, data) {
    return run(scenario,client.prepareSave({id,baseline:null,changes:data}));
  }
  return {simulateSave,simulateCreate};
});
