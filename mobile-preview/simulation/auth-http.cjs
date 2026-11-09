'use strict';
// Local-only test service with synthetic identities. Never use for production authentication.
const http=require('node:http'),crypto=require('node:crypto');
const {createDurableLab}=require('./durable-lab.cjs');
function createTestAuthService({dbPath,transport}){
 const lab=createDurableLab(dbPath),signingKey=crypto.randomBytes(32),salt=crypto.randomBytes(16),sessions=new Set();
 const users=new Map(['sales','pd'].map(role=>[role,{role,active:true,hash:crypto.pbkdf2Sync('fixture-'+role,salt,10000,32,'sha256')}]));
 for(const role of ['pd','sales']){const id=role+'-fixture',saved=lab.fixtureDevice(id);if(saved){if(saved.role!==role)throw Error('fixture role mismatch');users.get(role).active=!!saved.active}else lab.register({id,user:role})}
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const signature=x=>crypto.createHmac('sha256',signingKey).update(x).digest('base64url');
 function issue(user){let id=crypto.randomBytes(24).toString('hex');sessions.add(id);let body=encode({sub:user,jti:id,exp:Math.floor(Date.now()/1000)+60});return body+'.'+signature(body)}
 function verify(header){
  if(!header?.startsWith('Bearer '))return null;let token=header.slice(7),parts=token.split('.');if(parts.length!==2)return null;
  let expected=Buffer.from(signature(parts[0])),actual=Buffer.from(parts[1]);if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))return null;
  try{let claim=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')),user=users.get(claim.sub);if(!user?.active||!sessions.has(claim.jti)||!Number.isFinite(claim.exp)||claim.exp<=Date.now()/1000)return null;return {role:user.role,jti:claim.jti}}catch{return null}
 }
 let server=http.createServer(async(req,res)=>{
  const out=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
  if(req.method!=='POST')return out(404,{error:'not found'});
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)return out(413,{error:'too large'})}
  let body;try{body=JSON.parse(raw)}catch{return out(400,{error:'invalid'})}
  if(req.url==='/login'){
   const user=users.get(body.user);if(!user||typeof body.password!=='string'||!user.active)return out(401,{error:'denied'});
   let hash=crypto.pbkdf2Sync(body.password,salt,10000,32,'sha256');if(!crypto.timingSafeEqual(hash,user.hash))return out(401,{error:'denied'});
   return out(200,{token:issue(body.user)});
  }
  const identity=verify(req.headers.authorization);if(!identity)return out(401,{error:'denied'});
  if(req.url==='/logout'){sessions.delete(identity.jti);return out(200,{ok:true})}
  if(req.url==='/event'){
   try{const result=lab.submit({id:body.id,actor:identity.role,jobId:body.jobId,kind:body.kind,text:body.text});const delivered=await lab.dispatch(transport);return out(200,{...result,...delivered})}catch{return out(403,{error:'denied'})}
  }
  return out(404,{error:'not found'});
 });
 function setActive(role,active){const u=users.get(role);if(!u)throw Error('fixture identity missing');u.active=active;if(!active)lab.revoke(role+'-fixture');else lab.register({id:role+'-fixture',user:role})}
 return {listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port))}),setActive,close:()=>new Promise(resolve=>server.close(()=>{lab.close();resolve()}))};
}
module.exports={createTestAuthService};
