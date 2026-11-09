/* Activities is visible only after a fresh /sb/session admin decision.
 * This is a presentation guard. The gateway remains the data boundary.
 * Never mutate activities, localStorage or the pending Activity queues here. */
(function () {
  'use strict';
  if (window.__fsAdminActivityLogInstalled) return;
  window.__fsAdminActivityLogInstalled = true;

  var nativeFetch = window.fetch.bind(window);
  var appSwitchView = window.switchView;
  var appRenderActivities = window.renderActivities;
  var appRenderUserUI = window.renderUserUI;
  var appAfterUserChange = window.afterUserChange;
  var appLogout = window.logoutUser;
  var trusted = null, generation = 0, timer = null, loggedOut = false;

  function anchors() {
    return window.__fsAdminActivityLogCompatible === true
      && document.getElementById('sideActivities')
      && document.getElementById('actView')
      && document.getElementById('actContent');
  }
  function allowed() {
    return !!(anchors() && trusted && trusted.expires > Date.now()
      && typeof currentUser !== 'undefined' && currentUser === trusted.name
      && (typeof impersonator === 'undefined' || !impersonator) && !loggedOut);
  }
  window.__fsAdminActivityLogAllowed = allowed;

  var statusNode = null;
  function status(show) {
    if (!statusNode && show) {
      statusNode = document.createElement('div'); statusNode.id = 'fsActivityLogStatus';
      statusNode.setAttribute('role','status'); statusNode.className = 'muted';
      statusNode.style.cssText = 'padding:8px 16px;font-size:12px';
      var nav = document.getElementById('sideActivities');
      if (nav && nav.parentNode) nav.parentNode.appendChild(statusNode);
      else document.body.appendChild(statusNode);
    }
    if (statusNode) { statusNode.hidden = !show; statusNode.textContent = show ? 'ไม่มีสิทธิ์ดูบันทึกกิจกรรม' : ''; }
  }
  function close(preserveStatus) {
    if (!preserveStatus) status(false);
    trusted = null;
    document.documentElement.removeAttribute('data-fs-admin-activity-log');
    var nav = document.getElementById('sideActivities');
    var view = document.getElementById('actView');
    var content = document.getElementById('actContent');
    if (nav) { nav.style.display = 'none'; nav.classList.remove('on'); }
    var wasOpen = view && view.classList.contains('on');
    if (view) view.classList.remove('on');
    if (content) content.textContent = '';
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (wasOpen && typeof appSwitchView === 'function') appSwitchView('dash');
  }
  function paint() {
    if (!allowed()) { close(true); return; }
    document.documentElement.setAttribute('data-fs-admin-activity-log', 'ready');
    document.getElementById('sideActivities').style.display = 'flex';
  }
  function refresh(openView) {
    var view = document.getElementById('actView');
    var wasOpen = !!(view && view.classList.contains('on'));
    var previous = trusted && trusted.identity;
    var request = ++generation;
    close();
    if (!anchors() || loggedOut) return;
    nativeFetch('/sb/session', { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      if (response.status !== 200) return null;
      return response.json();
    }).then(function (session) {
      if (request !== generation || loggedOut) return;
      var expires = session && Date.parse(session.expiresAt);
      if (session && session.authenticated === true && session.role !== 'admin'
        && session.name === currentUser && Number.isFinite(expires) && expires > Date.now()) status(true);
      if (!session || session.authenticated !== true || session.role !== 'admin'
        || typeof session.name !== 'string' || !session.name || !Number.isFinite(expires) || expires <= Date.now()) {
        return;
      }
      trusted = { name: session.name, expires: expires,
        identity: String(session.centralUserId || session.email || session.name) };
      paint();
      if (!allowed()) return;
      // An account change clears the previous view. A fresh click can open it.
      if (openView || (wasOpen && previous === trusted.identity)) appSwitchView('act');
      timer = window.setTimeout(function () { refresh(false); }, Math.min(30000, expires - Date.now()));
    }).catch(function () {
      if (request === generation) close();
    });
  }

  window.renderActivities = function () {
    if (!allowed()) { close(true); return; }
    return appRenderActivities.apply(this, arguments);
  };
  window.renderUserUI = function () {
    var result = appRenderUserUI.apply(this, arguments);
    paint();
    return result;
  };
  window.switchView = function (view) {
    if (view === 'act') { refresh(true); return; }
    return appSwitchView.apply(this, arguments);
  };
  window.afterUserChange = function () {
    ++generation;
    close();
    var result = appAfterUserChange.apply(this, arguments);
    refresh(false);
    return result;
  };
  window.logoutUser = function () {
    loggedOut = true;
    ++generation;
    close();
    return appLogout.apply(this, arguments);
  };
  window.addEventListener('focus', function () { refresh(false); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh(false);
    else { ++generation; close(); }
  });
  window.addEventListener('storage', function (event) {
    if (!event.key || event.key === 'fs_user' || event.key === 'fs_imp') refresh(false);
  });
  close();
  refresh(false);
}());
