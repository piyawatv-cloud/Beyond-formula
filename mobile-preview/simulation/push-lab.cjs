'use strict';
// Deterministic test double. No network, real accounts, real device tokens, or persistence.
function createLab(deliverToTestWorker){
  if(typeof deliverToTestWorker!=='function') throw new TypeError('test worker required');
  const devices=new Map(), delivered=new Set(), inFlight=new Set();
  function register(device){
    if(!device?.id||!device.user||!Array.isArray(device.allowedJobs))throw new TypeError('invalid fixture device');
    devices.set(device.id,{id:device.id,user:device.user,allowedJobs:new Set(device.allowedJobs)});
  }
  function revoke(id){devices.delete(id)}
  async function deliver(event){
    if(!event?.id||!event.jobId||!event.actor||!['chat','update'].includes(event.kind))throw new TypeError('invalid fixture event');
    let result={delivered:0,failed:0};
    for(const device of devices.values()){
      const key=JSON.stringify([event.id,device.id]);
      if(device.user===event.actor||!device.allowedJobs.has(event.jobId)||delivered.has(key)||inFlight.has(key))continue;
      inFlight.add(key);
      try{await deliverToTestWorker({kind:event.kind},device.id);delivered.add(key);result.delivered++}catch{result.failed++}finally{inFlight.delete(key)}
    }
    return result;
  }
  return {register,revoke,deliver};
}
module.exports={createLab};
