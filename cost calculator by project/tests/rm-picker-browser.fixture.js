(()=>{
 const results=[],check=(name,ok)=>results.push({name,pass:!!ok}),$=id=>document.getElementById(id);
 const query=text=>{$('query').value=text;$('query').dispatchEvent(new Event('input'));};
 const source=value=>{$('source').value=value;$('source').dispatchEvent(new Event('change'));};
 try{
  check('unified view contains four offers and three AVAILABLE lots',$('results').children.length===7);
  check('HOLD lot never rendered',!$('results').textContent.includes('LOT-H')&&!$('results').textContent.includes('99.00'));
  query('Alpha');check('similar specifications remain separate',$('results').children.length===6);
  source('stock');query('DEMO-RM1');check('stock lookup preserves both receipt lots',$('results').children.length===2);
  document.querySelector('[data-pick="S1"]').click();document.querySelector('[data-quantity="0"]').value='12';document.querySelector('[data-quantity="0"]').dispatchEvent(new Event('input'));
  check('stock material aggregates AVAILABLE lots once',$('basket').firstElementChild.textContent.includes('ขาด 2.00 kg'));
  check('stock selection never silently chooses IN pricing',$('basket').firstElementChild.textContent.includes('ฐานราคา: รอยืนยัน'));
  source('rd');query('95%');document.querySelector('[data-pick="R1"]').click();
  check('verified catalog link combines available lots without subtracting reserve',$('basket').firstElementChild.textContent.includes('ขาด 2.00 kg'));
  check('adding an offer onto a stock row says the price base is still unset',$('saveStatus').textContent.includes('ฐานราคายังไม่ถูกตั้ง'));
  query('98%');document.querySelector('[data-pick="R2"]').click();check('similar names do not create stock mapping',$('basket').children[1].textContent.includes('ยังไม่เชื่อมคลัง'));
  query('Beta');document.querySelector('[data-pick="R3"]').click();check('new material stays draft without stock code',$('basket').children[2].textContent.includes('ยังไม่เชื่อมคลัง')&&$('basket').children[2].textContent.includes('รอยืนยัน'));

  check('continuous selection retains distinct formula rows',$('basket').children.length===3);
  source('stock');query('DEMO-RM1');document.querySelector('[data-pick="S2"]').click();
  check('another lot never adds a formula line',$('basket').children.length===3);
  const qty=document.querySelector('[data-quantity="0"]');qty.value='12';qty.dispatchEvent(new Event('input'));
  check('basket quantity compares total stock once',$('basket').firstElementChild.textContent.includes('ขาด 2.00 kg'));
  $('saveAll').click();const saved=$('revisions').textContent;
  const choose=$('basket').firstElementChild.querySelector('select');choose.value='R1-B';document.querySelector('[data-replace="0"]').click();
  check('explicit offer change preserves per-line quantity',document.querySelector('[data-quantity="0"]').value==='12'&&$('basket').firstElementChild.textContent.includes('ฐานราคา R1-B'));
  document.querySelector('[data-remove="1"]').click();
  check('removal retains other lines',$('basket').children.length===2&&$('basket').textContent.includes('Beta'));
  check('saved revision is unchanged by draft edits',$('revisions').textContent===saved);
  $('saveAll').click();check('entire draft saves as next revision',$('revisions').children.length===2&&$('saveStatus').textContent.includes('2 รายการ'));
  // ข้อเสนอของสารเดียวกันที่ยังไม่ผูกคลัง ต้องไม่แตกแถวและต้องไม่เปลี่ยนฐานราคาเอง (พบ 2026-09-09)
  const rowsBefore=$('basket').children.length,revisionsBefore=$('revisions').children.length;
  source('rd');query('95%');document.querySelector('[data-pick="R1-OLD"]').click();
  check('unlinked offer of the same material never adds a second row',$('basket').children.length===rowsBefore);
  check('same material keeps the existing price base and says so',$('basket').firstElementChild.textContent.includes('ฐานราคา R1-B')&&$('saveStatus').textContent.includes('ไม่ถูกเปลี่ยนเอง'));
  check('unlinked offer of the same material is offered as a price base',[...$('basket').firstElementChild.querySelectorAll('option')].some(o=>o.value==='R1-OLD'));
  check('adding an offer never writes a revision',$('revisions').children.length===revisionsBefore);
 }catch(e){check('unexpected exception '+e.message,false);}
 const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
 const pre=document.createElement('pre');pre.id='rm-results';pre.textContent=JSON.stringify(report);document.body.append(pre);document.documentElement.dataset.rmTest=report.failed?'failed':'passed';
})();
