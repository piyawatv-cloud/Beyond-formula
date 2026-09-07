'use strict';
// A2 mutation checks: the child intercepts source reads in memory only. It never
// rewrites index.html, Apps Script files, fixtures, Git state or an external path.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
const runner=String.raw`
const fs=require('node:fs'),path=require('node:path');
const spec=JSON.parse(process.argv[1]),read=fs.readFileSync;
let replacements=0;
fs.readFileSync=function(file,options){
  const result=read.apply(this,arguments);
  if(path.resolve(String(file))!==spec.source || !spec.mutate)return result;
  const source=String(result);
  if(source.split(spec.before).length!==2)throw Error('MUTATION_TARGET_NOT_UNIQUE');
  replacements++;
  const changed=source.replace(spec.before,spec.after);
  return typeof result==='string'?changed:Buffer.from(changed);
};
process.on('exit',()=>{if(spec.mutate && !replacements){process.stderr.write('MUTATION_NOT_EXERCISED');process.exitCode=2;}});
require(spec.testFile);
`;
const cases=[
  {name:'effective-from',testFile:'tests/cost-calculator-core.test.js',pattern:'A2 effective-from dates',source:'index.html',before:'(from == null || (dateOK(from) && from <= asOf))',after:'true'},
  {name:'catalog price denominator',testFile:'tests/cost-calculator-local.test.js',pattern:'A2 catalog denominator validity',source:'index.html',before:"if(offer.priceBasisQuantity===null||offer.priceBasisQuantity<=0)bad.push('priceBasisQuantity');",after:'/* removed denominator validation */'},
  {name:'two-digit comma',testFile:'cost calculator by project/tests/rm-source-map.test.js',pattern:'A2 two digits after',source:'cost calculator by project/apps_script/RmSourceMap.gs',before:String.raw`/(\d),(\d{3})(?!\d)/g`,after:String.raw`/(\d),(\d{2,3})(?!\d)/g`},
  {name:'formula tolerance',testFile:'tests/cost-calculator-core.test.js',pattern:'A2 formula tolerance',source:'index.html',before:'fillKg*1e-9',after:'fillKg*1e-1'},
  {name:'non-RD summary permission',testFile:'tests/cost-calculator-local.test.js',pattern:'A2 non-RD direct summary',source:'index.html',before:'sendSummary:rd,approveCEO:false',after:'sendSummary:true,approveCEO:false'},
  // E1-02 (2026-09-07): Sales/OPC/Finance/CEO ต้องเปิดเครื่องคำนวณไม่ได้ ถ้าประตูนี้หลุด ต้นทุนดิบรั่วทันที
  {name:'open gate lets every business role in',testFile:'tests/cost-calculator-local.test.js',pattern:'A2 open gate',source:'index.html',before:"return {open:admin||roles.some(function(r){return COST_OPEN_ROLES.indexOf(r)>=0;}),",after:'return {open:admin||roles.length>0,'}
];
for(const item of cases)test('A2 mutation killed: '+item.name,()=>{
  const spec={...item,source:path.join(root,item.source),testFile:path.join(root,item.testFile)};
  const execute=mutate=>spawnSync(process.execPath,['--test-reporter=tap','--test-name-pattern='+item.pattern,'-e',runner,JSON.stringify({...spec,mutate})],{cwd:root,env:childEnv,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  const baseline=execute(false);
  assert.equal(baseline.error,undefined);
  assert.equal(baseline.status,0,'unmodified regression must pass: '+baseline.stdout+baseline.stderr);
  assert.match(baseline.stdout,/# pass 1\b/,'target regression must actually run');
  const mutant=execute(true);
  assert.equal(mutant.error,undefined);
  assert.equal(mutant.status,1,'mutant must fail an assertion, not crash or time out: '+mutant.stdout+mutant.stderr);
  assert.match(mutant.stdout,/not ok \d+ - A2 /);
  assert.match(mutant.stdout,/failureType: 'testCodeFailure'/);
  assert.doesNotMatch(mutant.stdout+mutant.stderr,/MUTATION_TARGET_NOT_UNIQUE|MUTATION_NOT_EXERCISED|SyntaxError/);
});
