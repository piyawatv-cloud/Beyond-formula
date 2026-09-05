'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),out=path.join(root,'.runtime');fs.mkdirSync(out,{recursive:true});
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const originals=[...html.matchAll(/let SB_(?:URL|KEY) = '([^']*)';/g)].map(m=>m[1]);
html=html.replace(/let SB_URL = '[^']*';/,"let SB_URL = '';").replace(/let SB_KEY = '[^']*';/,"let SB_KEY = '';").replace(/<script[^>]+src=[^>]+><\/script>/g,'').replace(/<link[^>]+href="https:[^>]+>/g,'');
html=html.replace(/<script>\s*\/\/ ===================================================================/,'<script>window.__FS_TEST__=true;window.fetch=async()=>{throw Error("Test network blocked")};</script>\n<script>\n// ===================================================================');
html=html.replace('</body>','<script>'+fs.readFileSync(path.join(__dirname,'cost-calculator-browser.fixture.js'),'utf8')+'</script></body>');
if(originals.some(v=>v&&html.includes(v)))throw Error('Configuration scrub failed');
const file=path.join(out,'cost-calculator-demo.html');fs.writeFileSync(file,html);
const profile=fs.mkdtempSync(path.join(out,'chrome-cost-'));
try{
 const r=spawnSync(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--no-first-run','--no-default-browser-check','--headless=new','--disable-gpu','--disable-background-networking','--no-sandbox','--user-data-dir='+profile,'--virtual-time-budget=5000','--window-size=1440,1500','--screenshot='+path.join(out,'cost-calculator-ui.png'),'--dump-dom','file://'+file],{encoding:'utf8',timeout:25000,maxBuffer:32*1024*1024});
 const m=(r.stdout||'').match(/<pre id="cost-browser-results"[^>]*>([\s\S]*?)<\/pre>/);console.log(m?m[1].replaceAll('&quot;','"').replaceAll('&amp;','&'):r.stderr);
 if(r.status!==0||!/<html[^>]*data-cost-test-status="passed"/.test(r.stdout||''))process.exitCode=1;
}finally{fs.rmSync(profile,{recursive:true,force:true});}
