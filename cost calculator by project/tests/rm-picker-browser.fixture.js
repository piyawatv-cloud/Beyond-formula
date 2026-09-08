(()=>{
 const results=[],check=(name,ok)=>results.push({name,pass:!!ok}),$=id=>document.getElementById(id);
 const query=text=>{$('query').value=text;$('query').dispatchEvent(new Event('input'));};
 const source=value=>{$('source').value=value;$('source').dispatchEvent(new Event('change'));};
 try{
  check('unified view contains three offers and three AVAILABLE lots',$('results').children.length===6);
  check('HOLD lot never rendered',!$('results').textContent.includes('LOT-H')&&!$('results').textContent.includes('99.00'));
  query('Alpha');check('similar specifications remain separate',$('results').children.length===5);
  source('stock');query('DEMO-RM1');check('stock lookup preserves both receipt lots',$('results').children.length===2);
  document.querySelector('[data-pick="S1"]').click();$('demand').value='12';$('demand').dispatchEvent(new Event('input'));
  check('selected stock lot compares its own quantity',$('comparison').textContent.includes('ขาด 4.00 kg'));
  check('stock selection never silently chooses IN pricing',$('price').textContent.includes('รอยืนยัน'));
  source('rd');query('95%');document.querySelector('[data-pick="R1"]').click();
  check('verified catalog link combines available lots without subtracting reserve',$('comparison').textContent.includes('ขาด 2.00 kg'));
  query('98%');document.querySelector('[data-pick="R2"]').click();check('similar names do not create stock mapping',$('comparison').textContent.includes('รอคู่รายการคลัง'));
  query('Beta');document.querySelector('[data-pick="R3"]').click();$('keep').click();check('new material stays draft without stock code',$('draft').textContent.includes('เก็บตัวเลือกในร่างทดลองแล้ว')&&$('price').textContent.includes('รอรับรอง'));
 }catch(e){check('unexpected exception '+e.message,false);}
 const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
 const pre=document.createElement('pre');pre.id='rm-results';pre.textContent=JSON.stringify(report);document.body.append(pre);document.documentElement.dataset.rmTest=report.failed?'failed':'passed';
})();
