// Compare sealed-page copy and the current gateway using synthetic identities.
const copyVm=await import('node:vm');
function runOriginalCopy(src,newId,actor){
 const html=String(readFileSyncForCopy());
 const start=html.indexOf('function copyRecordToNewId(id){');const end=html.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'sealed copy function not found');
 const context={records:[structuredClone(src)],recTouched:{},currentUser:actor,requirePerm:()=>true,confirm:()=>true,nextRecordId:()=>newId,saveRecord:x=>{context.output=structuredClone(x)},logAct(){},sbQueue(){},renderRecordsList(){},alert(){},openRecordPopup(){}};
 copyVm.runInNewContext(html.slice(start,end+2),context);context.copyRecordToNewId(src.id);
 return context.output;
}
function readFileSyncForCopy(){return readFileSyncForCopy.bytes}
readFileSyncForCopy.bytes=await readFile(new URL('releases/cf7ab7813cbe/index.html',root),'utf8');
function syntheticCopyCookie(name,role,userId,email){
 const payload=Buffer.from(JSON.stringify({name,role,centralUserId:userId,email,exp:Date.now()+60000})).toString('base64url');
 return `fs_session=${payload}.${createHmac('sha256',sessionSecret).update(payload).digest('base64url')}`;
}
async function syntheticCopySave(data,session){
 const r=await fetch(`${gatewayRest()}/rpc/fs_save_record`,{method:'POST',headers:{'content-type':'application/json',cookie:session},body:JSON.stringify({p_id:data.id,p_data:data,p_expected:null})});
 return {status:r.status,data:await r.json()};
}
test('synthetic copy e2e: original owner copy preserves source ownership and creates separate open record',async()=>{
 const source=job('A08320',{createdBy:'Synthetic actor',ownerEmail:'owner@example.test',rows:[{name:'Synthetic',w:20}],closed:{by:'Synthetic actor'}});
 const copy=runOriginalCopy(source,'A08321','Synthetic actor');
 assert.equal(copy.createdBy,source.createdBy);assert.equal(copy.ownerEmail,source.ownerEmail);assert.equal(copy.closed,undefined);assert.deepEqual(copy.rows,source.rows);
 const result=await syntheticCopySave(copy,syntheticCopyCookie('Synthetic actor','sales','synthetic-actor','owner@example.test'));
 assert.equal(result.data.status,'saved');assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08321';")),copy);assert.deepEqual(source.closed,{by:'Synthetic actor'});
});
test('synthetic copy e2e: copy by another user depends on role and retained owner',async()=>{
 const source=job('A08322',{createdBy:'Synthetic actor',ownerEmail:'owner@example.test',rows:[]});
 const mkt=runOriginalCopy(source,'A08323','Synthetic Other');
 const refused=await syntheticCopySave(mkt,syntheticCopyCookie('Synthetic Other','mkt','synthetic-other','other@example.test'));
 assert.equal(refused.data.status,'forbidden');assert.equal(sql("select count(*) from fs_records where id='A08323';"),'0');
 const admin=runOriginalCopy(source,'A08324','Synthetic Other');
 const accepted=await syntheticCopySave(admin,syntheticCopyCookie('Synthetic Other','admin','synthetic-other','other@example.test'));
 assert.equal(accepted.data.status,'saved');const stored=JSON.parse(sql("select data from fs_records where id='A08324';"));assert.equal(stored.ownerEmail,'owner@example.test');assert.equal(stored.createdBy,'Synthetic actor');
});
