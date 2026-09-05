#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const sourcePath = path.join(root, 'index.html');
const testPath = path.join(root, 'test.html');
const browser = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let html = fs.readFileSync(sourcePath, 'utf8');
const originalUrl = (html.match(/let SB_URL = '([^']*)';/) || [,''])[1];
const originalKey = (html.match(/let SB_KEY = '([^']*)';/) || [,''])[1];
html = html
  .replace(/let SB_URL = '[^']*';/, "let SB_URL = 'https://test-project.supabase.co';")
  .replace(/let SB_KEY = '[^']*';/, "let SB_KEY = 'sb_publishable_test_only';")
  .replace(/<script[^>]+src=[^>]+><\/script>/g,'')
  .replace(/<link[^>]+href="https:[^>]+>/g,'');

const mockPrelude = `<script>
window.__FS_TEST__ = true;
window.__fetchCalls = [];
window.__fetchQueue = [];
window.__mockResponse = function(status, body){
  const text = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return {ok:status >= 200 && status < 300,status:status,text:async()=>text,json:async()=>text?JSON.parse(text):null};
};
window.fetch = async function(url, options){
  const call = {url:String(url),options:options||{}};
  window.__fetchCalls.push(call);
  const next = window.__fetchQueue.shift();
  if(typeof next === 'function') return next(call);
  if(next) return next;
  return window.__mockResponse(200, []);
};
</script>`;

html = html.replace(/<script>\s*\/\/ ===================================================================/, mockPrelude + '\n<script>\n// ===================================================================');
html = html.replace('</body>', '<script src="tests/formula-studio.test.js"></script>\n</body>');

if(!html.includes('window.__FS_TEST__ = true') || !html.includes('tests/formula-studio.test.js')){
  throw new Error('Could not inject the deterministic browser harness');
}
if((originalUrl && html.includes(originalUrl)) || (originalKey && html.includes(originalKey))){
  throw new Error('The generated harness still contains production configuration');
}

fs.writeFileSync(testPath, html);

fs.mkdirSync(path.join(root,'.runtime'),{recursive:true});
const profile=fs.mkdtempSync(path.join(root,'.runtime','chrome-parent-'));

// Poll the test's completion marker in real time: virtual time can stall on
// the application's recurring sync timers. Assertions remain in the fixture.
const child=spawn(browser,[
  '--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',
  '--headless=new','--disable-gpu','--no-sandbox',
  '--disable-background-networking','--remote-debugging-port=0','about:blank'
],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 let ws;
 const deadline=Date.now()+30000;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');
  while(!fs.existsSync(portFile)&&Date.now()<deadline)await sleep(100);
  if(!fs.existsSync(portFile))throw Error('Browser did not start within timeout');
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent('file://'+testPath),{method:'PUT',signal:AbortSignal.timeout(5000)})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Browser connection timed out')),5000);
   ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
   ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Browser connection failed'));},{once:true});
  });
  let id=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{
   const response=JSON.parse(event.data);
   if(response.id)pending.get(response.id)?.(response);
  });
  const evaluate=()=>new Promise((resolve,reject)=>{
   const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Browser evaluation timed out'));},5000);
   pending.set(key,response=>{clearTimeout(timer);pending.delete(key);resolve(response);});
   ws.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{
    expression:'JSON.stringify({status:document.documentElement.dataset.testStatus,report:document.getElementById("fs-test-results")?.textContent})',returnByValue:true
   }}));
  });
  while(Date.now()<deadline){
   const response=await evaluate();
   const value=response.result?.result?.value;
   const state=value?JSON.parse(value):{};
   if(state.report){
    const report=JSON.parse(state.report);
    console.log(JSON.stringify(report,null,2));
    if(state.status!=='passed'||report.failed!==0)process.exitCode=1;
    return;
   }
   await sleep(100);
  }
  throw Error('Browser test did not finish within 30 seconds');
 }finally{
  ws?.close();
  const exited=new Promise(resolve=>child.once('exit',resolve));
  child.kill('SIGTERM');
  await Promise.race([exited,sleep(2000)]);
  if(child.exitCode===null)child.kill('SIGKILL');
  fs.rmSync(profile,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
