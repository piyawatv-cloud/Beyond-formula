'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),runtime=path.join(root,'.runtime');
fs.mkdirSync(runtime,{recursive:true});const dir=fs.mkdtempSync(path.join(runtime,'rm-picker-'));
try{
 const src=path.join(__dirname,'../docs/prototypes');
 fs.copyFileSync(path.join(src,'rm-picker.js'),path.join(dir,'rm-picker.js'));
 fs.copyFileSync(path.join(__dirname,'../tests/rm-picker-browser.fixture.js'),path.join(dir,'fixture.js'));
 fs.writeFileSync(path.join(dir,'index.html'),fs.readFileSync(path.join(src,'rm-selection.html'),'utf8').replace('</body>','<script src="fixture.js"></script></body>'));
 const r=spawnSync(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--disable-background-networking','--user-data-dir='+path.join(dir,'profile'),'--virtual-time-budget=2000','--dump-dom','file://'+path.join(dir,'index.html')],{encoding:'utf8',timeout:25000,maxBuffer:8*1024*1024});
 const match=(r.stdout||'').match(/<pre id="rm-results">([\s\S]*?)<\/pre>/);console.log(match?match[1]:r.stderr);
 if(r.status!==0||!/<html[^>]*data-rm-test="passed"/.test(r.stdout||''))process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true});}
