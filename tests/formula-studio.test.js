(function(){
  'use strict';

  const tests = [];
  function test(name, fn){ tests.push({name, fn}); }
  function assert(value, message){ if(!value) throw new Error(message); }
  function equal(actual, expected, message){
    if(actual !== expected) throw new Error((message || 'values differ') + ` (expected ${expected}, got ${actual})`);
  }
  function reset(){
    if(typeof teardownPrivateWorkspace === 'function') teardownPrivateWorkspace();
    localStorage.clear();
    sessionStorage.clear();
    window.__fetchCalls.length = 0;
    window.__fetchQueue.length = 0;
    SB_URL = 'https://test-project.supabase.co';
    SB_KEY = 'sb_publishable_test_only';
    OPC_USER_REFERENCE_ENABLED = false;
    delete window.__FS_OPC_USER_REFERENCE_PROVIDER__;
    if(typeof authSession !== 'undefined') authSession = null;
    if(typeof authMembership !== 'undefined') authMembership = null;
    if(typeof authOpcUserReference !== 'undefined') authOpcUserReference = null;
    if(typeof authChecking !== 'undefined') authChecking = false;
    currentUser = '';
    impersonator = '';
    userList = [];
    if(typeof chatEventOutbox !== 'undefined') chatEventOutbox = [];
    if(typeof chatReadOutbox !== 'undefined') chatReadOutbox = [];
    if(typeof chatDeleteOutbox !== 'undefined') chatDeleteOutbox = [];
    sbReady = false;
    sbErr = '';
    if(typeof sbConfirmedRecords !== 'undefined') sbConfirmedRecords = {};
    if(typeof sbConfirmedScope !== 'undefined') sbConfirmedScope = '';
    if(typeof saveQReset === 'function') saveQReset();
    if(typeof clearTimeout === 'function' && typeof sbPushTimer !== 'undefined') clearTimeout(sbPushTimer);
  }

  function savedJobFixture(){
    return {id:'A00091',customer:'Synthetic job',createdBy:'Admin Owner',createdAt:1000,rows:[]};
  }
  function jobSession(r){
    reset();
    authSession = {access_token:'synthetic-member-token',user:{id:'synthetic-user'}};
    authMembership = {name:'Admin Owner',role:'admin',active:true};
    currentUser = 'Admin Owner';
    userList = [{name:'Admin Owner',role:'admin',pass:null}];
    records=[r]; chats=[]; activities=[]; recCounter=91; chatOpenId=null;
    sbSnap={records:{},chats:{},users:{},acts:{},counter:91};
  }
  function pullJob(r){
    sbApply({records:[JSON.parse(JSON.stringify(r))],chats:[],users:[],acts:[],counter:91});
  }

  test('unsaved jobs cannot create a room, including Admin', function(){
    const r=savedJobFixture(); jobSession(r);
    const oldAlert=window.alert; window.alert=function(){};
    try{ equal(createChat(r.id),null,'an unconfirmed job created a room'); equal(chats.length,0); }
    finally{ window.alert=oldAlert; }
  });
  test('server-confirmed jobs open one room; a later edit locks it again', function(){
    const r=savedJobFixture(); jobSession(r); pullJob(r);
    const c=createChat(r.id); assert(c,'confirmed job did not create a room');
    equal(createChat(r.id),c,'duplicate room created');
    records[0].customer='Changed locally';
    const oldAlert=window.alert; window.alert=function(){};
    try{ openChatRoom(r.id); equal(chatOpenId,null,'dirty job entered the room'); }
    finally{ window.alert=oldAlert; }
  });
  test('offline local save cannot unlock chat', function(){
    const r=savedJobFixture(); jobSession(r); SB_URL='';
    const oldAlert=window.alert; window.alert=function(){};
    try{ equal(createChat(r.id),null,'local-only storage unlocked central Chat'); }
    finally{ window.alert=oldAlert; }
  });
  test('a cached snapshot cannot substitute for a server acknowledgement', function(){
    const r=savedJobFixture(); jobSession(r);
    sbSnap.records[r.id]=JSON.stringify(r);
    const oldAlert=window.alert; window.alert=function(){};
    try{ equal(createChat(r.id),null,'cached snapshot unlocked Chat'); }
    finally{ window.alert=oldAlert; }
  });
  test('invalid confirmed data and another Sales owner remain blocked', function(){
    const r=savedJobFixture(); r.customer=' '; jobSession(r); pullJob(r);
    const oldAlert=window.alert; window.alert=function(){};
    try{
      equal(createChat(r.id),null,'invalid server data unlocked Chat');
      r.customer='Valid'; pullJob(r);
      authMembership={name:'Sales One',role:'sales',active:true}; currentUser='Sales One';
      equal(createChat(r.id),null,'another owner created a room');
    }finally{ window.alert=oldAlert; }
  });
  test('an already-open room cannot send or approve after the record becomes pending', function(){
    const r=savedJobFixture(); jobSession(r); pullJob(r);
    const c=createChat(r.id); chatOpenId=r.id;
    records[0].customer='Pending edit';
    const oldAlert=window.alert; window.alert=function(){};
    try{
      const before=c.messages.length, events=chatEventOutbox.length;
      sendChatMsg(); toggleChatApprove(r.id,'pd');
      equal(c.messages.length,before,'locked room added messages');
      equal(chatEventOutbox.length,events,'locked room queued events');
      equal(c.approvals.pd,null,'locked room approved');
    }finally{ window.alert=oldAlert; }
  });
  test('only the returned record payload unlocks Chat; omitted rows stay pending', async function(){
    const r=savedJobFixture(); jobSession(r);
    window.__fetchQueue.push(window.__mockResponse(200,[]));
    await sbPush();
    const oldAlert=window.alert; window.alert=function(){};
    try{ equal(createChat(r.id),null,'an empty write response confirmed the record'); }
    finally{ window.alert=oldAlert; }
    window.__fetchQueue.push(window.__mockResponse(200,[{id:r.id,data:JSON.parse(JSON.stringify(r))}]));
    await sbPush();
    assert(createChat(r.id),'the returned saved payload did not unlock Chat');
  });
  test('an in-flight edit is not confirmed by the acknowledgement of the older payload', async function(){
    const r=savedJobFixture(); jobSession(r);
    window.__fetchQueue.push(function(){
      const older=JSON.parse(JSON.stringify(r)); r.customer='Edited while saving';
      return window.__mockResponse(200,[{id:r.id,data:older}]);
    });
    await sbPush();
    const oldAlert=window.alert; window.alert=function(){};
    try{ equal(createChat(r.id),null,'older acknowledgement confirmed the newer edit'); }
    finally{ window.alert=oldAlert; }
  });
  test('JSONB object-key ordering does not prevent a valid save acknowledgement', async function(){
    const r=savedJobFixture(); jobSession(r);
    const reordered={rows:[],createdAt:1000,createdBy:'Admin Owner',customer:'Synthetic job',id:'A00091'};
    window.__fetchQueue.push(window.__mockResponse(200,[{id:r.id,data:reordered}]));
    await sbPush();
    assert(createChat(r.id),'JSONB key ordering kept a valid job locked');
  });
  test('pending Chat events are retained until their record is saved', async function(){
    const r=savedJobFixture(); jobSession(r);
    queueChatEvent(r.id,{type:'message',text:'waiting'},'pending-job-event');
    await sbPushChatEvents();
    equal(chatEventOutbox.length,1,'pending event was removed');
    equal(window.__fetchCalls.length,0,'pending event reached the RPC');
  });
  test('a failed server refresh locks previously confirmed Chat until recovery', async function(){
    const r=savedJobFixture(); jobSession(r); pullJob(r);
    window.__fetchQueue.push(function(){ throw new Error('synthetic network unavailable'); });
    await sbCycle();
    const oldAlert=window.alert; window.alert=function(){};
    try{ equal(createChat(r.id),null,'failed refresh left Chat unlocked'); }
    finally{ window.alert=oldAlert; }
    window.__fetchQueue.push(window.__mockResponse(200,[{id:r.id,data:JSON.parse(JSON.stringify(r))}]),
      window.__mockResponse(200,[]),window.__mockResponse(200,[]),
      window.__mockResponse(200,[{key:'reccounter',value:91}]),window.__mockResponse(200,[]));
    await sbCycle();
    assert(createChat(r.id),'successful recovery did not unlock Chat');
  });
  test('inactivity warns only after seven days and never for closed work', function(){
    reset(); records=[]; chats=[]; activities=[];
    const r=savedJobFixture(); r.createdAt=1000;
    assert(typeof jobIsStale==='function','inactivity rule is missing');
    equal(jobIsStale(r,604801000),false,'exactly seven days warned');
    equal(jobIsStale(r,604801001),true,'more than seven days did not warn');
    r.closed={ts:2000}; equal(jobIsStale(r,999999999),false,'closed work warned');
  });
  test('reading does not reset inactivity; edits, messages and approvals do', function(){
    reset(); const r=savedJobFixture(); records=[r]; activities=[];
    chats=[{jobId:r.id,createdAt:2000,messages:[],parts:[{lastAt:900000}],seen:{Reader:900000},approvals:{}}];
    assert(typeof jobLastMovement==='function','movement calculation is missing');
    equal(jobLastMovement(r),2000,'reading counted as movement');
    chats[0].messages=[{type:'msg',ts:3000}]; equal(jobLastMovement(r),3000);
    chats[0].approvals.pd={ts:4000}; equal(jobLastMovement(r),4000);
    r.lastActivityAt=5000; equal(jobLastMovement(r),5000);
    r.lastActivityAt='invalid'; equal(jobLastMovement(r),4000,'invalid timestamp masked known movement');
  });
  test('stale warnings are rendered only for visible jobs', function(){
    const r=savedJobFixture(); jobSession(r);
    authMembership={name:'Sales One',role:'sales',active:true}; currentUser='Sales One';
    r.createdBy='Sales One'; records.push({...r,id:'A00092',createdBy:'Sales Two'});
    recFromStr=''; recToStr=''; statFilter=''; renderRecordsList();
    const panel=document.getElementById('recordsPanel');
    assert(panel.querySelector('.job-stale'),'stale warning is missing');
    assert(!panel.textContent.includes('A00092'),'hidden job leaked into warnings');
  });
  test('Sales can load an existing job from its detail popup to retrieve price', function(){
    reset();
    SB_URL='';
    currentUser='Sales One';
    userList=[{name:'Sales One',role:'sales',pass:null}];
    const r={id:'A00091',customer:'Synthetic job',brand:'Synthetic brand',createdBy:'Sales One',
      salesOwner:'Sales One',price:'150',rows:[],allConcepts:[],benefits:[],cons:[]};
    records=[r]; chats=[]; activities=[];

    openRecordPopup(r.id);
    const box=document.getElementById('gModalBox');
    const openButton=Array.from(box.querySelectorAll('button'))
      .find(button=>button.textContent.includes('เปิดใน Customer Data'));
    assert(openButton,'existing job has no Sales reload action');
    openButton.click();
    equal(document.getElementById('f_price').value,'150','existing price was not loaded');
    equal(window._editingRecordId,r.id,'reload action did not preserve the existing job id');
  });
  test('locked invalid identifiers cannot inject code through recovery buttons', function(){
    const r=savedJobFixture(); r.id="A00091');window.__jobUnsafe=true;//"; jobSession(r);
    const box=document.createElement('div'); box.innerHTML=jobLockedHTML(r);
    box.querySelector('button').click();
    assert(!window.__jobUnsafe,'invalid identifier executed through a recovery button');
    delete window.__jobUnsafe;
  });

  test('secure mode exposes the required Auth boundary', function(){
    ['authSignIn','authRestoreSession','authRefreshSession','authSignOut','authFetchMembership','authDataHeaders']
      .forEach(name=>assert(typeof window[name] === 'function', `${name} is missing`));
  });

  test('secure boot never reads protected data without a session', async function(){
    reset();
    await sbBoot();
    const restCalls = window.__fetchCalls.filter(call=>call.url.includes('/rest/v1/'));
    equal(restCalls.length, 0, 'unauthenticated boot reached the Data API');
    equal(currentUser, '', 'cached browser identity was trusted');
  });

  test('password sign-in uses Auth API and stores session only in sessionStorage', async function(){
    reset();
    window.__fetchQueue.push(window.__mockResponse(200, {
      access_token:'access-test', refresh_token:'refresh-test', expires_in:3600,
      user:{id:'11111111-1111-1111-1111-111111111111', email:'owner@example.test'}
    }));
    const session = await authSignIn('owner@example.test', 'correct horse');
    assert(session && session.access_token === 'access-test', 'sign-in did not return the session');
    const call = window.__fetchCalls[0];
    assert(call.url.endsWith('/auth/v1/token?grant_type=password'), 'wrong Auth password endpoint');
    equal(call.options.method, 'POST', 'password grant must use POST');
    equal(call.options.headers.apikey, SB_KEY, 'publishable key missing from Auth request');
    assert(sessionStorage.getItem('fs_auth_session'), 'session was not stored in sessionStorage');
    equal(localStorage.getItem('fs_auth_session'), null, 'session leaked into localStorage');
    equal(localStorage.getItem('fs_user'), null, 'legacy identity was persisted');
  });

  test('Data API headers separate publishable key and user bearer token', function(){
    reset();
    authSession = {access_token:'user-jwt-test'};
    const headers = authDataHeaders();
    equal(headers.apikey, SB_KEY, 'Data API apikey is wrong');
    equal(headers.Authorization, 'Bearer user-jwt-test', 'Data API bearer is not the user token');
    assert(!headers.Authorization.includes(SB_KEY), 'publishable key was used as authorization');
  });

  test('expired sessions refresh through Auth and remain session-only', async function(){
    reset();
    authSession = {access_token:'expired',refresh_token:'refresh-old',expires_at:1};
    sessionStorage.setItem('fs_auth_session', JSON.stringify(authSession));
    window.__fetchQueue.push(window.__mockResponse(200, {
      access_token:'access-new',refresh_token:'refresh-new',expires_in:3600,
      user:{id:'11111111-1111-1111-1111-111111111111',email:'owner@example.test'}
    }));
    const session = await authRefreshSession();
    equal(session.access_token, 'access-new', 'refresh did not replace the token');
    assert(window.__fetchCalls[0].url.endsWith('/auth/v1/token?grant_type=refresh_token'), 'wrong refresh endpoint');
    equal(localStorage.getItem('fs_auth_session'), null, 'refreshed session leaked into localStorage');
  });

  test('401 clears authorization instead of falling back to publishable bearer', async function(){
    reset();
    // ไม่มี refresh_token → ต่ออายุไม่ได้ ต้องล้าง session ทันที
    authSession = {access_token:'expired-token',expires_at:Date.now()/1000+3600};
    window.__fetchQueue.push(window.__mockResponse(401, {message:'jwt expired'}));
    let failed = false;
    try{ await sbReq('fs_records?select=id'); }catch(err){ failed = true; }
    assert(failed, 'unauthenticated request unexpectedly succeeded');
    equal(authSession, null, 'expired session was retained');
    equal(sessionStorage.getItem('fs_auth_session'), null, 'expired token remained in storage');
    // และต้องไม่มีทางส่ง publishable key เป็น Bearer แทนตัวตนผู้ใช้
    let threw = false;
    try{ authDataHeaders(); }catch(err){ threw = true; }
    assert(threw, 'header builder fell back to a session-less request');
  });

  test('403 is an authorization denial and must NOT destroy the session', async function(){
    // PostgREST ตอบ 403 ทุกครั้งที่ RLS/guard trigger ปฏิเสธ ซึ่งเป็นเรื่อง "สิทธิ์"
    // ไม่ใช่ "ตัวตน" · ถ้าล้าง session ตรงนี้ ผู้ใช้จะถูกเด้งออกหน้า login แล้ว delta
    // ที่ถูกปฏิเสธยังค้างอยู่ พอล็อกอินใหม่ก็ push ซ้ำแล้วเด้งอีก วนไม่จบ
    reset();
    authSession = {access_token:'valid-token',refresh_token:'refresh-test',expires_at:Date.now()/1000+3600};
    window.__fetchQueue.push(window.__mockResponse(403, {message:'record mutation exceeds role permission'}));
    let caught = null;
    try{ await sbReq('fs_records?select=id'); }catch(err){ caught = err; }
    assert(caught, 'forbidden request unexpectedly succeeded');
    assert(authSession && authSession.access_token === 'valid-token', 'authorization denial destroyed the session');
    equal(caught.sbStatus, 403, 'status was not reported to the caller');
    assert(caught.sbPermanent === true, 'a role denial was marked retryable');
    // ยังต้องใช้ token ของผู้ใช้เองเท่านั้น ไม่ถอยไปใช้ publishable key เป็น Bearer
    equal(authDataHeaders().Authorization, 'Bearer valid-token', 'fell back to a different bearer');
  });

  // ---- อาการ "ล็อกอินแล้วเด้งออก ใช้งานไม่ได้" ที่พบจาก /code-review ----

  function activeSession(role){
    authSession = {access_token:'valid-token',refresh_token:'refresh-test',expires_at:Date.now()/1000+3600,
      user:{id:'22222222-2222-2222-2222-222222222222',email:'user@example.test'}};
    authMembership = {name:'ผู้ใช้ทดสอบ',role:role,active:true};
    currentUser = 'ผู้ใช้ทดสอบ';
    sbReady = true;
  }

  test('role ที่เขียน fs_meta ไม่ได้ ต้องไม่ push reccounter (เดิมโดน 403 ตั้งแต่ sync แรก)', async function(){
    // schema ไม่ได้ seed fs_meta ค่าจากเซิร์ฟเวอร์จึงเป็น null ส่วน recCounter เริ่มที่ 0
    // เดิมเทียบด้วย !== ตรง ๆ จึง "ต่างกัน" เสมอ แล้วทุก sync จะยิง fs_meta
    for(const role of ['pd','ra','rd','purchasing']){
      reset();
      activeSession(role);
      records = []; chats = []; activities = []; recCounter = 0;
      sbSnap = {records:{},chats:{},users:{},acts:{},counter:null};
      const pushed = await sbPush();
      const metaCalls = window.__fetchCalls.filter(c=>c.url.includes('fs_meta'));
      equal(metaCalls.length, 0, role + ' ยังพยายามเขียน fs_meta');
      equal(pushed, false, role + ' คิดว่ามีอะไรต้อง push ทั้งที่ไม่มี');
    }
  });

  test('role ที่ไม่มีสิทธิ์เขียน record ต้องไม่ส่ง record ขึ้นเซิร์ฟเวอร์', async function(){
    for(const role of ['ra','rd','purchasing']){
      reset();
      activeSession(role);
      records = [{id:'A00001', customer:'ลูกค้าเก่าในเครื่อง'}];
      chats = []; activities = []; recCounter = 1;
      sbSnap = {records:{},chats:{},users:{},acts:{},counter:1};
      await sbPush();
      const recCalls = window.__fetchCalls.filter(c=>c.url.includes('fs_records') && c.options.method==='POST');
      equal(recCalls.length, 0, role + ' ส่ง record ที่เซิร์ฟเวอร์จะปฏิเสธแน่ ๆ');
      equal(records.length, 1, role + ' ทำ record ในเครื่องหาย');
    }
  });

  test('activity ที่ push แล้วต้องไม่ถูกส่งซ้ำ แม้ pull จะคืนรายการเปล่า', async function(){
    // fs_activities ให้ SELECT เฉพาะ admin · role อื่นได้ 200 [] กลับมา ถ้าจำว่า
    // "ส่งแล้ว" ไว้ใน snapshot ที่มาจากการ pull ร่องรอยจะหายทุกรอบแล้วส่งซ้ำตลอดไป
    reset();
    activeSession('sales');
    records = []; chats = []; recCounter = 0;
    activities = [{ts:1000, at:'x', user:'ผู้ใช้ทดสอบ', role:'sales', cat:'auth', action:'เข้าใช้งาน', detail:'', job:'', via:''}];
    sbSnap = {records:{},chats:{},users:{},acts:{},counter:0};
    window.__fetchQueue.push(window.__mockResponse(200, null));
    equal(await sbPush(), true, 'รอบแรกควรมี activity ให้ส่ง');

    // จำลองการ pull ที่คืน acts เปล่า (RLS ปฏิเสธแบบเงียบ)
    sbSnap = {records:{},chats:{},users:{},acts:{},counter:0};
    equal(await sbPush(), false, 'ส่ง activity ซ้ำอีกรอบ (loop ทุก 5 วินาที)');
  });

  test('การล็อกอินของ non-admin ต้องไม่ล้าง activity ในเครื่อง', async function(){
    reset();
    activities = [{ts:1, at:'x', user:'ใครสักคน', role:'sales', cat:'job', action:'สร้างงาน', detail:'', job:'A00001', via:''}];
    saveActivities();
    authSession = {access_token:'t', refresh_token:'r', expires_at:Date.now()/1000+3600,
      user:{id:'33333333-3333-3333-3333-333333333333', email:'sales@example.test'}};
    window.__fetchQueue.push(window.__mockResponse(200, [
      {user_id:'33333333-3333-3333-3333-333333333333', name:'เซลส์ทดสอบ', role:'sales', active:true}
    ]));
    await authFetchMembership();
    equal(activities.length, 1, 'activity ในเครื่องถูกล้างทิ้งตอนล็อกอิน');
    assert(localStorage.getItem('fs_activities'), 'fs_activities ถูกลบออกจาก localStorage');
  });

  test('บัญชีที่ยังไม่มีสิทธิ์ ต้องบอกสาเหตุให้ต่างจากรหัสผ่านผิดและเน็ตล่ม', async function(){
    reset();
    authSession = {access_token:'t', refresh_token:'r', expires_at:Date.now()/1000+3600,
      user:{id:'44444444-4444-4444-4444-444444444444', email:'new@example.test'}};
    window.__fetchQueue.push(window.__mockResponse(200, []));
    let caught = null;
    try{ await authFetchMembership(); }catch(err){ caught = err; }
    assert(caught, 'ล็อกอินสำเร็จทั้งที่ไม่มี membership');
    const friendly = authFriendlyError(caught);
    assert(friendly.includes('fs_memberships'), 'ข้อความไม่ได้บอกว่าต้องเพิ่ม membership: ' + friendly);
    assert(!friendly.includes('อินเทอร์เน็ต'), 'ยังโทษอินเทอร์เน็ตอยู่');
  });

  test('an explicitly disabled OPC reference preserves the current Admin auth flow', async function(){
    reset();
    authSession = {access_token:'admin-token',refresh_token:'refresh-test',expires_at:Date.now()/1000+3600,
      user:{id:'55555555-5555-5555-5555-555555555555',email:'admin@example.test'}};
    let providerCalled = false;
    window.__FS_OPC_USER_REFERENCE_PROVIDER__ = async function(){ providerCalled = true; return []; };
    window.__fetchQueue.push(window.__mockResponse(200, [
      {user_id:'55555555-5555-5555-5555-555555555555',name:'Admin Test',role:'admin',active:true}
    ]));
    await authFetchMembership();
    equal(providerCalled, false, 'disabled OPC reference provider was called');
    equal(authMembership.role, 'admin', 'legacy Admin membership flow changed');
    equal(authOpcUserReference, null, 'disabled OPC reference was retained');
  });

  test('enabled OPC reference maps the authenticated user without using Supabase as the mapping source', async function(){
    reset();
    OPC_USER_REFERENCE_ENABLED = true;
    authSession = {access_token:'admin-token',refresh_token:'refresh-test',expires_at:Date.now()/1000+3600,
      user:{id:'66666666-6666-6666-6666-666666666666',email:'admin@example.test'}};
    let providerRequest = null;
    window.__FS_OPC_USER_REFERENCE_PROVIDER__ = async function(request){
      providerRequest = request;
      return [{
        'OPC Username':'opc-admin-1', 'User Name':'Admin From OPC',
        'Position / Department':'Management', 'Current Role':'admin',
        'OPC Login Email':'admin@example.test', 'Cloudflare Access Email':'', 'User Status':'Active'
      }];
    };
    window.__fetchQueue.push(window.__mockResponse(200, [
      {user_id:'66666666-6666-6666-6666-666666666666',name:'Legacy Admin',role:'admin',active:true}
    ]));
    await authFetchMembership();
    equal(providerRequest.source, 'opc-workflow', 'wrong identity reference source');
    equal(providerRequest.auth_user.email, 'admin@example.test', 'provider did not receive Auth identity for lookup');
    equal(authOpcUserReference.opc_user_id, 'opc-admin-1', 'OPC user reference was not retained');
    equal(authOpcUserReference.name, 'Admin From OPC', 'OPC display name was not normalized');
    equal(currentUser, 'Legacy Admin', 'legacy Formula display identity was changed');
    equal(currentRole(), 'admin', 'Supabase/Auth role boundary was bypassed');
  });

  test('enabled OPC reference uses the same-origin server adapter without exposing a report token', async function(){
    reset();
    OPC_USER_REFERENCE_ENABLED = true;
    authSession = {access_token:'admin-token',refresh_token:'refresh-test',expires_at:Date.now()/1000+3600,
      user:{id:'88888888-8888-8888-8888-888888888888',email:'admin@example.test'}};
    window.__fetchQueue.push(window.__mockResponse(200, [
      {user_id:'88888888-8888-8888-8888-888888888888',name:'Legacy Admin',role:'admin',active:true}
    ]));
    window.__fetchQueue.push(window.__mockResponse(200, {
      users:[{source_record_id:'opc-admin-1',display_name:'Admin From OPC',department:'Management',role:'admin',is_active:true,access_email:'admin@example.test'}]
    }));
    await authFetchMembership();
    equal(authOpcUserReference.opc_user_id, 'opc-admin-1', 'same-origin adapter did not map the OPC record');
    const adapterCall = window.__fetchCalls.find(call => call.url === '/api/opc-user-directory');
    assert(adapterCall, 'Formula did not call the same-origin OPC adapter');
    equal(adapterCall.options.headers.Authorization, 'Bearer admin-token', 'Formula did not authenticate the same-origin adapter');
    assert(!JSON.stringify(adapterCall.options).toLowerCase().includes('report_api_token'), 'Formula exposed the OPC report token');
    assert(!JSON.stringify(adapterCall.options).toLowerCase().includes('x-report-token'), 'Formula sent the OPC report token from the browser');
  });

  test('enabled OPC reference fails closed when the authenticated user is not active in the reference', async function(){
    reset();
    OPC_USER_REFERENCE_ENABLED = true;
    authSession = {access_token:'admin-token',refresh_token:'refresh-test',expires_at:Date.now()/1000+3600,
      user:{id:'77777777-7777-7777-7777-777777777777',email:'inactive@example.test'}};
    window.__FS_OPC_USER_REFERENCE_PROVIDER__ = async function(){
      return [{'OPC Username':'opc-inactive-1','User Name':'Inactive Admin',
        'OPC Login Email':'inactive@example.test','Current Role':'admin','User Status':'Inactive'}];
    };
    window.__fetchQueue.push(window.__mockResponse(200, [
      {user_id:'77777777-7777-7777-7777-777777777777',name:'Legacy Admin',role:'admin',active:true}
    ]));
    let caught = null;
    try{ await authFetchMembership(); }catch(err){ caught = err; }
    assert(caught && /OPC_USER_REFERENCE_MISSING/.test(caught.message), 'inactive OPC user was accepted');
    equal(authSession, null, 'session remained after OPC identity denial');
    equal(authOpcUserReference, null, 'denied OPC identity remained in memory');
  });

  test('chat event ที่ถูกปฏิเสธถาวร ต้องไม่ทำให้ทั้ง sbPush ค้าง', async function(){
    reset();
    activeSession('sales');
    records = [{id:'A00001',customer:'Synthetic',createdBy:currentUser}]; chats = []; activities = []; recCounter = 0;
    sbSnap = {records:{},chats:{},users:{},acts:{},counter:0};
    sbConfirmRecords(records,true);
    chatEventOutbox = [{eventId:'ev-1', jobId:'A00001', payload:{type:'message', text:'ยาวเกิน'}}];
    // RPC ปฏิเสธถาวร แล้วตามด้วย 200 ของ upsert อื่น ๆ
    window.__fetchQueue.push(window.__mockResponse(400, {message:'chat message must be 1 to 10000 characters'}));
    let threw = false;
    try{ await sbPushChatEvents(); }catch(err){ threw = true; }
    assert(!threw, 'ข้อความเดียวที่ถูกปฏิเสธทำให้ทั้ง sbPush หยุด');
    equal(chatEventOutbox.length, 0, 'รายการที่ปฏิเสธถาวรยังค้างใน outbox');
    assert(chatDeadLetter.length === 1, 'ไม่ได้เก็บรายการที่ถูกปฏิเสธไว้ตรวจ');
  });

  test('ข้อความระบบที่ยาวเกินถูกตัดก่อนเข้า outbox', function(){
    reset();
    activeSession('sales');
    const c = {jobId:'A00001', messages:[], parts:[], approvals:{}};
    pushSys(c, 'x'.repeat(9000), {action:'job_edit', skipQueue:true});
    assert(c.messages[0].text.length <= 5000, 'ข้อความระบบยาวเกินขีดจำกัดของเซิร์ฟเวอร์');
  });

  test('local-only mode works without Auth or network', async function(){
    reset();
    SB_URL = '';
    SB_KEY = '';
    localStorage.setItem('fs_records', JSON.stringify([{id:'local-1',customer:'Synthetic'}]));
    loadRecords();
    await sbBoot();
    equal(records.length, 1, 'local record was not loaded');
    equal(window.__fetchCalls.length, 0, 'local-only mode used the network');
  });

  // sync ทุก 5 วินาทีเรียก sbRerender() ซึ่งวาดหน้าแชทใหม่ทั้งก้อน · เดิมช่องค้นหารหัสงาน
  // ถูกสร้างใหม่ ข้อความที่พิมพ์ค้างหายและรายการผลค้นหาปิดเอง (build 2026-09-19.1)
  async function chatSearchSurvivesSync(openId){
    reset();
    activeSession('admin');
    userList = [{name:'แอดมิน', role:'admin', email:'', pass:null}];
    currentUser = 'แอดมิน';
    authMembership.name=currentUser;
    const savedRecords = records, savedChats = chats, savedOpen = chatOpenId;
    const view = document.getElementById('chatView');
    const wasOn = view.classList.contains('on');
    const room = id=>({jobId:id, createdAt:'', createdBy:'แอดมิน', messages:[], parts:[], approvals:{pd:false, ra:false, rd:false}});
    try{
      records = [{id:'A00001', customer:'ลูกค้าหนึ่ง', createdBy:'แอดมิน'}, {id:'A00002', customer:'ลูกค้าสอง', createdBy:'แอดมิน'}];
      chats = [room('A00001'), room('A00002')];
      sbConfirmRecords(records,true);
      chatOpenId = openId;
      view.classList.add('on');
      renderChat();
      const inp = document.getElementById('chatPickInput');
      assert(inp, 'ไม่มีช่องค้นหารหัสงาน');
      inp.focus();
      inp.value = 'สอง';
      chatPickFilter();

      sbRerender();
      await new Promise(done=>setTimeout(done, 250));   // เลยเวลา onblur → chatPickClose (150ms)

      const after = document.getElementById('chatPickInput');
      const list = document.getElementById('chatPickList');
      equal(after.value, 'สอง', 'ข้อความที่พิมพ์ค้างหายหลัง sync');
      assert(document.activeElement === after, 'ช่องค้นหาหลุด focus หลัง sync');
      assert(list && !list.hidden, 'รายการผลค้นหาปิดเองหลัง sync');
      const ids = [...list.querySelectorAll('.chat-pick-id')].map(el=>el.textContent);
      equal(ids.join(','), 'A00002', 'ผลค้นหาหลัง sync ไม่ตรงกับคำค้น');
    }finally{
      records = savedRecords; chats = savedChats; chatOpenId = savedOpen;
      if(!wasOn) view.classList.remove('on');
      renderChat();
    }
  }
  test('sync ต้องไม่ล้างคำค้นในช่องค้นหารหัสงาน (หน้ารายการแชท)', function(){ return chatSearchSurvivesSync(null); });
  test('sync ต้องไม่ล้างคำค้นในช่องค้นหารหัสงาน (ในห้องแชท)', function(){ return chatSearchSurvivesSync('A00001'); });

  // แท็บอื่นแก้ fs_chats → ตัวฟัง storage วาดหน้าแชทใหม่ · เดิมไม่เก็บค่าอะไรเลย
  test('แท็บอื่นแก้แชท ต้องไม่ล้างข้อความที่พิมพ์ค้างในห้องแชท', async function(){
    reset();
    activeSession('admin');
    userList = [{name:'แอดมิน', role:'admin', email:'', pass:null}];
    currentUser = 'แอดมิน';
    authMembership.name=currentUser;
    const savedRecords = records, savedChats = chats, savedOpen = chatOpenId;
    const view = document.getElementById('chatView');
    const wasOn = view.classList.contains('on');
    try{
      records = [{id:'A00001', customer:'ลูกค้าหนึ่ง', createdBy:'แอดมิน'}];
      sbConfirmRecords(records,true);
      chats = [{jobId:'A00001', createdAt:'', createdBy:'แอดมิน', messages:[], parts:[], approvals:{pd:false, ra:false, rd:false}}];
      localStorage.setItem('fs_chats', JSON.stringify(chats));
      chatOpenId = 'A00001';
      view.classList.add('on');
      renderChat();
      const ta = document.getElementById('chatInput');
      assert(ta, 'ไม่มีช่องพิมพ์ข้อความในห้องแชท');
      ta.focus();
      ta.value = 'ร่างข้อความยาว ๆ';

      window.dispatchEvent(new StorageEvent('storage', {key:'fs_chats'}));

      const after = document.getElementById('chatInput');
      assert(after !== ta, 'เทสต์ไม่ได้จำลองการวาดใหม่จริง');
      equal(after.value, 'ร่างข้อความยาว ๆ', 'ข้อความที่พิมพ์ค้างหายเมื่อแท็บอื่นแก้แชท');
      assert(document.activeElement === after, 'ช่องพิมพ์หลุด focus เมื่อแท็บอื่นแก้แชท');
    }finally{
      records = savedRecords; chats = savedChats; chatOpenId = savedOpen;
      if(!wasOn) view.classList.remove('on');
      renderChat();
    }
  });

  // กันเกิดซ้ำ: ช่องที่เพิ่มในอนาคตต้องรอดการวาดใหม่เองโดยไม่ต้องลงชื่อ id ไว้ที่ไหน
  test('preserveTypedFields เก็บทุกช่องที่กำลังพิมพ์ แต่ไม่ยุ่งกับช่องที่ไม่ได้แตะ', function(){
    const host = document.createElement('div');
    document.body.appendChild(host);
    const html = '<input id="kfA" value="ค่าเดิม"><input id="kfB" value="ค่าเดิม"><textarea id="kfC"></textarea><input id="kfD" type="checkbox">';
    try{
      host.innerHTML = html;
      document.getElementById('kfA').value = 'พิมพ์ใหม่';
      document.getElementById('kfC').value = 'ร่าง';
      document.getElementById('kfC').focus();
      document.getElementById('kfD').checked = true;
      preserveTypedFields(()=>{ host.innerHTML = html.replace('id="kfB" value="ค่าเดิม"', 'id="kfB" value="ค่าใหม่จากเซิร์ฟเวอร์"'); });
      equal(document.getElementById('kfA').value, 'พิมพ์ใหม่', 'ช่องที่พิมพ์ค้างไม่ได้ถูกเก็บ');
      equal(document.getElementById('kfB').value, 'ค่าใหม่จากเซิร์ฟเวอร์', 'ช่องที่ผู้ใช้ไม่ได้แตะถูกทับด้วยค่าเก่า');
      equal(document.getElementById('kfC').value, 'ร่าง', 'textarea ที่พิมพ์ค้างไม่ได้ถูกเก็บ');
      assert(document.activeElement === document.getElementById('kfC'), 'focus ไม่กลับไปที่ช่องเดิม');
      equal(document.getElementById('kfD').checked, false, 'checkbox ไม่ควรถูกแตะ');
    }finally{
      host.remove();
    }
  });

  // ---- Private workspace loader (ของเสริมล้วน ไม่แตะของเดิม) ----
  //
  // ข้อบังคับจากเจ้าของ: "ทำเสริมปุ่มหน้าใหม่ไม่แตะของเดิมนะ เข้าผ่าน user และ role
  // ที่กำหนดเท่านั้น" · เทสต์ชุดนี้พิสูจน์ทั้งสองครึ่ง — ครึ่งที่เพิ่มเข้ามา และครึ่งที่
  // ต้องไม่เปลี่ยนเลยเมื่อไม่มีสิทธิ์หรือไม่ได้ตั้งค่า

  function domFingerprint(){
    return document.documentElement.outerHTML;
  }

  function workspaceSession(){
    authSession = {access_token:'ws-token', refresh_token:'r', expires_at:Date.now()/1000+3600,
      user:{id:'55555555-5555-5555-5555-555555555555', email:'rd@example.test'}};
    authMembership = {user_id:authSession.user.id, name:'อาร์แอนด์ดี', role:'rd', active:true};
    currentUser = 'อาร์แอนด์ดี';
  }

  test('index.html ไม่มีคำว่า RD Science หรือเนื้อหา Science แบบ static เลย', function(){
    reset();
    // คนที่เปิด view-source โดยไม่มีสิทธิ์ ต้องไม่เห็นแม้แต่ร่องรอยว่ามีระบบนี้อยู่
    // นับเฉพาะเนื้อของ index.html จริง ๆ · ตัวเทสต์กับ mock ของ harness ถูกฉีดเข้ามา
    // ในหน้าเดียวกัน และมีคำเหล่านี้อยู่ในชื่อเทสต์ ซึ่งไม่ได้ถูกส่งขึ้น deployment
    const shipped = document.documentElement.cloneNode(true);
    shipped.querySelectorAll('#fs-test-suite,#fs-test-prelude,#fs-test-results').forEach(function(node){ node.remove(); });
    const source = shipped.outerHTML;
    assert(!/RD Science/i.test(source), 'index.html มีป้าย RD Science ฝังอยู่');
    assert(!/science[_-]?case|scienceWorkspace|escalation/i.test(source.replace(/SCIENCE_WORKSPACE_API_ORIGIN/g,'')),
      'index.html มีคำเฉพาะของงาน Science ฝังอยู่');
  });

  test('ไม่ได้ตั้งค่า origin = ไม่ส่ง request และไม่แตะ DOM เลย', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = '';
    const before = domFingerprint();

    await mountPrivateWorkspace();

    equal(window.__fetchCalls.length, 0, 'ยิง request ทั้งที่ยังไม่ได้ตั้งค่า');
    equal(domFingerprint(), before, 'DOM ของเดิมเปลี่ยนไป');
    equal(document.getElementById('pwsNav'), null, 'สร้างปุ่มทั้งที่ปิดอยู่');
    equal(document.getElementById('pwsPanel'), null, 'สร้าง panel ทั้งที่ปิดอยู่');
  });

  test('local-only mode ไม่ส่ง manifest request', async function(){
    reset();
    SB_URL = ''; SB_KEY = '';
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    authSession = null;
    await mountPrivateWorkspace();
    equal(window.__fetchCalls.length, 0, 'local-only mode ยังยิง request');
  });

  test('origin ที่ไม่ใช่ HTTPS หรือไม่ใช่ origin เปล่า ๆ ถูกปฏิเสธก่อนยิง request', async function(){
    for(const bad of ['http://opc.example.test','https://opc.example.test/path','https://*.example.test',
                      'https://user:pw@opc.example.test','opc.example.test','javascript:alert(1)']){
      reset();
      workspaceSession();
      SCIENCE_WORKSPACE_API_ORIGIN = bad;
      await mountPrivateWorkspace();
      equal(window.__fetchCalls.length, 0, 'ยอมรับ origin ที่ไม่ปลอดภัย: ' + bad);
      equal(document.getElementById('pwsNav'), null, 'สร้างปุ่มจาก origin ที่ไม่ปลอดภัย: ' + bad);
    }
  });

  test('ผู้ไม่มีสิทธิ์ไม่เห็นปุ่ม ไม่เห็น panel และไม่มีอะไรเหลือในเครื่อง', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    const before = domFingerprint();
    // เซิร์ฟเวอร์ตอบ 404 เปล่า ๆ เหมือนไม่มีอะไรอยู่ตรงนั้นเลย
    window.__fetchQueue.push(window.__mockResponse(404, {error:'NOT_FOUND'}));

    await mountPrivateWorkspace();

    equal(document.getElementById('pwsNav'), null, 'ผู้ไม่มีสิทธิ์ได้ปุ่ม');
    equal(document.getElementById('pwsPanel'), null, 'ผู้ไม่มีสิทธิ์ได้ panel');
    equal(domFingerprint(), before, 'DOM ของเดิมเปลี่ยนไปสำหรับผู้ไม่มีสิทธิ์');
    equal(window.__fetchCalls.length, 1, 'ควรถาม manifest ครั้งเดียวแล้วหยุด');
    // ห้ามดึง bundle ต่อ
    assert(!window.__fetchCalls.some(c=>c.url.includes('/bundle')), 'ผู้ไม่มีสิทธิ์ยังไปดึง bundle');
    // ห้ามทิ้งร่องรอยใน localStorage
    assert(!Object.keys(localStorage).some(k=>/pws|science|workspace/i.test(k)), 'มี key ค้างใน localStorage');
  });

  function deferred(){
    let resolve;
    const promise = new Promise(r=>{ resolve=r; });
    return {promise, resolve};
  }
  function allowWorkspace(mode='workspace'){
    return window.__mockResponse(200, {allowed:true,label:'Private test',
      bundleUrl:'/bundle',version:'1',mode});
  }
  function prepareWorkspace(){
    reset(); workspaceSession(); SCIENCE_WORKSPACE_API_ORIGIN='https://opc.example.test';
  }

  test('denied roles, inactive and missing membership make zero requests and preserve exact DOM', async function(){
    for(const role of ['sales','opc','crm','monitor','pd','mkt','marketing','purchasing','unknown','toString','']){
      prepareWorkspace(); authMembership.role=role;
      const before=domFingerprint();
      await mountPrivateWorkspace();
      equal(window.__fetchCalls.length,0,'request for denied role '+role);
      equal(domFingerprint(),before,'DOM changed for '+role);
    }
    for(const membership of [null,{role:'rd',active:false},{role:'rd',active:true},
      {role:'rd',active:true,user_id:'different-user'}]){
      prepareWorkspace(); authMembership=membership;
      const before=domFingerprint();
      await mountPrivateWorkspace();
      equal(window.__fetchCalls.length,0,'request without active membership');
      equal(domFingerprint(),before,'DOM changed without active membership');
    }
  });

  test('logout during manifest response, manifest body or bundle body cannot recreate workspace', async function(){
    for(const stage of ['response','manifest','bundle']){
      prepareWorkspace(); const before=domFingerprint();
      const entered=deferred(), release=deferred();
      if(stage==='response') window.__fetchQueue.push(()=>{entered.resolve(); return release.promise;});
      else if(stage==='manifest') window.__fetchQueue.push({ok:true,json:()=>{entered.resolve();return release.promise;}});
      else {
        window.__fetchQueue.push(allowWorkspace());
        window.__fetchQueue.push({ok:true,text:()=>{entered.resolve();return release.promise;}});
      }
      const pending=mountPrivateWorkspace(); await entered.promise;
      authClearSession();
      release.resolve(stage==='response'?allowWorkspace():stage==='manifest'?
        {allowed:true,label:'Private test',bundleUrl:'/bundle',version:'1',mode:'workspace'}:
        'export function mount(host){host.textContent="late";}');
      await pending;
      equal(pwsState,null,'late state at '+stage);
      equal(domFingerprint(),before,'late DOM at '+stage);
      equal(window.__fetchCalls.length,stage==='bundle'?2:1,'extra request after logout');
      assert(window.__fetchCalls[0].options.signal.aborted,'request was not aborted');
    }
  });

  test('logout while async mount is pending destroys the late handle and listener', async function(){
    prepareWorkspace(); const before=domFingerprint();
    window.__lateMountEntered=deferred(); window.__lateMountRelease=deferred();
    window.__lateHandleDestroyed=0; window.__lateEventCount=0;
    window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200, `export async function mount(host){
      const listener=()=>window.__lateEventCount++;
      window.addEventListener('private-test-event',listener);
      window.__lateMountEntered.resolve(); await window.__lateMountRelease.promise;
      return {destroy(){window.__lateHandleDestroyed++;window.removeEventListener('private-test-event',listener);}};
    }`));
    const pending=mountPrivateWorkspace(); await window.__lateMountEntered.promise;
    authClearSession(); window.__lateMountRelease.resolve(); await pending;
    window.dispatchEvent(new Event('private-test-event'));
    equal(window.__lateHandleDestroyed,1,'late handle not destroyed once');
    equal(window.__lateEventCount,0,'late listener retained');
    equal(pwsState,null,'late handle retained'); equal(domFingerprint(),before,'late DOM retained');
  });

  test('logout during module import cannot call mount or attach its handle', async function(){
    prepareWorkspace();const before=domFingerprint();
    window.__importEntered=deferred();window.__importRelease=deferred();window.__importMounts=0;
    window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200, `
      window.__importEntered.resolve();await window.__importRelease.promise;
      export function mount(){window.__importMounts++;return {destroy(){}};}
    `));
    const pending=mountPrivateWorkspace();await window.__importEntered.promise;
    authClearSession();window.__importRelease.resolve();await pending;
    equal(window.__importMounts,0,'stale module called mount');
    equal(pwsState,null,'stale import retained state');equal(domFingerprint(),before,'stale import changed DOM');
  });

  test('mounted workspace is replaced on token or identity change despite equal version and mode', async function(){
    for(const change of [()=>authSession.access_token='next-token',()=>{authSession.user.id='next-user';authMembership.user_id='next-user';}]){
      prepareWorkspace();window.__replacedDestroyed=0;
      window.__fetchQueue.push(allowWorkspace());
      window.__fetchQueue.push(window.__mockResponse(200,'export function mount(){return {destroy(){window.__replacedDestroyed++;}};}'));
      await mountPrivateWorkspace();const old=pwsState;change();
      window.__fetchQueue.push(allowWorkspace());
      window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host){host.textContent="new context";}'));
      await mountPrivateWorkspace();
      assert(pwsState!==old,'stale same-version state reused');
      equal(window.__replacedDestroyed,1,'old handle not removed');
      equal(pwsState.panelEl.textContent,'new context','new identity not rendered');
    }
  });

  test('session storage update immediately withdraws the mounted workspace', async function(){
    prepareWorkspace();window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(){return {destroy(){}};}'));
    await mountPrivateWorkspace();assert(pwsState,'setup failed');
    authStoreSession({...authSession,access_token:'refreshed-token'});
    equal(pwsState,null,'token update retained workspace');
    equal(document.getElementById('pwsPanel'),null,'token update retained panel');
    clearTimeout(authRefreshTimer);
  });

  test('older denied response cannot tear down a newer identity workspace', async function(){
    prepareWorkspace(); const entered=deferred(),release=deferred();
    window.__fetchQueue.push(()=>{entered.resolve();return release.promise;});
    const old=mountPrivateWorkspace(); await entered.promise;
    authSession={...authSession,access_token:'new-token',user:{...authSession.user,id:'66666666-6666-6666-6666-666666666666'}};
    authMembership={...authMembership,user_id:authSession.user.id};
    window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host){host.textContent="new identity";}'));
    await mountPrivateWorkspace();
    const state=pwsState; assert(state,'new identity did not mount');
    release.resolve(window.__mockResponse(403,{})); await old;
    equal(pwsState,state,'older denial tore down newer state');
    equal(state.panelEl.textContent,'new identity','wrong identity rendered');
  });

  test('older network rejection cannot remove a newer workspace', async function(){
    prepareWorkspace();const entered=deferred();let rejectOld;
    window.__fetchQueue.push(()=>{entered.resolve();return new Promise((resolve,reject)=>{rejectOld=reject;});});
    const old=mountPrivateWorkspace();await entered.promise;
    authSession.access_token='new-token';
    window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host){host.textContent="current";}'));
    await mountPrivateWorkspace();const state=pwsState;
    rejectOld(new Error('synthetic old failure'));await old;
    equal(pwsState,state,'old catch removed new workspace');
    equal(state.panelEl.textContent,'current','new workspace changed');
  });

  test('eligible roles still require server permission before fetching a bundle', async function(){
    for(const role of ['rd','ra','admin']){
      prepareWorkspace();authMembership.role=role;const before=domFingerprint();
      window.__fetchQueue.push(window.__mockResponse(403,{}));await mountPrivateWorkspace();
      equal(window.__fetchCalls.length,1,'did not stop after server denial for '+role);
      equal(domFingerprint(),before,'server denied role changed DOM');
    }
  });

  test('token, identity, membership, origin and local-mode changes fence pending bundle results', async function(){
    for(const change of [()=>authSession.access_token='replacement',()=>authSession.user.id='replacement',
      ()=>authMembership.role='ra',()=>authMembership.active=false,()=>{SB_URL='';SB_KEY='';},
      ()=>SCIENCE_WORKSPACE_API_ORIGIN='https://other.example.test']){
      prepareWorkspace(); const entered=deferred(),release=deferred();
      window.__fetchQueue.push(allowWorkspace());
      window.__fetchQueue.push({ok:true,text:()=>{entered.resolve();return release.promise;}});
      const pending=mountPrivateWorkspace();await entered.promise;change();
      release.resolve('export function mount(host){host.textContent="stale";}');await pending;
      equal(pwsState,null,'changed context retained stale state');
      equal(document.getElementById('pwsPanel'),null,'changed context created panel');
    }
  });

  test('mode change replaces the old handle even when version stays the same', async function(){
    prepareWorkspace();window.__oldModeDestroyed=0;
    window.__fetchQueue.push(allowWorkspace('first'));
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(){return {destroy(){window.__oldModeDestroyed++;}};}'));
    await mountPrivateWorkspace();const old=pwsState;
    window.__fetchQueue.push(allowWorkspace('second'));
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host,{mode}){host.textContent=mode;}'));
    await mountPrivateWorkspace();
    assert(pwsState!==old,'old mode reused');equal(window.__oldModeDestroyed,1,'old mode not destroyed');
    equal(pwsState.panelEl.textContent,'second','wrong mode');
  });

  test('bundle request transport confines origin, captures auth, and expires with its workspace', async function(){
    prepareWorkspace();window.__privateRequest=null;
    window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host,options){window.__privateRequest=options.request;return {destroy(){}};}'));
    await mountPrivateWorkspace();assert(typeof window.__privateRequest==='function','missing transport');
    const request=window.__privateRequest;
    window.__fetchQueue.push(window.__mockResponse(200,{value:'ok'}));
    const result=await request('/api/private-workspaces/test',{method:'POST',body:{question:'synthetic'}});
    equal(result.value,'ok','response missing');
    const call=window.__fetchCalls[2];
    equal(call.options.headers.Authorization,'Bearer ws-token','wrong bearer');
    equal(call.options.credentials,'omit','credentials attached');
    equal(call.options.cache,'no-store','cache allowed');
    equal(call.options.redirect,'error','redirect allowed');
    equal(JSON.parse(call.options.body).question,'synthetic','body changed');
    for(const path of ['https://evil.test/x','//evil.test/x','/api/other','/api/private-workspaces/../../other']){
      let denied=false;try{await request(path);}catch(err){denied=true;}
      assert(denied,'unsafe path accepted');
    }
    equal(window.__fetchCalls.length,3,'unsafe path requested');
    authClearSession();let denied=false;try{await request('/api/private-workspaces/test');}catch(err){denied=true;}
    assert(denied,'stale transport accepted');equal(window.__fetchCalls.length,3,'stale transport requested');
  });

  test('late transport JSON is discarded and denied status withdraws its own workspace', async function(){
    prepareWorkspace();window.__privateRequest=null;
    window.__fetchQueue.push(allowWorkspace());
    window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host,options){window.__privateRequest=options.request;return {destroy(){}};}'));
    await mountPrivateWorkspace();assert(window.__privateRequest,'missing transport');
    const entered=deferred(),release=deferred();
    window.__fetchQueue.push({ok:true,status:200,json:()=>{entered.resolve();return release.promise;}});
    const pending=window.__privateRequest('/api/private-workspaces/test').then(()=>false,()=>true);
    await entered.promise;authClearSession();release.resolve({private:'old'});
    assert(await pending,'stale JSON released');
    for(const status of [401,403,404]){
      prepareWorkspace();window.__fetchQueue.push(allowWorkspace());
      window.__fetchQueue.push(window.__mockResponse(200,'export function mount(host,options){window.__privateRequest=options.request;return {destroy(){}};}'));
      await mountPrivateWorkspace();window.__fetchQueue.push(window.__mockResponse(status,{}));
      let denied=false;try{await window.__privateRequest('/api/private-workspaces/test');}catch(err){denied=true;}
      assert(denied,'denial accepted');equal(pwsState,null,'denial retained workspace: '+status);
    }
  });

  test('manifest request ใช้ bearer token ของผู้ใช้ ไม่ส่ง cookie และไม่ cache', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    window.__fetchQueue.push(window.__mockResponse(404, {error:'NOT_FOUND'}));

    await mountPrivateWorkspace();

    const call = window.__fetchCalls[0];
    assert(call.url.startsWith('https://opc.example.test/'), 'ยิงผิด origin: ' + call.url);
    equal(call.options.headers.Authorization, 'Bearer ws-token', 'ไม่ได้ใช้ token ของผู้ใช้');
    equal(call.options.credentials, 'omit', 'ยังแนบ credential ไปด้วย');
    equal(call.options.cache, 'no-store', 'ยอมให้ cache คำตอบส่วนตัว');
  });

  test('ผู้มีสิทธิ์ได้ปุ่มกับ panel ใหม่ โดยของเดิมยังอยู่ครบเท่าเดิม', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    const navBefore = [...document.querySelectorAll('.side-item')].map(el=>el.textContent.trim());

    window.__fetchQueue.push(window.__mockResponse(200, {
      allowed:true, label:'RD Science', bundleUrl:'/api/private-workspaces/formula/bundle',
      version:'1', mode:'workspace'
    }));
    window.__fetchQueue.push(window.__mockResponse(200,
      'export function mount(host){ host.textContent = "workspace ready"; }'));

    await mountPrivateWorkspace();

    const nav = document.getElementById('pwsNav');
    assert(nav, 'ผู้มีสิทธิ์ไม่ได้ปุ่ม');
    equal(nav.textContent, 'RD Science', 'ป้ายปุ่มไม่ได้มาจาก manifest');
    assert(document.getElementById('pwsPanel'), 'ไม่มี panel');

    // ปุ่มเดิมทุกปุ่มยังอยู่ครบและข้อความไม่เปลี่ยน
    const navAfter = [...document.querySelectorAll('.side-item')].map(el=>el.textContent.trim());
    navBefore.forEach(function(label){
      assert(navAfter.includes(label), 'ปุ่มเดิมหายไป: ' + label);
    });
  });

  test('ป้ายจากเซิร์ฟเวอร์ถูกใส่ด้วย textContent ไม่ใช่ HTML', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    window.__fetchQueue.push(window.__mockResponse(200, {
      allowed:true, label:'<img src=x onerror="window.__pwsXss=1">', 
      bundleUrl:'/api/private-workspaces/formula/bundle', version:'1', mode:'workspace'
    }));
    window.__fetchQueue.push(window.__mockResponse(200, 'export function mount(){}'));

    await mountPrivateWorkspace();

    const nav = document.getElementById('pwsNav');
    assert(nav, 'ไม่ได้สร้างปุ่ม');
    equal(nav.querySelector('img'), null, 'ป้ายจากเซิร์ฟเวอร์ถูก render เป็น HTML');
    equal(window.__pwsXss, undefined, 'สคริปต์จากป้ายทำงานได้');
  });

  test('bundleUrl ที่ชี้ออกนอก origin ที่อนุมัติถูกปฏิเสธ', async function(){
    for(const bad of ['https://evil.test/bundle.js','http://opc.example.test/bundle.js',
                      'javascript:alert(1)','//evil.test/x.js']){
      reset();
      workspaceSession();
      SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
      window.__fetchQueue.push(window.__mockResponse(200, {
        allowed:true, label:'RD Science', bundleUrl:bad, version:'1', mode:'workspace'
      }));
      await mountPrivateWorkspace();
      equal(document.getElementById('pwsNav'), null, 'ยอมรับ bundleUrl อันตราย: ' + bad);
      assert(!window.__fetchCalls.some(c=>c.url.includes('evil.test')), 'ยิงไปที่ ' + bad);
    }
  });

  test('ออกจากระบบแล้วต้องถอนปุ่ม panel และ Blob URL ให้หมด', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    const before = domFingerprint();
    window.__fetchQueue.push(window.__mockResponse(200, {
      allowed:true, label:'RD Science', bundleUrl:'/api/private-workspaces/formula/bundle',
      version:'1', mode:'workspace'
    }));
    window.__fetchQueue.push(window.__mockResponse(200, 'export function mount(){}'));
    await mountPrivateWorkspace();
    assert(document.getElementById('pwsNav'), 'setup: ไม่ได้ mount');

    authClearSession();

    equal(document.getElementById('pwsNav'), null, 'ปุ่มยังอยู่หลังออกจากระบบ');
    equal(document.getElementById('pwsPanel'), null, 'panel ยังอยู่หลังออกจากระบบ');
    equal(domFingerprint(), before, 'DOM ไม่กลับไปเหมือนเดิมหลังออกจากระบบ');
  });

  test('membership หายหรือ role เปลี่ยน = ถอนออกทันที', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    window.__fetchQueue.push(window.__mockResponse(200, {
      allowed:true, label:'RD Science', bundleUrl:'/api/private-workspaces/formula/bundle',
      version:'1', mode:'workspace'
    }));
    window.__fetchQueue.push(window.__mockResponse(200, 'export function mount(){}'));
    await mountPrivateWorkspace();
    assert(document.getElementById('pwsNav'), 'setup: ไม่ได้ mount');

    // เซิร์ฟเวอร์เปลี่ยนใจ: รอบถัดไปตอบ 404
    window.__fetchQueue.push(window.__mockResponse(404, {error:'NOT_FOUND'}));
    await mountPrivateWorkspace();

    equal(document.getElementById('pwsNav'), null, 'สิทธิ์หายแล้วปุ่มยังอยู่');
    equal(document.getElementById('pwsPanel'), null, 'สิทธิ์หายแล้ว panel ยังอยู่');
  });

  test('switchView ของเดิมยังทำงานเหมือนเดิมเมื่อมี panel ใหม่อยู่', async function(){
    reset();
    workspaceSession();
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://opc.example.test';
    window.__fetchQueue.push(window.__mockResponse(200, {
      allowed:true, label:'RD Science', bundleUrl:'/api/private-workspaces/formula/bundle',
      version:'1', mode:'workspace'
    }));
    window.__fetchQueue.push(window.__mockResponse(200, 'export function mount(){}'));
    await mountPrivateWorkspace();

    // repo นี้ใช้ class 'on' เป็นตัวบอกว่า view ไหนเปิดอยู่ ไม่ใช่ attribute hidden
    switchView('dash');
    const panel = document.getElementById('pwsPanel');
    assert(panel && !panel.classList.contains('on'), 'เปลี่ยนไปหน้าอื่นแล้ว panel ใหม่ยังโชว์อยู่');
    const dash = document.getElementById('dashView');
    assert(dash && dash.classList.contains('on'), 'หน้าเดิมเปิดไม่ได้เมื่อมี panel ใหม่');

    // แล้วกดกลับเข้า workspace ต้องเปิดได้จริง ไม่ใช่ตกไปหน้า Customer Data
    switchView('pws');
    assert(panel.classList.contains('on'), 'กดปุ่ม workspace แล้วไม่เปิด');
    const input = document.getElementById('inputView');
    assert(input && !input.classList.contains('on'), 'กดปุ่ม workspace แล้วตกไปหน้าเดิม');
  });

  test('secure mode never offers first-Admin browser creation', function(){
    reset();
    authChecking = false;
    renderLoginView();
    const body = document.getElementById('loginBody').textContent;
    assert(!body.includes('สร้างผู้ใช้ Admin คนแรก'), 'secure login offered browser Admin creation');
    assert(body.includes('อีเมล'), 'secure login did not request Auth email');
  });

  test('secure user management is Dashboard-owned and has no local reset controls', function(){
    reset();
    authSession = {access_token:'admin-token'};
    authMembership = {name:'Admin Owner',role:'admin',active:true};
    currentUser = 'Admin Owner';
    userList = [{name:'Admin Owner',role:'admin',email:'admin@example.test',pass:null}];
    renderUserList();
    const html = document.getElementById('userListWrap').innerHTML;
    assert(html.includes('Supabase Dashboard'), 'Dashboard ownership guidance is missing');
    assert(!/resetUserPassword|resetAllPasswords|seedTeamUsers|loginUserAt/.test(html), 'legacy account control remains active');
  });

  test('secure reconciliation preserves offline changes and merges remote additions', function(){
    reset();
    authSession = {access_token:'member-token'};
    authMembership = {name:'Sales One',role:'sales',active:true};
    currentUser = 'Sales One';
    const baseline = {id:'A00001',customer:'Before',createdBy:'Sales One'};
    const changed = {id:'A00001',customer:'Offline edit',createdBy:'Sales One'};
    records = [changed,{id:'A00003',customer:'Offline new',createdBy:'Sales One'}];
    chats=[]; userList=[]; activities=[]; recCounter=3;
    sbSnap = {records:{A00001:JSON.stringify(baseline)},chats:{},users:{},acts:{},counter:1};
    sbApply({
      records:[baseline,{id:'A00002',customer:'Remote new',createdBy:'Sales Two'}],
      chats:[],users:[],acts:[],counter:2,empty:false
    });
    equal(records.find(r=>r.id==='A00001').customer, 'Offline edit', 'offline edit was overwritten');
    assert(records.some(r=>r.id==='A00002'), 'remote addition was not merged');
    assert(records.some(r=>r.id==='A00003'), 'offline addition was lost');
    equal(recCounter, 3, 'record counter moved backward');
  });

  test('secure Chat event outbox flushes through the RPC and clears only after success', async function(){
    reset();
    authSession = {access_token:'member-token'};
    authMembership = {name:'Sales One',role:'sales',active:true};
    currentUser = 'Sales One';
    records=[{id:'A00001',customer:'Synthetic',createdBy:'Sales One'}];
    sbConfirmRecords(records,true);
    window.__fetchQueue.push(window.__mockResponse(200, {
      version:1,type:'message',actor:'Sales One',ts:1,text:'hello',event_id:'evt-1'
    }));
    queueChatEvent('A00001', {type:'message',text:'hello'}, 'evt-1');
    equal(chatEventOutbox.length, 1, 'Chat event was not queued');
    await sbPushChatEvents();
    const call = window.__fetchCalls[0];
    assert(call.url.endsWith('/rest/v1/rpc/fs_append_chat_event'), 'Chat did not use append RPC');
    const body = JSON.parse(call.options.body);
    equal(body.p_event_id, 'evt-1', 'event id was not sent');
    equal(body.p_job_id, 'A00001', 'job id was not sent');
    equal(body.p_payload.text, 'hello', 'message text was changed');
    equal(chatEventOutbox.length, 0, 'successful Chat event remained queued');
  });

  test('secure Chat sync never direct-upserts the legacy fs_chats row', async function(){
    reset();
    authSession = {access_token:'member-token'};
    authMembership = {name:'Sales One',role:'sales',active:true};
    currentUser = 'Sales One';
    records=[]; userList=[]; activities=[]; recCounter=0; chats=[{jobId:'A00001',messages:[{type:'msg',user:'Sales One',text:'local',ts:2}],parts:[],approvals:{}}];
    sbSnap = {records:{},chats:{A00001:JSON.stringify({jobId:'A00001',messages:[]})},users:{},acts:{},counter:0};
    const pushed = await sbPush();
    equal(pushed, false, 'legacy Chat row was treated as a direct sync change');
    assert(!window.__fetchCalls.some(call=>call.url.includes('/fs_chats')), 'secure mode used direct fs_chats REST write');
  });

  test('formula edits invalidate all existing Chat approvals locally', function(){
    reset();
    SB_URL=''; SB_KEY='';
    currentUser='PD One';
    userList=[{name:'PD One',role:'pd'}];
    const record={id:'A00001',rows:[]};
    records=[record];
    chats=[{jobId:'A00001',messages:[],parts:[],approvals:{pd:{by:'PD One'},ra:{by:'RA One'},rd:{by:'RD One'},sales:{by:'Sales One'}}}];
    invalidateChatApprovals(getChat('A00001'));
    assert(CHAT_PARTS.every(part=>!getChat('A00001').approvals[part.key]), 'formula edit retained an old approval');
  });

  test('displayed sync errors redact tokens and credentials', function(){
    reset();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-test';
    const clean = safeError(`Bearer ${jwt} refresh_token=refresh-secret sb_publishable_leak`);
    assert(!clean.includes(jwt), 'JWT leaked into displayed error');
    assert(!clean.includes('refresh-secret'), 'refresh token leaked into displayed error');
    assert(!clean.includes('sb_publishable_leak'), 'publishable key leaked into displayed error');
  });

  test('membership role remains authoritative over legacy user JSON', function(){
    reset();
    authMembership = {name:'Sales One',role:'sales',active:true};
    currentUser = 'Sales One';
    userList = [{name:'Sales One',role:'admin',email:'sales@example.test',pass:null}];
    equal(currentRole(), 'sales', 'legacy JSON escalated the authenticated membership role');
  });

  test('user-entered tags and ingredient rows cannot inject HTML', function(){
    reset();
    SB_URL=''; SB_KEY='';
    const tagInput=document.getElementById('ti_claims');
    tagInput.value='<img src=x onerror="window.__xss=1">';
    addTag({key:'Enter',preventDefault:function(){}},'tc_claims','ti_claims');
    assert(!document.querySelector('#tc_claims img'), 'tag input created executable HTML');
    document.getElementById('ingBody').innerHTML='';
    const payload='"><img src=x onerror="window.__xss=2">';
    addRow({name:payload,w:1,o:payload,p:100,note:payload});
    assert(!document.querySelector('#ingBody img'), 'ingredient input created executable HTML');
    equal(document.querySelector('#ingBody input').value,payload,'ingredient value was not preserved as text');
  });

  test('stored record rendering escapes user-controlled dashboard fields', function(){
    reset();
    SB_URL=''; SB_KEY='';
    const payload='<img src=x onerror="window.__xss=3">';
    renderDashboard({
      id:'A00001',createdBy:payload,date:payload,metaDate:payload,
      brand:payload,customer:payload,form:payload,size:'1',sizeUnit:payload,uw:'1',uwUnit:payload,
      conceptStr:payload,allConcepts:[payload],allBenefits:[payload],allSP:[payload],
      finalTarget:payload,gender:payload,price:payload,notes:payload,cons:[payload],
      rows:[{num:1,name:payload,w:1,o:payload,p:100,actual:1,note:payload,hero:true,
        fda:{cls:'fda-unknown',icon:'⚪',tip:payload,status:'unknown'}}]
    });
    assert(!document.querySelector('#dashContent img'), 'stored record created executable dashboard HTML');
    assert(document.getElementById('d_title').textContent.includes('<img'), 'stored text was not preserved');
  });

  // ---------- Content-Security-Policy ของหน้า (QA3 I3) ----------
  // bundle ถูก import() เข้ามารันใน origin เดียวกับ Formula จึงอ่าน
  // sessionStorage.fs_auth_session ได้ · CSP กันไม่ได้ว่าอ่าน แต่กันได้ว่าส่งออกไปไหน

  function cspMeta(){ return document.querySelector('meta[http-equiv="Content-Security-Policy"]'); }

  test('หน้ามี CSP ที่ยังมีความหมาย ไม่มี unsafe-eval และไม่มี wildcard', function(){
    const meta = cspMeta();
    assert(meta, 'หน้าไม่มี Content-Security-Policy เลย');
    const csp = meta.getAttribute('content');
    assert(!/unsafe-eval/.test(csp), 'CSP ยอมให้ eval ได้');
    assert(!/script-src[^;]*\s\*(\s|;|$)/.test(csp), 'script-src เป็น wildcard');
    assert(!/connect-src[^;]*\s\*(\s|;|$)/.test(csp), 'connect-src เป็น wildcard');
    assert(/object-src 'none'/.test(csp), 'CSP ไม่ได้ปิด object-src');
    assert(/base-uri 'none'/.test(csp), 'CSP ไม่ได้ปิด base-uri');
    assert(/connect-src /.test(csp), 'CSP ไม่ได้จำกัดปลายทางของ request');
  });

  test('connect-src ยอมเฉพาะ origin ที่ประกาศไว้', function(){
    assert(pwsCspAllowsConnect('https://opc.example.test'), 'origin ที่ประกาศไว้กลับถูกปฏิเสธ');
    assert(!pwsCspAllowsConnect('https://evil.test'), 'origin ที่ไม่ได้ประกาศกลับผ่าน');
    assert(!pwsCspAllowsConnect('http://opc.example.test'), 'ยอมรับ origin ที่ไม่ใช่ HTTPS');
    assert(!pwsCspAllowsConnect('not a url'), 'ยอมรับค่าที่ไม่ใช่ URL');
  });

  test('wildcard host ใน connect-src ต้องแมตช์เฉพาะ subdomain จริง', function(){
    // นโยบายที่ส่งขึ้นจริงปักหมุด host เต็ม ๆ ไม่มี wildcard · เทสต์นี้จึงสลับ
    // นโยบายชั่วคราวเพื่อพิสูจน์ตัวแยกวิเคราะห์ ไม่ใช่เพื่อรับรอง wildcard ในของจริง
    const meta = cspMeta();
    const saved = meta.getAttribute('content');
    try{
      meta.setAttribute('content', "connect-src 'self' https://*.supabase.co");
      assert(pwsCspAllowsConnect('https://uumk.supabase.co'), 'subdomain ที่ถูกต้องกลับถูกปฏิเสธ');
      assert(!pwsCspAllowsConnect('https://supabase.co'), 'โดเมนแม่ผ่าน wildcard ได้');
      assert(!pwsCspAllowsConnect('https://evil-supabase.co'), 'โดเมนที่แค่ลงท้ายคล้ายกันผ่านได้');
      assert(!pwsCspAllowsConnect('https://supabase.co.evil.test'), 'suffix ถูกใช้เป็น prefix ได้');
    }finally{
      meta.setAttribute('content', saved);
    }
  });

  test('นโยบายที่ส่งขึ้นจริงต้องปักหมุด Supabase host ไม่ใช่ wildcard', function(){
    // wildcard จะเปิดให้ bundle ส่ง access token ไป project อื่นของ Supabase ได้
    const csp = cspMeta().getAttribute('content');
    const connect = (csp.split(';').find(function(part){ return part.trim().startsWith('connect-src'); }) || '');
    assert(!/\*\.supabase\.co/.test(connect), 'connect-src ยังเปิดกว้างให้ทุก project ของ Supabase');
  });

  test('ไม่มี CSP ให้ตรวจ = ปฏิเสธไว้ก่อน', function(){
    const meta = cspMeta();
    const saved = meta.getAttribute('content');
    try{
      meta.setAttribute('content', "default-src 'self'");
      equal(pwsCspConnectSrc(), null, 'ไม่มี connect-src แต่ยังตอบว่ารู้');
      assert(!pwsCspAllowsConnect('https://opc.example.test'), 'ไม่มี connect-src แต่กลับปล่อยผ่าน');
    }finally{
      meta.setAttribute('content', saved);
    }
  });

  test('origin ที่ CSP ไม่อนุญาต ต้องไม่ mount และไม่ยิง request', async function(){
    reset();
    workspaceSession();
    // origin นี้ถูกต้องตามกฎ HTTPS ทุกข้อ ต่างกันแค่ไม่ได้อยู่ใน connect-src
    SCIENCE_WORKSPACE_API_ORIGIN = 'https://evil.test';
    const before = domFingerprint();

    equal(pwsApprovedOrigin(), '', 'origin นอก CSP ผ่าน preflight ไปได้');
    await mountPrivateWorkspace();

    equal(window.__fetchCalls.length, 0, 'ยิง request ไป origin ที่ CSP บล็อกอยู่ดี');
    equal(domFingerprint(), before, 'DOM ของเดิมเปลี่ยนไป');
    equal(document.getElementById('pwsNav'), null, 'สร้างปุ่มทั้งที่ mount ไม่ได้');
  });


  // ===== PD Modify save integrity (pd-save-integrity-2026-11-06) · synthetic data only =====
  function pdJob(){
    return {id:'A00091',customer:'Synthetic job',brand:'Brand One',createdBy:'Sales One',salesOwner:'Sales One',
      createdAt:1000,notes:'before',conceptStr:'c',totW:15,totA:15,heroes:[],fda:{notApproved:[],overLimit:[],unknown:[],allOk:true},allConcepts:[],allBenefits:[],allSP:[],benefits:[],cons:[],
      rows:[{num:1,name:'Aqua',w:10,o:'',p:100,actual:10,note:'',hero:false,fda:checkFDA('Aqua',10)},
            {num:2,name:'Glycerin',w:5,o:'',p:100,actual:5,note:'',hero:false,fda:checkFDA('Glycerin',5)}]};
  }
  function pdSession(r){
    reset();
    authSession={access_token:'synthetic-pd-token',user:{id:'synthetic-pd'}};
    authMembership={name:'PD One',role:'pd',active:true};
    currentUser='PD One'; userList=[{name:'PD One',role:'pd',pass:null}];
    records=[r]; chats=[]; activities=[]; recCounter=91; modifyRec=null; window._lastDash=null;
    sbSnap={records:{[r.id]:JSON.stringify(r)},chats:{},users:{},acts:{},counter:91};
    sbReady=false; sbBusy=false;
    if(typeof saveQReset==='function') saveQReset();
  }
  function pdDone(){ clearTimeout(sbPushTimer); sbReady=false; if(typeof saveQReset==='function') saveQReset(); modifyRec=null; window._lastDash=null; }
  function pullBody(list){
    return [window.__mockResponse(200,list.map(x=>({id:x.id,data:x}))),window.__mockResponse(200,[]),
      window.__mockResponse(200,[]),window.__mockResponse(200,[{key:'reccounter',value:91}]),window.__mockResponse(200,[])];
  }
  function clone(x){ return JSON.parse(JSON.stringify(x)); }

  test('PD Modify: an edit after a background sync is applied onto the fresh server copy, not a stale object', function(){
    const r=pdJob(); pdSession(r);
    try{
      openModifyRecord(r.id);
      // another user edits a non-formula field; sync replaces the unchanged cache object
      const remote=clone(r); remote.brand='Brand Changed By Sales'; remote.rows[1].name='Glycerin Remote';
      sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
      assert(records[0]!==r,'fixture: sync did not replace the cached object');
      modifyIngs[0].name='Aqua PD Edit'; editIng(0,'name','Aqua PD Edit');
      equal(records.length,1);
      equal(records[0].rows[0].name,'Aqua PD Edit','PD edit missing');
      equal(records[0].brand,'Brand Changed By Sales','stale object clobbered the newer server field');
      equal(records[0].rows[1].name,'Glycerin Remote','stale object clobbered another row from the server');
      equal(modifyRec,records[0],'modifyRec is still an orphan');
    }finally{ pdDone(); }
  });
  test('PD Modify: note save and add/remove row also act on the fresh copy', function(){
    const r=pdJob(); pdSession(r);
    const oldConfirm=window.confirm; window.confirm=function(){ return true; };
    try{
      openModifyRecord(r.id);
      const remote=clone(r); remote.brand='Brand Changed By Sales';
      sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
      document.getElementById('modNote').value='note from PD';
      saveModNote();
      equal(records[0].brand,'Brand Changed By Sales','saveModNote clobbered newer field');
      equal(records[0].modNote.text,'note from PD');
      const remote2=clone(records[0]); remote2.customer='Customer Changed';
      sbSnap.records[r.id]=JSON.stringify(records[0]);
      sbApply({records:[remote2],chats:[],users:[],acts:[],counter:91});
      addModifyIng();
      equal(records[0].customer,'Customer Changed','addModifyIng clobbered newer field');
      equal(records[0].rows.length,3);
      delModifyIng(2);
      equal(records[0].customer,'Customer Changed','delModifyIng clobbered newer field');
      equal(records[0].rows.length,2);
    }finally{ window.confirm=oldConfirm; pdDone(); }
  });
  test('saveRecordsStore reports a localStorage quota failure instead of swallowing it', function(){
    reset(); records=[pdJob()];
    const proto=Object.getPrototypeOf(localStorage), real=proto.setItem;
    proto.setItem=function(k,v){ if(k==='fs_records'){ const e=new Error('quota'); e.name='QuotaExceededError'; throw e; } return real.call(this,k,v); };
    try{
      equal(saveRecordsStore(),false,'quota failure was reported as success');
      assert(lastStoreError,'no error recorded for the UI');
    }finally{ proto.setItem=real; }
    equal(saveRecordsStore(),true,'normal write not reported as success');
    equal(lastStoreError,'','error not cleared after a good write');
  });
  test('a cycle requested while another is running is re-run, not dropped', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    try{
      let release; const gate=new Promise(res=>{ release=res; });
      window.__fetchQueue.push(function(){ return gate.then(()=>window.__mockResponse(200,[])); });
      for(let i=0;i<4;i++) window.__fetchQueue.push(window.__mockResponse(200,[]));
      const first=sbCycle();
      await Promise.resolve();
      const before=window.__fetchCalls.length;
      const second=sbCycle();          // arrives while the first is still running
      release();
      await first; await second;
      assert(window.__fetchCalls.length>=before+5,'the requested cycle was dropped (only '+(window.__fetchCalls.length-before)+' extra calls)');
    }finally{ pdDone(); }
  });
  test('sbApply flags a record changed by someone else while a local save is pending (no silent overwrite)', function(){
    const r=pdJob(); pdSession(r);
    try{
      openModifyRecord(r.id);
      modifyIngs[0].name='Local Pending'; editIng(0,'name','Local Pending');   // local edit, not yet on server
      const remote=clone(JSON.parse(sbSnap.records[r.id])); remote.brand='Changed By Sales';
      sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
      assert(sbConflicts && sbConflicts[r.id],'no warning raised for a concurrent server change');
      equal(records[0].rows[0].name,'Local Pending','local edit was dropped');
    }finally{ pdDone(); }
  });
  test('characterization: verified/edited stamps live only in modifyIngs and reset when the job is reopened', function(){
    const r=pdJob(); pdSession(r);
    try{
      openModifyRecord(r.id);
      verifyIng(0);
      assert(modifyIngs[0].verifiedBy==='PD One','stamp not set');
      assert(!JSON.stringify(records[0]).includes('verifiedBy'),'stamp unexpectedly persisted in the record');
      openModifyRecord(r.id);
      equal(modifyIngs[0].verifiedBy,'','stamp survived reopen (behavior changed)');
    }finally{ pdDone(); }
  });


  const PD_KEYS=['rows','rdUpdated','modNote','lastActivityAt','conceptStr','form','size','sizeUnit','uw','uwUnit','cat','subcat',
    'color','scent','flavor','packType','widthCm','lengthCm','finalTarget','gender','price','priority','fdaType','allBenefits','cons','notes','benefits'];
  const sleep=ms=>new Promise(res=>setTimeout(res,ms));
  async function untilIdle(){ for(let i=0;i<300 && saveQPending().length;i++) await sleep(10); }
  function echoPush(call){
    const body=JSON.parse(call.options.body);
    return window.__mockResponse(200,body.map(x=>({id:x.id,data:x.data})));
  }
  // routes by URL so extra calls (activities push, workspace mount) cannot shift the response order
  function queueRouter(gate, guardMap){
    const route=function(call){
      const u=call.url.split('/rest/v1/')[1]||'', m=call.options.method||'GET';
      if(m==='POST' && u.startsWith('fs_records')){
        if(guardMap){   // mirrors supabase/schema.sql fs_guard_record_json for role pd
          const row=JSON.parse(call.options.body)[0], old=guardMap[row.id];
          if(old){
            const bad=Object.keys(Object.assign({},row.data,old)).filter(k=>!PD_KEYS.includes(k) && JSON.stringify(row.data[k])!==JSON.stringify(old[k]));
            if(bad.length) return window.__mockResponse(403,{code:'42501',message:'record mutation exceeds role permission: '+bad.join(',')});
          }
          guardMap[row.id]=clone(row.data);
        }
        const go=()=>echoPush(call);
        return gate?gate.then(go):go();
      }
      if(m==='GET' && u.startsWith('fs_records')) return window.__mockResponse(200,records.map(x=>({id:x.id,data:clone(guardMap&&guardMap[x.id]||x)})));
      if(m==='GET' && u.startsWith('fs_meta')) return window.__mockResponse(200,[{key:'reccounter',value:91}]);
      return window.__mockResponse(200,[]);
    };
    for(let i=0;i<40;i++) window.__fetchQueue.push(route);
  }
  function queueGoodCycle(){ queueRouter(null); }
  function panelText(){ const el=document.getElementById('saveQPanel'); return el&&el.style.display!=='none'?el.textContent:''; }

  test('PD save goes queued -> sending 50% -> server-confirmed 100%, and only PD-writable keys differ from the server copy', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    try{
      openModifyRecord(r.id);
      const serverCopy=clone(r);
      queueGoodCycle();
      modifyIngs[0].w='20.00'; editIng(0,'w','20.00');   // changes the weight total shown on the Dashboard
      const it=saveQMine()[0];
      equal(it.state,'sending','state right after the local write'); equal(it.pct,50);
      assert(panelText().includes('กำลังบันทึก'),'progress popup missing');
      await untilIdle();
      equal(it.state,'confirmed',it.error); equal(it.pct,100);
      assert(panelText().includes('บันทึกสำเร็จ'),'final success text missing: '+panelText());
      const sent=JSON.parse(window.__fetchCalls[0].options.body)[0].data;
      equal(sent.totW,15,'derived total was written into the PD payload'); equal(sent.rows[0].w,20);
      Object.keys(Object.assign({},sent,serverCopy)).forEach(k=>{
        if(JSON.stringify(sent[k])!==JSON.stringify(serverCopy[k])) assert(PD_KEYS.includes(k),'PD payload changes key the server guard rejects: '+k);
      });
    }finally{ pdDone(); }
  });
  test('server rejection leaves the save failed with a retry button; local copy is kept; retry then confirms', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const oldConfirm=window.confirm; let asked=0; window.confirm=function(){ asked++; return false; };
    try{
      openModifyRecord(r.id);
      window.__fetchQueue.push(window.__mockResponse(403,{code:'42501',message:'record mutation exceeds role permission'}));
      editIng(0,'name','Aqua Rejected');
      await untilIdle().catch(()=>{});
      for(let i=0;i<300 && saveQMine()[0].state==='sending';i++) await sleep(10);
      const it=saveQMine()[0];
      equal(it.state,'failed'); assert(it.error.length>0,'no reason shown');
      assert(panelText().includes('บันทึกไม่สำเร็จ - ลองใหม่'),'failure text missing');
      assert(document.querySelector('#saveQPanel button[onclick^="saveQRetry"]'),'retry button missing');
      assert(JSON.parse(localStorage.getItem('fs_records'))[0].rows[0].name==='Aqua Rejected','local copy not kept');
      const viewBefore=((document.querySelector('.view.on')||{}).id||'');
      // failed saves ask before leaving (never trap) and stay on the page when declined
      switchView('dash');
      equal(asked,1,'no confirmation when leaving with a failed save');
      equal(((document.querySelector('.view.on')||{}).id||''),viewBefore,'left the page although declined');
      sbErr='';
      queueGoodCycle();
      saveQRetry(it.seq);
      await untilIdle();
      equal(saveQMine()[0].state,'confirmed','retry did not confirm');
    }finally{ window.confirm=oldConfirm; pdDone(); }
  });
  test('navigation and unload are blocked while a save is unconfirmed, then released', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const oldAlert=window.alert; let alerts=0; window.alert=function(){ alerts++; };
    try{
      openModifyRecord(r.id);
      let release; const gate=new Promise(res=>{ release=res; });
      queueRouter(gate);
      editIng(0,'name','Aqua Slow');
      equal(saveQMine()[0].state,'sending');
      const viewBefore=((document.querySelector('.view.on')||{}).id||'');
      switchView('dash'); assert(alerts>=1,'no warning while sending');
      equal(((document.querySelector('.view.on')||{}).id||''),viewBefore,'view switched during an unconfirmed save');
      backToModifyList(); assert(modifyRec,'back button left the job during an unconfirmed save');
      const ev=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(ev);
      assert(ev.defaultPrevented,'beforeunload not blocked');
      release(); await untilIdle();
      const ev2=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(ev2);
      assert(!ev2.defaultPrevented,'beforeunload still blocked after confirmation');
      backToModifyList(); equal(modifyRec,null,'back button still blocked after confirmation');
    }finally{ window.alert=oldAlert; pdDone(); }
  });
  test('queue shows this user\'s pending jobs with their position', async function(){
    const a=pdJob(), b=pdJob(); b.id='A00092'; pdSession(a); records=[a,b]; sbReady=true;
    try{
      let release; const gate=new Promise(res=>{ release=res; });
      queueRouter(gate);
      saveQTrack('A00091','แก้สูตร',true); saveQTrack('A00092','แก้สูตร',true);
      const t=panelText();
      assert(t.includes('คิวที่ 1/2') && t.includes('คิวที่ 2/2'),'queue positions missing: '+t);
      assert(t.includes('A00091') && t.includes('A00092'));
      release(); await untilIdle();
    }finally{ pdDone(); }
  });
  test('local-only mode confirms as soon as the local write succeeds; a quota failure is a visible failure with retry', async function(){
    const r=pdJob(); pdSession(r); SB_URL='';
    const proto=Object.getPrototypeOf(localStorage), real=proto.setItem;
    try{
      openModifyRecord(r.id);
      editIng(0,'name','Aqua Local');
      await sleep(20);
      equal(saveQMine()[0].state,'confirmed'); assert(saveQMine()[0].localOnly);
      proto.setItem=function(k,v){ if(k==='fs_records'){ const e=new Error('quota'); e.name='QuotaExceededError'; throw e; } return real.call(this,k,v); };
      editIng(1,'name','Glycerin Local');
      await sleep(20);
      const it=saveQMine()[0];
      equal(it.state,'failed','quota failure did not fail the save'); assert(it.error.includes('ไม่สำเร็จ'));
      equal(records[0].rows[1].name,'Glycerin Local','in-memory edit lost');
      proto.setItem=real;
      saveQRetry(it.seq);
      await sleep(20);
      equal(saveQMine()[0].state,'confirmed','retry after freeing space did not succeed');
      equal(JSON.parse(localStorage.getItem('fs_records'))[0].rows[1].name,'Glycerin Local');
    }finally{ proto.setItem=real; pdDone(); }
  });
  test('a pull that changes the server copy during a pending save shows a warning in the popup and the Modify page', function(){
    const r=pdJob(); pdSession(r); SB_URL='https://test-project.supabase.co';
    try{
      openModifyRecord(r.id);
      saveQTrack(r.id,'แก้สูตร',true); // pending (sync not ready -> waiting)
      modifyIngs[0].name='Pending Local'; editIng(0,'name','Pending Local');
      const remote=clone(JSON.parse(sbSnap.records[r.id])); remote.customer='Other User Edit';
      sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
      assert(panelText().includes('ถูกแก้ไขบนเซิร์ฟเวอร์โดยผู้อื่น'),'popup shows no conflict warning');
      renderModify();
      assert(document.getElementById('modContent').textContent.includes('ถูกแก้ไขบนเซิร์ฟเวอร์โดยผู้อื่น'),'Modify page shows no conflict warning');
    }finally{ pdDone(); }
  });
  test('a remote-only change refreshes the Modify table and keeps stamps of unchanged rows', function(){
    const r=pdJob(); pdSession(r);
    try{
      openModifyRecord(r.id); verifyIng(0);
      sbSnap.records[r.id]=JSON.stringify(records[0]);   // cache identical to server: sync swaps in the new object
      const remote=clone(records[0]); remote.rows[1].name='Glycerin Remote';
      sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
      equal(modifyIngs[1].name,'Glycerin Remote','table not refreshed from the fresh copy');
      equal(modifyIngs[0].verifiedBy,'PD One','stamp of an unchanged row was lost');
      assert(modifyNotice.includes('อัปเดตจากเซิร์ฟเวอร์'),'no notice shown');
    }finally{ pdDone(); }
  });
  test('a storage event reload also rebinds the Modify record', function(){
    const r=pdJob(); pdSession(r);
    try{
      openModifyRecord(r.id);
      const other=clone(r); other.brand='From Other Tab';
      localStorage.setItem('fs_records',JSON.stringify([other]));
      window.dispatchEvent(Object.assign(new Event('storage'),{key:'fs_records'}));
      equal(modifyRec,records[0],'modifyRec orphaned after a storage reload');
      equal(modifyRec.brand,'From Other Tab');
    }finally{ pdDone(); }
  });


  test('B1: view/print between two PD edits does not push derived fields the server guard rejects', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const server={[r.id]:clone(r)};
    try{
      openModifyRecord(r.id);
      queueRouter(null,server);
      editIng(0,'w','20.00'); await untilIdle();
      equal(saveQMine()[0].state,'confirmed','first edit: '+saveQMine()[0].error);
      renderDashboard(records[0]);                       // view / print rewrites totW etc. on the record
      assert(records[0].totW!==15,'fixture: render did not diverge derived fields');
      window.__fetchQueue.length=0; queueRouter(null,server);
      editIng(0,'w','30.00'); await untilIdle();
      equal(saveQMine()[0].state,'confirmed','second edit after a view was rejected: '+saveQMine()[0].error);
      equal(server[r.id].rows[0].w,30);
      equal(server[r.id].totW,15,'derived field leaked to the server');
    }finally{ pdDone(); }
  });
  test('B1: a record whose derived fields already diverged still saves for PD', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const server={[r.id]:clone(r)};
    try{
      records[0].totW=99; records[0].heroes=[{name:'x'}]; records[0].fda={allOk:false};
      sbSnap.records[r.id]=JSON.stringify(server[r.id]);
      openModifyRecord(r.id);
      queueRouter(null,server);
      editIng(0,'name','Aqua Diverged'); await untilIdle();
      equal(saveQMine()[0].state,'confirmed',saveQMine()[0].error);
      equal(server[r.id].rows[0].name,'Aqua Diverged'); equal(server[r.id].totW,15);
    }finally{ pdDone(); }
  });
  test('B2: a hung request fails the save after the timeout, keeps local data, and lets the user leave', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const oldTimeout=sbReqTimeoutMs, oldConfirm=window.confirm; let asked=0; window.confirm=function(){ asked++; return true; };
    sbReqTimeoutMs=60;
    try{
      openModifyRecord(r.id);
      for(let i=0;i<10;i++) window.__fetchQueue.push(function(){ return new Promise(function(){}); });
      editIng(0,'name','Aqua Hung');
      equal(saveQMine()[0].state,'sending');
      for(let i=0;i<100 && saveQMine()[0].state==='sending';i++) await sleep(20);
      const it=saveQMine()[0];
      equal(it.state,'failed','hung request left the save in sending'); assert(it.error.includes('หมดเวลา'),it.error);
      equal(JSON.parse(localStorage.getItem('fs_records'))[0].rows[0].name,'Aqua Hung','local copy lost');
      assert(panelText().includes('บันทึกไม่สำเร็จ'),'failure popup hidden');
      backToModifyList(); equal(asked,1,'no escape confirmation'); equal(modifyRec,null,'could not leave after the timeout');
    }finally{ sbReqTimeoutMs=oldTimeout; window.confirm=oldConfirm; pdDone(); }
  });
  test('N1/N4/N7: failure un-hides the panel; saveModNote needs editFormula; logout is guarded and clears the queue', async function(){
    const r=pdJob(); pdSession(r); SB_URL='';
    try{
      openModifyRecord(r.id);
      const it=saveQTrack(r.id,'x',true); await sleep(20); saveQHide(); equal(saveQMine().length,0);
      const it2=saveQTrack(r.id,'y',false); await sleep(20);        // local write "failed" -> rewrite succeeds actually
      saveQ.push({seq:99,jobId:r.id,label:'z',user:currentUser,state:'sending',pct:50,error:'',localOk:true});
      saveQHidden=true; saveQSet(saveQ[saveQ.length-1],'failed',50,'boom');
      assert(panelText().includes('boom'),'failed item did not un-hide the panel');
      // N7: logout with an in-flight save is blocked; with a failed one it asks first
      const oldConfirm=window.confirm, oldAlert=window.alert; let asked=0; window.confirm=function(){ asked++; return false; }; window.alert=function(){};
      try{ await logoutUser(); equal(currentUser,'PD One','logout ignored the unconfirmed save'); equal(asked,1); }
      finally{ window.confirm=oldConfirm; window.alert=oldAlert; }
      window.confirm=function(){ return true; };
      try{ await logoutUser(); }finally{ window.confirm=oldConfirm; }
      equal(saveQ.length,0,'queue not cleared on logout'); equal(Object.keys(sbConflicts).length,0);
      // N4
      userList=[{name:'Sales One',role:'sales',pass:null}]; currentUser='Sales One'; authMembership={name:'Sales One',role:'sales',active:true};
      modifyRec=records[0]; const oldAlert2=window.alert; window.alert=function(){};
      try{ document.getElementById('modNote').value='x'; const before=JSON.stringify(records[0]); saveModNote(); equal(JSON.stringify(records[0]),before,'non-PD role saved a modify note'); }
      finally{ window.alert=oldAlert2; }
    }finally{ pdDone(); }
  });


  test('R2-B1: a hung token refresh cannot hang the cycle; the unconfirmed work stays visible (N3)', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    authSession.refresh_token='synthetic-refresh';
    const old=sbReqTimeoutMs; sbReqTimeoutMs=60;
    try{
      openModifyRecord(r.id);
      window.__fetchQueue.push(window.__mockResponse(401,'expired'));
      for(let i=0;i<10;i++) window.__fetchQueue.push(function(){ return new Promise(function(){}); });
      editIng(0,'name','Aqua Refresh Hang');
      for(let i=0;i<100 && sbCycleRunning;i++) await sleep(20);
      assert(!sbCycleRunning,'sbCycle stayed running behind a hung refresh request');
      equal(JSON.parse(localStorage.getItem('fs_records'))[0].rows[0].name,'Aqua Refresh Hang','local copy lost');
      const note=document.getElementById('saveQLostNotice');
      assert(note && note.textContent.includes('ยังไม่ยืนยันการบันทึก'),'no visible message that unconfirmed work remains');
    }finally{ sbReqTimeoutMs=old; pdDone(); }
  });
  test('R2-B1: a hung workspace mount cannot hold the cycle open', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const old=sbReqTimeoutMs, realMount=window.mountPrivateWorkspace; sbReqTimeoutMs=60;
    try{
      window.mountPrivateWorkspace=function(){ return new Promise(function(){}); };
      openModifyRecord(r.id);
      queueRouter(null,{[r.id]:clone(r)});
      editIng(0,'name','Aqua Mount Hang');
      for(let i=0;i<100 && saveQPending().length;i++) await sleep(20);
      assert(!sbCycleRunning,'sbCycle stayed running behind a hung workspace fetch');
      equal(saveQMine()[0].state,'confirmed',saveQMine()[0].error);
    }finally{ window.mountPrivateWorkspace=realMount; sbReqTimeoutMs=old; pdDone(); }
  });
  test('R2-B1: an overall per-save deadline fails a save even if the cycle never returns; a later cycle can start', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const oldReq=sbReqTimeoutMs, oldDl=SAVEQ_DEADLINE_MS, oldMax=sbCycleMaxMs; sbReqTimeoutMs=100000; SAVEQ_DEADLINE_MS=80;
    try{
      openModifyRecord(r.id);
      for(let i=0;i<10;i++) window.__fetchQueue.push(function(){ return new Promise(function(){}); });
      editIng(0,'name','Aqua Deadline');
      for(let i=0;i<100 && saveQMine()[0].state==='sending';i++) await sleep(20);
      const it=saveQMine()[0];
      equal(it.state,'failed'); assert(it.error.includes('หมดเวลา'),it.error);
      sbCycleMaxMs=30; await sleep(60); window.__fetchQueue.length=0; queueRouter(null,{[r.id]:clone(r)});
      sbReqTimeoutMs=oldReq; sbErr='';
      saveQRetry(it.seq);
      for(let i=0;i<100 && saveQPending().length;i++) await sleep(20);
      equal(saveQMine()[0].state,'confirmed','a stuck cycle blocked every later cycle: '+saveQMine()[0].error);
    }finally{ sbReqTimeoutMs=oldReq; SAVEQ_DEADLINE_MS=oldDl; sbCycleMaxMs=oldMax; pdDone(); }
  });
  test('R2-B2: another user changes a non-PD field; the PD save refreshes its base, retries once and is confirmed', async function(){
    const r=pdJob(); pdSession(r); sbReady=true;
    const server={[r.id]:clone(r)};
    try{
      server[r.id].brand='Brand Changed By Sales'; server[r.id].customer='Customer Changed';   // snapshot still has the old values
      openModifyRecord(r.id);
      queueRouter(null,server);
      editIng(0,'name','Aqua PD Rows Edit');
      await untilIdle();
      equal(saveQMine()[0].state,'confirmed',saveQMine()[0].error);
      equal(server[r.id].rows[0].name,'Aqua PD Rows Edit','PD rows edit lost');
      equal(server[r.id].brand,'Brand Changed By Sales','other user change overwritten');
      equal(records[0].brand,'Brand Changed By Sales');
      const posts=window.__fetchCalls.filter(c=>c.options.method==='POST' && c.url.includes('fs_records'));
      equal(posts.length,2,'expected exactly one retry');
    }finally{ pdDone(); }
  });
  test('R2-N2: normalised row comparison does not report a false server update', function(){
    const r=pdJob(); r.rows[0].w=10.5; r.rows[0].actual=10.5; pdSession(r);
    try{
      openModifyRecord(r.id);
      modifyIngs[0].w='10.5'; modifyIngs[0].actual='10.50'; modifyIngs[0].p='100.0';
      equal(modifyIngsDiffer(records[0]),false,'formatting differences counted as a server change');
      modifyIngs[0].w='11';
      equal(modifyIngsDiffer(records[0]),true,'a real difference was missed');
    }finally{ pdDone(); }
  });
  test('R2-N4: retry all with no permission shows one alert, not one per item', async function(){
    const a=pdJob(), b=pdJob(); b.id='A00092'; pdSession(a); records=[a,b];
    const oldAlert=window.alert; let alerts=0; window.alert=function(){ alerts++; };
    try{
      saveQ.push({seq:1,jobId:'A00091',label:'x',user:currentUser,state:'failed',pct:50,error:'e',localOk:true},
                 {seq:2,jobId:'A00092',label:'y',user:currentUser,state:'failed',pct:50,error:'e',localOk:true});
      authMembership={name:'PD One',role:'rd',active:true};           // a role without editFormula
      saveQRetryAll();
      equal(alerts,1,'one alert per item');
    }finally{ window.alert=oldAlert; pdDone(); }
  });

  // ===== Chat formula edit uses the same save protections as PD Modify =====
  function chatPdSession(r){
    pdSession(r);
    chats=[{jobId:r.id,createdAt:1,createdBy:'Sales One',messages:[],parts:[],approvals:{pd:null,ra:null,rd:null}}];
    sbConfirmedScope=jobConfirmationScope(); sbConfirmedRecords={[r.id]:jobRecordFingerprint(sbPdComparable(r))};
  }
  test('Chat formula edit: edit after a background sync lands on the fresh copy (not a stale object)', function(){
    const r=pdJob(); chatPdSession(r);
    const oldConfirm=window.confirm;
    try{
      window.confirm=function(){            // sync replaces records[] while the confirm dialog is open
        const remote=clone(r); remote.brand='Brand Changed By Sales'; remote.rows[1].name='Glycerin Remote';
        sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
        return true;
      };
      chatIngDel(r.id,0);
      equal(records.length,1);
      equal(records[0].brand,'Brand Changed By Sales','stale object clobbered the newer server field');
      equal(records[0].rows.length,1,'row not removed');
      equal(records[0].rows[0].name,'Glycerin Remote','stale object clobbered a server row');
    }finally{ window.confirm=oldConfirm; pdDone(); }
  });
  test('Chat formula edit: PD payload is accepted by the guard mirror, derived fields are not written, queue goes to confirmed', async function(){
    const r=pdJob(); chatPdSession(r); sbReady=true;
    const server={[r.id]:clone(r)};
    try{
      queueRouter(null,server);
      chatIngEdit(r.id,0,'w','20');
      const it=saveQMine()[0];
      assert(it,'edit was not tracked by the save queue');
      equal(it.jobId,r.id); equal(it.state,'sending','state right after the local write'); equal(it.pct,50);
      assert(panelText().includes('กำลังบันทึก'),'progress popup missing');
      assert(chats[0].messages.some(m=>m.text&&m.text.includes('แก้สูตร')),'chat log message missing');
      const oa=window.alert; let alerted=0; window.alert=function(){ alerted++; };
      const navOk=saveQNavOK(); window.alert=oa;
      equal(navOk,false,'navigation was not guarded while the save is pending'); equal(alerted,1);
      await untilIdle();
      equal(it.state,'confirmed',it.error); equal(it.pct,100);
      equal(server[r.id].rows[0].w,20,'edit did not reach the server');
      equal(server[r.id].totW,15,'derived field leaked to the server');
      equal(records[0].totW,15,'derived field written into the record');
    }finally{ pdDone(); }
  });
  test('Chat formula edit: add/delete are tracked; a hung request fails the item with retry and keeps the local copy', async function(){
    const r=pdJob(); chatPdSession(r); sbReady=true;
    const oldTimeout=sbReqTimeoutMs, oldConfirm=window.confirm; window.confirm=function(){ return true; };
    const server={[r.id]:clone(r)};
    try{
      queueRouter(null,server);
      chatIngAdd(r.id); await untilIdle();
      equal(saveQMine()[0].state,'confirmed',saveQMine()[0].error);
      equal(server[r.id].rows.length,3);
      window.__fetchQueue.length=0; queueRouter(null,server);
      chatIngDel(r.id,2); await untilIdle();
      equal(saveQMine()[0].state,'confirmed',saveQMine()[0].error);
      equal(server[r.id].rows.length,2);
      window.__fetchQueue.length=0;
      sbReqTimeoutMs=60;
      for(let i=0;i<10;i++) window.__fetchQueue.push(function(){ return new Promise(function(){}); });
      chatIngEdit(r.id,0,'name','Aqua Hung');
      for(let i=0;i<100 && saveQMine()[0].state==='sending';i++) await sleep(20);
      equal(saveQMine()[0].state,'failed','hung request left the chat save in sending');
      assert(document.querySelector('#saveQPanel button[onclick^="saveQRetry"]'),'retry button missing');
      equal(JSON.parse(localStorage.getItem('fs_records'))[0].rows[0].name,'Aqua Hung','local copy lost');
    }finally{ sbReqTimeoutMs=oldTimeout; window.confirm=oldConfirm; pdDone(); }
  });
  test('Chat formula edit: still requires editFormula', function(){
    const r=pdJob(); chatPdSession(r);
    const oldAlert=window.alert; window.alert=function(){};
    try{
      authMembership={name:'PD One',role:'rd',active:true};
      chatIngEdit(r.id,0,'name','Nope'); chatIngAdd(r.id);
      equal(records[0].rows[0].name,'Aqua'); equal(records[0].rows.length,2); equal(saveQMine().length,0);
    }finally{ window.alert=oldAlert; pdDone(); }
  });

  // ----- review follow-ups: row identity, derived fields by role, approvals, no-op, local-only -----
  function mountChatEditor(r){
    const host=document.createElement('div'); host.id='tmpChatEd'; host.innerHTML='<table>'+chatFormulaEditorHTML(r)+'</table>';
    document.body.appendChild(host); return host;
  }
    test('Chat formula edit: rows shift between render and onchange -> nothing is edited and the user is told', function(){
    const r=pdJob(); chatPdSession(r);
    const oldAlert=window.alert; const msgs=[]; window.alert=function(m){ msgs.push(String(m)); };
    const host=mountChatEditor(r);
    try{
      const remote=clone(r); remote.rows.reverse();                  // server now has Glycerin first
      sbApply({records:[remote],chats:[],users:[],acts:[],counter:91});
      const inp=host.querySelectorAll('tbody tr')[0].querySelectorAll('input')[0];   // rendered for "Aqua" row 1
      // inline handlers are not compiled in the harness page, so call what the handler calls: identity captured at render
      const rk=inp.closest('tr').dataset.rk;
      chatIngEdit(r.id,0,'name','Aqua Renamed',rk);
      equal(records[0].rows[0].name,'Glycerin','wrong row was edited');
      equal(records[0].rows[1].name,'Aqua','row content changed');
      equal(saveQMine().length,0,'a save was queued for an aborted edit');
      assert(msgs.length>=1,'no visible notice');
    }finally{ window.alert=oldAlert; host.remove(); pdDone(); }
  });
  test('Chat formula delete: rows shift while the confirm dialog is open -> the wrong row is not deleted', function(){
    const r=pdJob(); chatPdSession(r);
    const oldAlert=window.alert, oldConfirm=window.confirm; const msgs=[]; window.alert=function(m){ msgs.push(String(m)); };
    try{
      window.confirm=function(){ const remote=clone(r); remote.rows.reverse(); sbApply({records:[remote],chats:[],users:[],acts:[],counter:91}); return true; };
      chatIngDel(r.id,0);                                             // user confirmed deleting "Aqua"
      equal(records[0].rows.length,2,'a row was deleted although the confirmed row moved');
      equal(records[0].rows[0].name,'Glycerin'); equal(saveQMine().length,0);
      assert(msgs.length>=1,'no visible notice');
    }finally{ window.alert=oldAlert; window.confirm=oldConfirm; pdDone(); }
  });
  test('Chat formula edit as Admin refreshes derived totals; as PD it keeps them', function(){
    const r=pdJob(); chatPdSession(r);
    try{
      authMembership={name:'Admin One',role:'admin',active:true}; currentUser='Admin One'; userList=[{name:'Admin One',role:'admin',pass:null}];
      sbConfirmedScope=jobConfirmationScope(); sbConfirmedRecords={[r.id]:jobRecordFingerprint(sbPdComparable(records[0]))};
      chatIngEdit(r.id,0,'w','20');
      equal(records[0].rows[0].w,20); equal(records[0].totW,25,'admin chat edit did not refresh totW');
    }finally{ pdDone(); }
  });
  test('PD Modify edit as Admin refreshes derived totals', function(){
    const r=pdJob(); pdSession(r);
    try{
      authMembership={name:'Admin One',role:'admin',active:true}; currentUser='Admin One'; userList=[{name:'Admin One',role:'admin',pass:null}];
      openModifyRecord(r.id); editIng(0,'w','20.00');
      equal(records[0].totW,25,'admin Modify edit did not refresh totW');
    }finally{ pdDone(); }
  });
  test('Chat formula edit: a real edit clears approvals; without editFormula approvals and chat are untouched', function(){
    const r=pdJob(); chatPdSession(r);
    try{
      chats[0].approvals={pd:{by:'x',at:1},ra:{by:'y',at:2},rd:null};
      const oldAlert=window.alert; window.alert=function(){};
      authMembership={name:'PD One',role:'rd',active:true};
      chatIngEdit(r.id,0,'w','20');
      equal(records[0].rows[0].w,10,'rd edited the formula');
      assert(chats[0].approvals.pd && chats[0].approvals.ra,'approvals touched without permission');
      equal(chats[0].messages.length,0,'chat message pushed without permission');
      window.alert=oldAlert;
      authMembership={name:'PD One',role:'pd',active:true};
      chatIngEdit(r.id,0,'w','20');
      equal(records[0].rows[0].w,20);
      assert(!chats[0].approvals.pd && !chats[0].approvals.ra && !chats[0].approvals.rd,'approvals not cleared by a real edit');
      equal(chats[0].messages.length,1);
    }finally{ pdDone(); }
  });
  test('Chat formula edit: a no-op neither re-renders the chat nor creates rows', function(){
    const r=pdJob(); chatPdSession(r);
    const real=renderChat; let n=0; renderChat=function(){ n++; return real.apply(this,arguments); };
    try{
      chatIngEdit(r.id,0,'w','10');                                   // same value
      equal(n,0,'no-op re-rendered the chat (drops an unsent draft)'); equal(saveQMine().length,0);
      delete records[0].rows;
      chatSaveFormula(r.id,function(){ return false; },'x');
      equal(n,0); assert(records[0].rows===undefined,'rows were created by a no-op');
    }finally{ renderChat=real; pdDone(); }
  });
  test('Chat formula edit in local-only mode: chat is gated, but chatSaveFormula itself confirms locally', async function(){
    const r=pdJob(); chatPdSession(r); const oldUrl=SB_URL; SB_URL='';
    const oldAlert=window.alert; window.alert=function(){};
    try{
      chatIngEdit(r.id,0,'w','20');
      equal(records[0].rows[0].w,10,'chat edit went through without a server');
      chatSaveFormula(r.id,function(x){ x.rows[0].w=20; return {log:'local edit'}; },'แก้สูตรในแชท');
      await sleep(20);
      equal(records[0].rows[0].w,20); equal(saveQMine()[0].state,'confirmed'); assert(saveQMine()[0].localOnly);
    }finally{ SB_URL=oldUrl; window.alert=oldAlert; pdDone(); }
  });

  test('Locked chat view explains a pending or failed formula save', function(){
    const r=pdJob(); chatPdSession(r);
    saveQ.push({seq:901,jobId:r.id,user:currentUser,label:'<b>x</b>',state:'sending',pct:50});
    let html=jobLockedHTML(r);
    assert(html.includes('กำลังบันทึกสูตร') && html.includes('50%'),'pending note missing');
    saveQ[saveQ.length-1].state='failed';
    html=jobLockedHTML(r);
    assert(html.includes('บันทึกสูตรไม่สำเร็จ') && html.includes('PD Modify'),'failed note missing');
    saveQ.length=0;
    assert(!jobLockedHTML(r).includes('job-lock-note'),'note shown with nothing pending');
    pdDone();
  });

  async function run(){
    const results = [];
    for(const item of tests){
      try{
        await item.fn();
        results.push({name:item.name, status:'PASS'});
      }catch(error){
        results.push({name:item.name, status:'FAIL', error:String(error && error.message || error)});
      }
    }
    const failed = results.filter(result=>result.status === 'FAIL');
    document.documentElement.dataset.testStatus = failed.length ? 'failed' : 'passed';
    const pre = document.createElement('pre');
    pre.id = 'fs-test-results';
    pre.textContent = JSON.stringify({passed:results.length-failed.length,failed:failed.length,results}, null, 2);
    document.body.appendChild(pre);
  }

  setTimeout(run, 50);
})();
