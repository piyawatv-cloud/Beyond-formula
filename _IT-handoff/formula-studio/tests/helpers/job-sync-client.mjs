import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const release = readFileSync(new URL('releases/CURRENT',root),'utf8').trim();
const html = readFileSync(process.env.FORMULA_JOB_SYNC_TEST_HTML || new URL(`releases/${release}/index.html`,root),'utf8');
export const sealedHtml = html;
export const asset = readFileSync(new URL('runtime/assets/fs-job-sync.js',root),'utf8');
export function source(name) {
  const re = new RegExp(`(?:async )?function ${name}\\([^\\n]*`);
  const found = re.exec(html);
  assert.ok(found, `sealed application anchor ${name}`);
  const line = found[0];
  if (line.endsWith('}')) return line;
  const end = html.indexOf('\n}',found.index);
  assert.ok(end > found.index, `sealed function body ${name}`);
  return html.slice(found.index,end+2);
}
const functions = ['stableStr','bakRecord','saveRecBak','trackRecordVersions','saveRecordsStore','recDirty','sbApply','sbApplyFull','sbApplyDelta','sbPush','sbUpsert','sbDelete','msgUid','chatMeta','chatPayload','createChat','openChatRoom','sendChatMsg'];
export const job = (id='A03430',brand='Synthetic') => ({id,brand,customer:'Dummy',createdBy:'sales',createdAt:1,rows:[]});

// The runtime talks to browser IndexedDB directly.  Keep this harness small,
// deterministic, and deliberately close to the asynchronous request lifecycle:
// source code must wait for a successful put and a byte-for-byte get before it
// can issue a central request.  `idb` is shareable across harnesses to model a
// browser reopen or an account change without ever touching host storage.
function indexedDbHarness(state, operations, timeline, failure, {delay=[],readOverride}={}) {
  // `operations` is the fallback-journal audit the quota tests assert on; the
  // chat read-state mirror (fs_chat_seen_v1) is a separate database and is
  // kept out of it. Both still appear in `timeline`.
  const note = operation => { if (operation.database !== 'fs_chat_seen_v1' && operation.database !== 'fs_job_recbak_v1') operations.push(operation); timeline.push(operation); };
  const later = callback => Promise.resolve().then(callback);
  const delayed=[], delayedTypes=new Set(delay);
  const schedule = (type, callback) => {
    if (delayedTypes.has(type)) { delayed.push({type,callback}); return; }
    later(callback);
  };
  const problem = (phase, fallback) => {
    const configured = failure === true ? true : failure && failure[phase];
    if (!configured) return null;
    const error = new Error(typeof configured === 'string' ? configured : fallback);
    error.name = /quota/i.test(error.message) ? 'QuotaExceededError' : 'UnknownError';
    return error;
  };
  const clone = value => structuredClone(value);
  const keyFor = (store, value, supplied) => {
    if (supplied !== undefined) return supplied;
    if (Array.isArray(store.keyPath)) return store.keyPath.map(key => value && value[key]).join('|');
    return store.keyPath ? value && value[store.keyPath] : value && value.id;
  };
  const complete = tx => {
    if (tx.finished || tx.pending || tx.completionQueued) return;
    tx.completionQueued = true;
    later(() => {
      tx.completionQueued = false;
      if (tx.finished || tx.pending) return;
      tx.finished = true;
      note({type:'idb-transaction-complete',database:tx.database,stores:tx.stores.slice(),mode:tx.mode});
      if (typeof tx.oncomplete === 'function') tx.oncomplete({target:tx});
    });
  };
  const read = (type, value, meta) => typeof readOverride === 'function'
    ? readOverride({type,value:clone(value),...meta}) : value;
  const request = (tx, type, run) => {
    const result = {onsuccess:null,onerror:null,result:undefined,error:null};
    tx.pending++;
    schedule(type,() => {
      try {
        result.result = run();
        if (typeof result.onsuccess === 'function') result.onsuccess({target:result});
      } catch (error) {
        result.error = error;
        if (typeof result.onerror === 'function') result.onerror({target:result,preventDefault(){}});
        if (typeof tx.onerror === 'function') tx.onerror({target:tx,preventDefault(){}});
      } finally {
        tx.pending--;
        complete(tx);
      }
    });
    return result;
  };
  const database = raw => ({
    get objectStoreNames() {
      return {contains:name => raw.stores.has(name), length:raw.stores.size, item:index => Array.from(raw.stores.keys())[index] || null};
    },
    createObjectStore(name, options={}) {
      if (raw.stores.has(name)) throw new Error('ConstraintError');
      raw.stores.set(name,{keyPath:options.keyPath || null,values:new Map()});
      return raw.stores.get(name);
    },
    transaction(names, mode='readonly') {
      const list = Array.isArray(names) ? names : [names];
      const tx = {database:raw.name,stores:list.slice(),mode,pending:0,finished:false,completionQueued:false,oncomplete:null,onerror:null,onabort:null,
        abort(){ this.finished=true; if (typeof this.onabort === 'function') this.onabort({target:this}); },
        objectStore(name) {
          if (!list.includes(name) || !raw.stores.has(name)) throw new Error('NotFoundError');
          const store = raw.stores.get(name);
          return {
            get(key) { return request(tx,'get',() => { note({type:'idb-get',database:raw.name,store:name,key}); return read('get',store.values.has(key) ? clone(store.values.get(key)) : undefined,{database:raw.name,store:name,key}); }); },
            getAll() { return request(tx,'getAll',() => { note({type:'idb-getAll',database:raw.name,store:name}); return read('getAll',Array.from(store.values.values(),clone),{database:raw.name,store:name}); }); },
            getAllKeys() { return request(tx,'getAllKeys',() => { note({type:'idb-getAllKeys',database:raw.name,store:name}); return Array.from(store.values.keys()); }); },
            put(value, key) { return request(tx,'put',() => {
              note({type:'idb-put',database:raw.name,store:name,key:keyFor(store,value,key),value:clone(value)});
              const error = problem('put','synthetic IndexedDB write failure'); if (error) throw error;
              store.values.set(keyFor(store,value,key),clone(value)); return keyFor(store,value,key);
            }); },
            delete(key) { return request(tx,'delete',() => { note({type:'idb-delete',database:raw.name,store:name,key}); store.values.delete(key); return undefined; }); },
            count() { return request(tx,'count',() => store.values.size); },
          };
        }
      };
      return tx;
    },
    close() {}
  });
  return {api:{
    open(name, version) {
      const result = {onsuccess:null,onerror:null,onupgradeneeded:null,result:undefined,error:null};
      note({type:'idb-open',database:name,version});
      schedule('open',() => {
        const error = problem('open','synthetic IndexedDB unavailable');
        if (error) { result.error=error; if (typeof result.onerror === 'function') result.onerror({target:result,preventDefault(){}}); return; }
        let raw=state.get(name), created=!raw;
        if (!raw) { raw={name,version:version || 1,stores:new Map()}; state.set(name,raw); }
        else if (version && version > raw.version) { raw.version=version; created=true; }
        result.result=database(raw);
        if (created && typeof result.onupgradeneeded === 'function') result.onupgradeneeded({target:result,oldVersion:0,newVersion:raw.version});
        if (typeof result.onsuccess === 'function') result.onsuccess({target:result});
      });
      return result;
    }
  },release(phase) {
    const ready=delayed.filter(item=>!phase||item.type===phase);
    for(let index=delayed.length-1;index>=0;index--)if(!phase||delayed[index].type===phase)delayed.splice(index,1);
    ready.forEach(item=>later(item.callback));
    return ready.length;
  }};
}

export function harness({records=[],storage=new Map(),session=new Map(),idb=new Map(),indexedDBFailure,indexedDBDelay,indexedDBReadOverride,trustedSession,handler,owner='sales',chat=[],beforeAsset=''}={}) {
  const calls=[],alerts=[],listeners={},listenerEntries={},nodes={};
  const idbOperations=[],timeline=[],storageOperations=[];
  let sessionIdentity=structuredClone(trustedSession || {name:owner,role:owner==='admin'?'admin':'sales',centralUserId:'test-'+owner,authenticated:true});
  const idbRuntime=indexedDbHarness(idb,idbOperations,timeline,indexedDBFailure,{delay:indexedDBDelay,readOverride:indexedDBReadOverride});
  let documentRef;
  const element=tagName=>{
    const el={tagName:String(tagName || 'div').toUpperCase(),style:{},children:[],attrs:{},parentNode:null,textContent:'',hidden:false,
      setAttribute(name,value){this.attrs[name]=String(value);},getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attrs,name)?this.attrs[name]:null;},removeAttribute(name){delete this.attrs[name];},
      appendChild(child){ if(child.parentNode) child.parentNode.removeChild(child); child.parentNode=this; this.children.push(child); return child; },
      insertBefore(child,before){ if(child.parentNode) child.parentNode.removeChild(child); child.parentNode=this; const index=this.children.indexOf(before); this.children.splice(index<0?this.children.length:index,0,child); return child; },
      removeChild(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);child.parentNode=null;return child;},
      remove(){if(this.parentNode)this.parentNode.removeChild(this);},
      querySelectorAll(selector){const found=[],match=node=>selector==='button'?node.tagName==='BUTTON':selector[0]==='.'?(node.className||'').split(/\s+/).includes(selector.slice(1)):false;const visit=node=>{(node.children||[]).forEach(child=>{if(match(child))found.push(child);visit(child);});};visit(this);return found;},
      focus(){if(documentRef)documentRef.activeElement=this;},click(){if(typeof this.onclick==='function')return this.onclick();}
    };
    Object.defineProperty(el,'nextSibling',{get(){if(!this.parentNode)return null;const index=this.parentNode.children.indexOf(this);return this.parentNode.children[index+1]||null;}});
    return el;
  };
  const body=element('body');
  const appendToBody=body.appendChild.bind(body); body.appendChild=child=>{const added=appendToBody(child);if(child.id)nodes[child.id]=child;return added;};
  documentRef={body,getElementById(id){let found=null;const visit=node=>{if(found)return;if(node.id===id){found=node;return;}(node.children||[]).forEach(visit);};visit(body);return found||nodes[id]||null;},createElement:element,querySelector(selector){if(selector!=='.abar')return null;let found=null;const visit=node=>{if(found)return;if((node.className||'').split(/\s+/).includes('abar')){found=node;return;}(node.children||[]).forEach(visit);};visit(body);return found;},activeElement:null};
  const context=vm.createContext({console:{warn(){}},Date,Math,Promise,setTimeout(){},clearTimeout(){},
    __records:structuredClone(records),__owner:owner,__chats:structuredClone(chat),
    localStorage:{get length(){return storage.size;},key:n=>Array.from(storage.keys())[n]||null,getItem:k=>storage.get(k)||null,setItem(k,v){storageOperations.push({type:'set',key:k,value:v});storage.set(k,v);},removeItem(k){storageOperations.push({type:'remove',key:k});storage.delete(k)}},
    sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)},
    indexedDB:idbRuntime.api,
    __fetch:async(url,opt={})=>{
      const path=String(url); timeline.push({type:'request',path}); calls.push({path,opt:structuredClone(opt)});
      if(path==='/sb/session') return {ok:true,status:200,json:async()=>structuredClone(sessionIdentity)};
      return {ok:false,status:404,json:async()=>({})};
    },
    document:documentRef,
    alert:m=>alerts.push(m),confirm:()=>true,addEventListener:(n,f,options)=>{
      const entries=listenerEntries[n]||(listenerEntries[n]=[]);
      entries.push({fn:f,capture:options===true||!!(options&&options.capture)});
      listeners[n]=event=>{
        const dispatched=event||{};
        dispatched.immediatePropagationStopped=false;
        dispatched.stopImmediatePropagation=()=>{dispatched.immediatePropagationStopped=true;};
        entries.slice().sort((a,b)=>Number(b.capture)-Number(a.capture)).some(entry=>{
          if(dispatched.immediatePropagationStopped)return true;
          entry.fn(dispatched);
          return dispatched.immediatePropagationStopped;
        });
      };
    },
    __request:async(path,opt)=>{
      timeline.push({type:'request',path});
      calls.push({path,opt:structuredClone(opt)});
      if(handler) return handler(path,opt);
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      if(opt?.method==='POST' && Array.isArray(opt.body)) return structuredClone(opt.body);
      return [];
    }
  });
  const script=`
    var window=globalThis;
    window.__fsSessionFetch=function(url,opt){ return __fetch(url,opt); };
    let records=__records,currentUser=__owner,chats=__chats;
    let recTouched={},recLastJson={},recTrackReady=true,recCounter=0,sbApplying=false;
    let sbGuardTake=false,sbGuardOK=false,sbReady=true,sbCanEdit=true,sbPartial=false;
    const SB_GUARD_MAX=12,ACT_MAX=3000,CHAT_PARTS=[{key:'pd'},{key:'ra'},{key:'rd'},{key:'sales'}];
    let sbSnap={records:{},chats:{},users:{},acts:{},msgs:{},apvs:{},tags:null,counter:0};
    let sbCap={msg:true,apv:true},sbPendMsg=[],userList=[],activities=[],tagList=[],sbLastPush=0,chatOpenId=null;
    let sbWM={rec:'',cht:'',usr:'',act:0,msg:'',apv:''};
    const RECBAK_KEY='fs_recbak',RECBAK_PER=12,RECBAK_MAX_CHARS=1500000;let recBak={};
    function sbQueue(){}
    function canSeeRecord(r){return !!r && (currentUser==='admin'||r.createdBy===currentUser);}
    function currentRole(){return currentUser==='admin'?'admin':'sales';}
    function sbCanWriteMeta(){return false;}
    function nowTs(){return 1;}
    function actUid(e){
      if(e.uid)return e.uid;
      var s=[e.ts,e.user,e.role,e.cat,e.action,e.detail,e.job].join('|'),a=0x811c9dc5;
      for(var i=0;i<s.length;i++){a^=s.charCodeAt(i);a=(a*0x01000193)>>>0;}
      e.uid=(e.ts||0).toString(36)+'-'+a.toString(36);return e.uid;
    }
    function sbGuardHold(ids){window.guardHeld=ids;} function sbTry(_,fn,fallback){return fn().catch(()=>fallback);}
    function sbReq(path,opt){return __request(path,opt);} function applyServerTags(){} function cleanJunkTags(){} function syncRecCounter(){}
    function sbGroup(){return {};} function sbBuildChat(row){return row.data;} function mergeParts(){} function mergeChatPayload(){}
    function saveChats(){} function saveActivities(){} function saveUsers(){} function sbRerender(){} function chatLastTs(c){return c.createdAt||0;}
    function getChat(id){return chats.find(c=>c.jobId===id);} function pushSys(c,text){c.messages.push({text,type:'sys',ts:1});}
    function noteChatMovement(){} function nowTs(){return 1;} function logAct(){} function touchChatPart(){} function updateChatBadge(){}
    function sbTouchBusy(){} function renderChat(){} function switchView(){} function markChatSeen(){} function requirePerm(){return true;}
    function chatRoomHTML(){return 'allowed';}
    function newChatFromRecord(id){return createChat(id);}
    function toggleChatApprove(id){window.approved=id;} function approveOn(id){window.approved=id;} function approveOff(id){window.approved=id;}
    function chatIngEdit(id){window.edited=id;} function saveChatFormula(id){window.edited=id;} function chatIngAdd(id){window.edited=id;}
    function chatIngDel(id){window.edited=id;} function closeJob(id){window.closed=id;} function reopenJob(id){window.closed=id;}
    function rejectJob(id){window.closed=id;} function deleteJob(id){window.jobDeleted=id;} function deleteChat(id){window.deleted=id;} function exportChatExcel(id){window.exported=id;}
    ${functions.map(source).join('\n')}
    records.forEach(r=>recLastJson[r.id]=JSON.stringify(r));
    ${beforeAsset}
    ${asset}
  `;
  vm.runInContext(script,context);
  const run=code=>vm.runInContext(code,context);
  const read=code=>JSON.parse(run(`JSON.stringify(${code})`));
  const pending=()=>{const items={};for(const [key,value] of storage){if(key.startsWith('fs_job_outbox_v1:'+encodeURIComponent(run('currentUser'))+':')){const p=JSON.parse(value);items[p.id]=p;}}return items;};
  const fallbackEntries=(owner)=>{
    const values=[];
    for (const database of idb.values()) for (const store of database.stores.values()) for (const value of store.values.values()) {
      // Only the fallback journal counts; the read-state mirror and the retired-copy store are separate databases.
      if (database.name==='fs_chat_seen_v1' || database.name==='fs_job_recbak_v1') continue;
      if (value && typeof value==='object' && (!owner || value.owner===owner)) values.push(structuredClone(value));
    }
    return values;
  };
  const settle=async()=>{ for(let turn=0;turn<256;turn++) await Promise.resolve(); };
  const setTrustedSession=value=>{sessionIdentity=structuredClone(value);};
  return {script,context,run,read,calls,alerts,nodes,listeners,storage,storageOperations,session,idb,idbOperations,timeline,pending,fallbackEntries,settle,releaseIndexedDB:idbRuntime.release,setTrustedSession};
}
export const pull = r => `sbApply({full:true,partial:false,rec:${JSON.stringify(r.map(data=>({id:data.id,data})))},cht:[],usr:[],act:[],msg:[],apv:[]})`;
export const edit = h => h.run(`records[0].brand='Edited'; saveRecordsStore()`);
