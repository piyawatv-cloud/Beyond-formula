import {source} from './job-sync-client.mjs';

// Full approved generator, with synthetic DOM/input helpers. The generator's
// create/edit, save, lastDash and form-clear sequence is not copied into a mock.
export const form=`
let selectedConcepts=[],CONCEPT_KB={};window.allocated=0;window.cleared=0;
window.fields={};window.enableObservations=[];window.disabledState=true;
var priorDomGet=document.getElementById;
['customer','brand','market','country','form','size','size_unit','unit_weight','uw_unit','sales_owner','phone','category','subcategory','priority','fda_type','color','scent','flavor','pack_type','width','length','concept_custom','target','gender','price','notes'].forEach(function(name){
  window.fields['f_'+name]={value:name==='customer'?'Synthetic customer':name==='notes'?'Unsaved synthetic notes':'',textContent:'',style:{},setAttribute(){},classList:{remove(){},add(){}}};
});
window.fields.gen_err={textContent:'กำลังเตรียมระบบบันทึกใบงาน',setAttribute(name,value){this[name]=value;}};
window.fields.btnCreate={textContent:'สร้างชุดข้อมูล',style:{},setAttribute(name){if(name==='disabled')this.disabled=true;},removeAttribute(name){if(name==='disabled')this.disabled=false;}};
Object.defineProperty(window.fields.btnCreate,'disabled',{get(){return window.disabledState;},set(value){
  window.disabledState=!!value;
  if(!value)window.enableObservations.push({ready:!!(window.__fsJobSync&&window.__fsJobSync.ready),saveWrapped:saveRecordsStore!==window.beforeSave,pushWrapped:sbPush!==window.beforePush,generateWrapped:generateDash!==window.beforeGenerate});
}});
document.getElementById=function(id){return window.fields[id]||priorDomGet(id);};
function getRows(){return [{name:'Synthetic ingredient',w:1}];}
function getTagValues(){return [];}function marketText(){return '';}
function fmtSize(){return '';}function fmtUW(){return '';}
function nextRecordId(){window.allocated++;return 'A'+String(9000+window.allocated).padStart(5,'0');}
function hideEditingBanner(){}function showEditingBanner(id){window.bannerId=id;}
function renderDashboard(){}function renderRecordsList(){}
function clearCustomerForm(){window.cleared++;Object.keys(window.fields).filter(key=>key.indexOf('f_')===0).forEach(key=>window.fields[key].value='');}
function logAct(){}
${source('saveRecord')}
${source('generateDash')}
window.beforeSave=saveRecordsStore;window.beforePush=sbPush;window.beforeGenerate=generateDash;
`;
