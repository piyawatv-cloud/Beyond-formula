'use strict';
// Isolated worker prototype: generic content only; no production registration.
self.addEventListener('push',event=>{
  let data={};
  try { data=event.data?.json()||{}; } catch (_) { data={}; }
  const body=data.kind==='chat'?'มีข้อความใหม่ใน Formula Studio':'มีความเคลื่อนไหวใน Formula Studio';
  event.waitUntil(self.registration.showNotification('Formula Studio',{body,data:{path:'/'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  // Always reopen the app entrypoint. Authentication/authorization must run there.
  event.waitUntil(self.clients.openWindow(new URL('/',self.location.origin).href));
});
