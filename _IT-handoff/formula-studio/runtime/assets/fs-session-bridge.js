/* Formula Studio — ต่อหน้า Login เดิมเข้ากับเซสชันของเซิร์ฟเวอร์
 * ---------------------------------------------------------------------------
 * ปัญหาที่แก้: เดิมทีการตรวจรหัสผ่านเกิดขึ้นในเบราว์เซอร์ล้วน (pwHash) และ
 * รายชื่อผู้ใช้พร้อมรหัสที่อำพรางไว้ก็ถูกดาวน์โหลดมาทั้งชุดก่อนล็อกอินด้วยซ้ำ
 * แปลว่า "ใครเป็นใคร" เป็นสิ่งที่เครื่องผู้ใช้ตัดสินเอง — ซึ่งเซิร์ฟเวอร์เชื่อไม่ได้
 *
 * ทำอะไร: เปลี่ยนให้ปุ่ม "เข้าใช้งาน" ส่งชื่อผู้ใช้กับรหัสผ่านไปให้ runtime
 * ซึ่งจะส่งต่อให้ OPC Workflow เป็นคนตัดสิน แล้วจับคู่อีเมลกลับมาเป็นผู้ใช้
 * ของ Formula Studio ตัวจริงที่เซิร์ฟเวอร์เป็นคนเลือก ไม่ใช่เบราว์เซอร์
 *
 * สิ่งที่ตั้งใจไม่ทำ:
 *   - ไม่แตะ localStorage keys เดิม ไม่แตะรูปร่างข้อมูล (กฎข้อ 1 ของโปรเจกต์นั้น)
 *   - ไม่ทับ window.fetch — ถ้าทับ จะไปดักการบันทึกของหน้าจอเองด้วย
 *     ระบบ OPC เคยทำแล้วต้องรื้อออก และมีเทสต์ห้ามไว้ถาวร
 *   - ไม่ใช้ requestAnimationFrame รอจังหวะ เพราะแท็บที่ไม่ได้อยู่หน้าจอไม่มีเฟรมเลย
 *     สคริปต์จะไม่ทำงานทั้งที่โค้ดถูก — ใช้ setTimeout เป็นหลักแทน
 */
(function () {
  "use strict";
  if (window.__fsSessionBridge) return;
  window.__fsSessionBridge = true;

  var SESSION_URL = "/sb/session";
  var nativeFetch = window.fetch.bind(window);

  var actorGeneration = 0, actorAttempt = null, signedOut = false;
  window.__fsSessionGeneration = actorGeneration;
  function invalidateActor() {
    window.__fsSessionGeneration = ++actorGeneration;
  }

  function session(method, body) {
    var request = nativeFetch(SESSION_URL, {
      method: method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { status: response.status, data: data };
      });
    });
    if (method !== "GET") return request;
    // Bound the entire read, including a response body that never settles.
    // Late transport completion has no identity side effect.
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () { reject(new Error("session read timed out")); }, 15000);
      request.then(resolve, reject).finally(function () { window.clearTimeout(timer); });
    });
  }

  function showError(message) {
    if (typeof window.loginErr === "function") window.loginErr(message);
    else window.alert(message);
  }

  /* ---- รหัสผ่านของ "การเข้าใช้งาน" ไม่ได้อยู่ที่นี่อีกแล้ว ------------------ */
  /* ตั้งแต่ล็อกอินผ่าน OPC Workflow การเข้าใช้งานไม่ได้ตรวจกับฟิลด์ pass ใน fs_users อีก
   * แต่หน้าจอยังพูดเหมือนเดิมทุกจุด — บอกว่ารหัสตั้งต้นคือ 123456 · มีปุ่ม "รีเซ็ตรหัส"
   * รายคนและปุ่มรีเซ็ตทั้งหมด · มีเมนู "เปลี่ยนรหัสผ่าน" — ทั้งหมดกดแล้วไม่มีผลกับ
   * การเข้าใช้งานจริงแม้แต่นิดเดียว
   *
   * ข้อความที่โกหกอันตรายกว่าข้อความที่ไม่มี: Admin จะกดรีเซ็ตให้คนที่ลืมรหัส แล้วบอกเขาว่า
   * "ใช้ 123456 นะ" ซึ่งเข้าไม่ได้ แล้วเวลาที่ควรใช้แก้ปัญหาจะหมดไปกับการหาว่าทำไมรหัสใหม่ไม่ทำงาน
   * ทางที่ถูกคือให้ Admin ของ OPC รีเซ็ตให้
   *
   * **แต่ต้องพูดให้ตรงกว่านี้** — ผู้ตรวจจับได้ 24 ส.ค. ว่าข้อความรุ่นแรกของบล็อกนี้เขียนว่า
   * "ไม่มีใครอ่าน pass อีกเลย" ซึ่งไม่จริง ในบันเดิลยังมีคนอ่านอยู่ 3 ที่:
   *   - วาดกุญแจ 🔒 หน้าชื่อทุกคนที่มี pass
   *   - loginUserAt() ถามรหัสก่อนสลับไปดูในมุมของคนอื่น
   *   - submitLoginPassword() เทียบ pwHash กับ pass จริง ๆ ในเบราว์เซอร์
   * และในฐานตอนนั้นมี pass ครบ 21/21 คน โดย 16 คนยังเป็นค่าแฮชของ "123456"
   *
   * เราจึงเปลี่ยนคำโกหกเก่าเป็นคำโกหกใหม่ ทั้งที่คอมมิตนี้เกิดมาเพื่อกำจัดคำโกหก
   * รอบแรกจึงแก้ถ้อยคำให้พูดเฉพาะเรื่องการเข้าใช้งาน แล้วบอกตามตรงว่าการสลับมุมมองยังใช้ pass
   * รอบนี้ (24 ส.ค. เย็น) ปิดทางสลับมุมมองไปด้วย ประโยคนั้นจึงกลายเป็นเท็จเสียเอง และถูกแก้ตาม
   * — บทเรียนคือ ถ้อยคำที่บรรยายสภาพปัจจุบัน ต้องถูกไล่ตรวจซ้ำทุกครั้งที่สภาพนั้นเปลี่ยน
   *
   * กัน 3 ชั้น: ซ่อนปุ่ม + แก้ข้อความ + กันในฟังก์ชันที่ทำงานจริง
   * ชั้นที่สามขาดไม่ได้ เพราะ onclick ที่ฝังอยู่ในหน้ายังเรียกฟังก์ชันพวกนี้ได้เสมอ
   * ไม่ว่าเราจะซ่อนปุ่มไปแล้วหรือไม่ */
  var PW_NOTE = "รหัสผ่านสำหรับเข้าใช้งานใช้ของ OPC Workflow — เปลี่ยนหรือรีเซ็ตต้องทำที่ระบบ OPC เท่านั้น";

  /* ที่ OPC ปุ่มนี้ชื่อ "🔑 บัญชีและรหัสผ่าน" และเป็นป๊อปอัพในหน้า ไม่ใช่ URL ของตัวเอง
   * จึงลิงก์ลึกไปที่ป๊อปอัพตรง ๆ ไม่ได้ — พาไปหน้าแรกแล้วบอกว่าต้องกดอะไรต่อ
   * ดีกว่าเดา URL ที่ไม่มีอยู่จริงแล้วผู้ใช้เจอหน้า 404 */
  var OPC_HOME = "https://opc.beyond-workflow.com/";
  var OPC_HINT = 'ที่หน้า OPC ให้กดปุ่ม "🔑 บัญชีและรหัสผ่าน" แล้วเลือกผู้ใช้ที่ต้องการตั้งรหัสใหม่';

  function openOpcAccounts() {
    // เปิดก่อนค่อยแจ้ง — ถ้าแจ้งก่อน เบราว์เซอร์บางตัวถือว่าหลุดจากการคลิกแล้วบล็อกแท็บใหม่
    window.open(OPC_HOME, "_blank", "noopener");
  }

  function blockPasswordAction() {
    openOpcAccounts();
    window.alert(
      PW_NOTE
        + "\n\nปุ่มนี้ไม่มีผลกับการเข้าใช้งาน"
        + "\n\nช่องรหัสผ่านเดิมของ Formula Studio ไม่ถูกใช้ที่ไหนอีกแล้ว ทั้งการเข้าใช้งาน"
        + "และการสลับผู้ใช้ — ตัวตนมาจากบัญชี OPC ที่ล็อกอินอยู่เสมอ",
    );
  }
  window.resetUserPassword = blockPasswordAction;
  window.resetAllPasswords = blockPasswordAction;
  window.openChangePassword = blockPasswordAction;

  /* ---- ตัวตนบนหน้าจอต้องเป็นคนเดียวกับที่คุกกี้บอก ------------------------ */
  /* ผู้ตรวจอิสระชี้จุดนี้ให้ 24 ส.ค. — ในบันเดิลยังมีสองทางที่ตั้ง currentUser เองได้
   * โดยไม่ผ่าน OPC เลย:
   *
   *   loginUserAt(i)     กดชื่อคนอื่นในกล่องจัดการผู้ใช้ → askLoginPassword() →
   *                      เทียบ pwHash ในเบราว์เซอร์ → ตั้ง currentUser เป็นคนนั้น
   *   openImpersonate()  เมนู "สวมบทบาทผู้ใช้" ที่ยังโชว์ให้ Admin อยู่จริง
   *
   * ทั้งสองทางไม่ได้ทำให้ใครได้สิทธิ์เพิ่มจริง — ประตูข้อมูลประทับ user/role จาก
   * คุกกี้เซสชันเสมอ สิ่งที่เขียนลงฐานจึงยังเป็นชื่อคนที่ล็อกอินจริง
   *
   * แต่ "หน้าจอบอกว่าเป็นคนหนึ่ง ข้อมูลบันทึกเป็นอีกคนหนึ่ง" คือสภาพที่แย่กว่าห้ามไปเลย
   * คนที่กดสลับจะเชื่อว่ากำลังทำงานในนามคนนั้น แล้วประวัติจะเล่าคนละเรื่องกับที่เขาจำได้
   * และ 16 จาก 21 บัญชียังมี pass เป็นค่าแฮชของ 123456 — ประตูนี้จึงแทบไม่มีบานประตู
   *
   * ตรงกับกฎ 8.1 ของ Formula Studio ("ห้ามเพิ่มทางเข้าที่ตั้ง currentUser โดยไม่ผ่าน
   * Auth + active membership") และกฎ 9 ("pwHash ห้ามใช้เป็น authorization") */
  function blockIdentitySwitch() {
    window.alert(
      "สลับผู้ใช้ที่นี่ไม่ได้แล้ว"
        + "\n\nตัวตนมาจากบัญชี OPC Workflow ที่ล็อกอินอยู่เท่านั้น ถ้าต้องทำงานในนามคนอื่น"
        + " ให้ออกจากระบบแล้วเข้าใหม่ด้วยบัญชีนั้น"
        + "\n\nเหตุผล: ประตูข้อมูลประทับชื่อผู้ทำจากคุกกี้เซสชันเสมอ ถ้าสลับได้แค่บนหน้าจอ"
        + " สิ่งที่เห็นกับสิ่งที่ถูกบันทึกจะเป็นคนละคน",
    );
  }
  window.loginUserAt = blockIdentitySwitch;
  window.openImpersonate = blockIdentitySwitch;
  // ตัวรับรหัสจากกล่องที่ loginUserAt เปิด — ปิดทางเข้าแล้วต้องปิดตัวรับด้วย
  // ไม่งั้นเหลือประตูที่ล็อกลูกบิดแต่บานพับยังถอดได้
  window.askLoginPassword = blockIdentitySwitch;
  window.submitLoginPassword = blockIdentitySwitch;

  /* ปุ่ม "เพิ่มผู้ใช้ตามรายชื่อทีม" เติมคนจากรายชื่อที่ฝังมาในหน้า พร้อม pass = แฮชของ 123456
   * ในโหมดนี้มันสร้างแถวที่ล็อกอินไม่ได้ (อีเมลต้องตรงกับ OPC ก่อน) แล้วกล่องยืนยันของมัน
   * ยังบอกว่า "รหัสผ่านเริ่มต้นของทุกคนคือ 123456" ซึ่งไม่จริงอีกต่อไป
   * เพิ่มทีละคนด้วยฟอร์มด้านบนยังทำได้ตามปกติ — นั่นคือทางที่บังคับให้กรอกอีเมล */
  function blockSeedUsers() {
    window.alert(
      "เพิ่มผู้ใช้ตามรายชื่อทีมไม่ได้แล้ว"
        + "\n\nผู้ใช้ใหม่ต้องมีบัญชีใน OPC Workflow ที่อีเมลตรงกันก่อน ไม่งั้นเพิ่มไปก็ล็อกอินไม่ได้"
        + "\n\nใช้ฟอร์มด้านบนเพิ่มทีละคน แล้วกรอกอีเมลให้ตรงกับที่ใช้เข้า OPC",
    );
  }
  window.seedTeamUsers = blockSeedUsers;

  // ข้อความที่เขียนตายอยู่ในหน้า วาดครั้งเดียวตอนโหลด จึงแก้ครั้งเดียวพอ
  function patchStaticPasswordText() {
    var side = document.getElementById("sideChangePw");
    if (side) side.style.display = "none";
    var modal = document.getElementById("userModal");
    if (!modal) return;
    var desc = modal.querySelector(".modal-desc");
    if (desc && desc.textContent.indexOf("123456") >= 0) {
      desc.textContent = "คลิกชื่อของคุณเพื่อเข้าใช้งาน · " + PW_NOTE;
    }
  }

  // บรรทัดใต้ช่องล็อกอิน — เป็นประโยคแรกที่คนเข้าไม่ได้จะอ่าน ต้องชี้ไปที่คนที่ช่วยได้จริง
  function patchLoginHint() {
    var hints = document.querySelectorAll(".login-hint");
    for (var i = 0; i < hints.length; i += 1) {
      if (hints[i].textContent.indexOf("ลืมรหัสผ่าน") >= 0) {
        hints[i].textContent =
          "เข้าด้วยบัญชีและรหัสผ่านของ OPC Workflow · ลืมรหัสผ่าน — ติดต่อผู้ดูแลระบบ OPC";
      }
    }
  }

  /* ชื่อเต็มกับแผนกที่ดึงมาจาก OPC — เป็นฟิลด์ที่เพิ่มเข้ามาทีหลัง แถวเก่าที่ยังไม่มี
   * ต้องแสดงผลได้ตามปกติ จึงข้ามไปเฉย ๆ ไม่ใช่โชว์ค่าว่าง
   * ใช้ textContent ไม่ใช่ innerHTML — ค่ามาจากฐานข้อมูลของอีกระบบหนึ่ง */
  /* ปุ่ม "รีเซ็ตรหัส" เดิมถูกเอาออกเพราะกดแล้วไม่มีผลจริง แต่การเอาออกเฉย ๆ
   * ทำให้ Admin ที่ต้องช่วยคนลืมรหัส ไม่รู้ว่าต้องไปทำที่ไหนต่อ
   * ปุ่มนี้จึงพาไปที่ที่ทำได้จริง แทนที่จะปล่อยให้หาเอง */
  function addOpcPasswordButton(wrap) {
    if (wrap.querySelector(".fs-opc-pw")) return;
    var anchor = null;
    var buttons = wrap.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      if ((buttons[i].getAttribute("onclick") || "").indexOf("saveRoles") >= 0) anchor = buttons[i];
    }
    if (!anchor || !anchor.parentNode) return;
    var btn = document.createElement("button");
    btn.className = "btn btn-g btn-sm fs-opc-pw";
    btn.textContent = "🔑 รีเซ็ตรหัสผ่านที่ OPC";
    btn.title = OPC_HINT;
    btn.addEventListener("click", function () {
      openOpcAccounts();
      window.alert(OPC_HINT + "\n\n" + PW_NOTE);
    });
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
  }

  function addProfileLines(wrap) {
    if (typeof userList === "undefined") return;
    var rows = wrap.querySelectorAll(".user-row");
    for (var i = 0; i < rows.length && i < userList.length; i += 1) {
      var u = userList[i];
      var bits = [];
      if (u && u.fullName) bits.push(u.fullName);
      if (u && u.department) bits.push(u.department);
      if (!bits.length) continue;
      var chip = rows[i].querySelector(".user-chip");
      if (!chip || chip.querySelector(".fs-profile")) continue;
      var line = document.createElement("div");
      line.className = "user-mail fs-profile";
      line.textContent = bits.join(" · ");
      chip.appendChild(line);
    }
  }

  /* รายชื่อในกล่องจัดการผู้ใช้ถูกวาดใหม่ทุกครั้งที่เปิดกล่องหรือบันทึก Role
   * แก้ที่ผลลัพธ์ของ renderUserList จึงต้องทำหลังของแอปทำงานเสร็จเสมอ */
  var appRenderUserList = window.renderUserList;
  if (typeof appRenderUserList === "function") {
    window.renderUserList = function () {
      appRenderUserList.apply(this, arguments);
      patchStaticPasswordText();
      var wrap = document.getElementById("userListWrap");
      if (!wrap) return;

      var buttons = wrap.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i += 1) {
        var onclick = buttons[i].getAttribute("onclick") || "";
        // ตรวจทีละชื่อ ไม่ใช่ไล่ชื่อที่นึกออก — ผู้ตรวจจับได้ว่ารอบแรกลืมปุ่ม seedTeamUsers
        // ทั้งที่กล่องยืนยันของมันยังมีคำว่า 123456 อยู่
        if (["resetUserPassword", "resetAllPasswords", "seedTeamUsers"].some(function (fn) {
          return onclick.indexOf(fn) >= 0;
        })) {
          if (buttons[i].parentNode) buttons[i].parentNode.removeChild(buttons[i]);
        }
      }

      var notes = wrap.querySelectorAll(".modal-desc");
      for (var j = 0; j < notes.length; j += 1) {
        if (notes[j].textContent.indexOf("รีเซ็ตรหัส") >= 0) {
          notes[j].textContent = "เปลี่ยน Role แล้วกด “บันทึก Role” · " + PW_NOTE;
        }
      }

      addOpcPasswordButton(wrap);
      addProfileLines(wrap);
    };
  }

  patchStaticPasswordText();

  /* ---- ปุ่ม "เข้าใช้งาน" ------------------------------------------------- */
  // ปุ่มในหน้าเรียก doLogin() แบบ global ตอนกด จึงทับตัวนี้ได้ตรง ๆ
  // และ Enter ในช่องรหัสผ่านก็เรียกตัวเดียวกัน ไม่ต้องดัก event เพิ่ม
  window.doLogin = function () {
    var userEl = document.getElementById("lgUser");
    var passEl = document.getElementById("lgPass");
    if (!userEl || !passEl) return;

    var login = String(userEl.value || "").trim();
    if (!login) { showError("กรอกชื่อผู้ใช้ก่อน"); userEl.focus(); return; }
    if (!passEl.value) { showError("กรอกรหัสผ่านก่อน"); passEl.focus(); return; }

    showError("กำลังตรวจสอบกับ OPC Workflow…");

    invalidateActor();
    session("POST", { login: login, password: passEl.value }).then(function (result) {
      passEl.value = "";
      if (result.status === 200 && result.data && result.data.authenticated) {
        // โหลดหน้าใหม่แทนการเซ็ตสถานะเอง เพื่อให้ sbBoot() เริ่มรอบใหม่พร้อมคุกกี้
        // ตั้งแต่วินาทีแรก — เป็นทางเดียวที่ทำให้ "ใครล็อกอินอยู่" มีคำตอบเดียวคือคุกกี้
        showError("เข้าใช้งานสำเร็จ กำลังเปิดหน้าจอ…");
        window.location.reload();
        return;
      }
      showError((result.data && result.data.message) || "เข้าใช้งานไม่สำเร็จ");
      passEl.focus();
    }).catch(function (error) {
      showError("ติดต่อเซิร์ฟเวอร์ไม่ได้ — " + String((error && error.message) || error));
    });
  };

  /* ---- ทำให้ฟอร์มล็อกอินขึ้นเสมอเมื่อยังไม่ได้เข้าใช้งาน ------------------ */
  /* หน้าจอเดิมตัดสินใจแบบนี้: มีรายชื่อผู้ใช้ในมือ → โชว์ฟอร์ม · ยังซิงก์ไม่สำเร็จ →
   * โชว์ "กำลังเชื่อมต่อเซิร์ฟเวอร์…" · ไม่มีทั้งสองอย่าง → ชวนสร้าง Admin คนแรก
   *
   * พอเซิร์ฟเวอร์ไม่ยอมให้ดึงรายชื่อผู้ใช้ก่อนล็อกอิน (ซึ่งเป็นเรื่องที่ควรเป็น)
   * เงื่อนไขแรกจึงไม่มีวันเป็นจริง แล้วหน้าจอค้างอยู่ที่ "กำลังเชื่อมต่อ…" ตลอดกาล
   * — เปิดเว็บมาก็ไม่มีช่องให้กรอกอะไรเลย
   *
   * เราจึงบังคับให้ฟอร์มขึ้นเมื่อยังไม่มีใครล็อกอิน และไม่ปล่อยให้ไปโหมด
   * "สร้าง Admin คนแรก" ด้วย เพราะโหมดนั้นให้เบราว์เซอร์ตั้งตัวเองเป็น Admin ได้
   * ซึ่งเป็นสิ่งเดียวกับที่เรากำลังเอาออกจากระบบ */
  var appRenderLoginView = window.renderLoginView;
  window.renderLoginView = function () {
    if (typeof appRenderLoginView === "function") appRenderLoginView.apply(this, arguments);
    patchLoginHint();
    if (typeof currentUser !== "undefined" && currentUser) return;
    var body = document.getElementById("loginBody");
    if (!body || typeof window.loginFormHTML !== "function") return;
    if (body.querySelector("#lgUser")) return;      // ฟอร์มอยู่แล้ว ไม่ต้องวาดซ้ำ
    body.innerHTML = window.loginFormHTML();
    patchLoginHint();
    var field = document.getElementById("lgUser");
    if (field) field.focus();
  };

  /* ---- ปุ่มออกจากระบบ ---------------------------------------------------- */
  /* หมายเหตุ: กล่องยืนยัน "ออกจากระบบ" อยู่ใน sideLogout() ซึ่งเรียก logoutUser()
   * ต่อเมื่อผู้ใช้กดยืนยันแล้วเท่านั้น การครอบ logoutUser จึงไม่ไปยกเลิกเซสชัน
   * ตั้งแต่ตอนที่ยังไม่ได้ตอบว่าตกลง
   *
   * เรียกของแอปแบบทันที ไม่รอผลจากเซิร์ฟเวอร์ เพราะ sideLogout() สั่ง
   * switchView('dash') ต่อทันทีในบรรทัดถัดไป ถ้าเรารอ ลำดับจะสลับกัน
   *
   * ถ้ายกเลิกเซสชันฝั่งเซิร์ฟเวอร์ไม่สำเร็จ ต้องบอกให้รู้ ไม่ใช่เงียบ —
   * เพราะหน้าจอจะดูเหมือนออกแล้ว ทั้งที่คุกกี้ยังใช้ได้อยู่ ซึ่งอันตรายบนเครื่องที่ใช้ร่วมกัน */
  var appLogout = window.logoutUser;
  window.logoutUser = function () {
    signedOut = true; invalidateActor();
    var pending = session("DELETE");
    if (typeof appLogout === "function") appLogout();
    pending.then(function (result) {
      if (result.status !== 200) throw new Error("HTTP " + result.status);
    }).catch(function () {
      window.alert(
        "ออกจากระบบบนหน้าจอแล้ว แต่ยกเลิกเซสชันบนเซิร์ฟเวอร์ไม่สำเร็จ\n"
        + "ถ้าเครื่องนี้ใช้ร่วมกับคนอื่น กรุณาปิดเบราว์เซอร์ หรือกดออกจากระบบอีกครั้งเมื่อเชื่อมต่อได้"
      );
    });
  };

  /* ---- ตอนหน้าโหลด ------------------------------------------------------- */
  /* ข้อควรรู้ที่ทำให้เวอร์ชันแรกของไฟล์นี้ไม่ทำงานเลย:
   * ตัวแปรของแอปประกาศด้วย let (เช่น let currentUser, let userList)
   * ตัวแปรแบบนี้ "ไม่" กลายเป็นสมบัติของ window — window.userList จะเป็น undefined
   * ตลอดกาล แม้ตัวแปรจะมีค่าอยู่จริง ต้องเรียกด้วยชื่อเปล่า ๆ เท่านั้น
   * (ส่วนฟังก์ชันที่ประกาศด้วย function ... เป็นสมบัติของ window ตามปกติ)
   * ไฟล์นี้ถูกโหลดแบบ defer จึงรันหลังสคริปต์ของแอป และเห็นตัวแปรพวกนั้นได้ */
  /* needUsers = true ต้องรอจนรายชื่อผู้ใช้มาถึงจริงก่อน
   *
   * เพราะ let userList = [] มีค่าตั้งแต่วินาทีแรก การเช็คแค่ "มีตัวแปรไหม"
   * จึงเป็นจริงทันทีตั้งแต่ก่อน sbBoot() จะดึงอะไรลงมา ถ้าตั้ง currentUser
   * ตอนนั้น findUser() จะหาไม่เจอ → currentRole() คืนค่าว่าง → ไม่มีสิทธิ์อะไรเลย
   * แล้วพอรายชื่อมาถึงทีหลัง verifySession() ของแอปจะเห็นว่าหาไม่เจอ
   * แล้วเตะกลับหน้า Login เงียบ ๆ — อาการที่ผู้ใช้เห็นคือ
   * "ล็อกอินติด เห็นหน้า Dashboard แวบหนึ่ง แล้วเด้งกลับหน้า Login"
   *
   * ส่วนทางที่ต้องวาดฟอร์มล็อกอิน ห้ามรอ เพราะคนที่ยังไม่ล็อกอินจะไม่มีวัน
   * ได้รายชื่อผู้ใช้เลย รอไปก็ค้างอยู่อย่างนั้น */
  function whenAppReady(run, needUsers, isCurrent) {
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function poll() {
        if (isCurrent && !isCurrent()) { resolve(false); return; }
        tries += 1;
        var ready = typeof userList !== "undefined"
          && (!needUsers || userList.length > 0)
          && typeof window.afterUserChange === "function"
          && typeof window.switchView === "function";
        if (ready) {
          try { resolve(run() === true); } catch (error) { reject(error); }
          return;
        }
        if (tries > 100) {
          if (needUsers) showError("เข้าใช้งานสำเร็จ แต่โหลดรายชื่อผู้ใช้จากเซิร์ฟเวอร์ไม่ได้ — ลองรีเฟรชอีกครั้ง");
          resolve(false); return;
        }
        window.setTimeout(poll, 200);
      })();
    });
  }

  function beginActorAttempt(profiles) {
    if (signedOut) return Promise.resolve(false);
    if (actorAttempt) return actorAttempt;
    invalidateActor();
    var generation = actorGeneration, owner = typeof currentUser === "undefined" ? "" : currentUser;
    function isCurrent() { return !signedOut && generation === actorGeneration && currentUser === owner; }
    var sessionHandshake = session("GET");
    // Boolean transport readiness never authorizes a write or installs identity.
    window.__fsSessionHandshake = sessionHandshake.then(function (result) {
      return { status: result.status, authenticated: result.status === 200 && !!(result.data && result.data.authenticated) };
    });
    // The client consumes this signal, including transient transport failure.
    window.__fsSessionHandshake.catch(function () {});
    actorAttempt = sessionHandshake.then(function (result) {
      if (!isCurrent()) return false;
      var signedIn = result.status === 200 && result.data && result.data.authenticated;

      return whenAppReady(function () {
        if (typeof window.renderLoginView === "function") window.renderLoginView();
        if (!signedIn) {
          window.__fsSessionIdentity = { email: "" };
          // ไม่มีเซสชันแล้ว แต่หน้าจอยังจำได้ว่าล็อกอินอยู่ = สถานะครึ่ง ๆ กลาง ๆ
          // ที่ผู้ใช้จะเห็นหน้าจอทำงานแต่บันทึกอะไรไม่ได้เลย ต้องเตะกลับหน้า Login
          if (currentUser) {
            currentUser = "";
            impersonator = "";
            try {
              localStorage.setItem("fs_user", "");
              localStorage.setItem("fs_imp", "");
            } catch (error) { /* โหมดส่วนตัวของเบราว์เซอร์เขียนไม่ได้ ไม่เป็นไร */ }
            window.afterUserChange();
          }
          return false;
        }
        if (profiles && !profiles.some(function (row) {
          return row && row.name === result.data.name && row.data && row.data.name === result.data.name;
        })) return false;
        if (!result.data.name || !userList.some(function (user) { return user && user.name === result.data.name; })) {
          showError("เข้าใช้งานสำเร็จ แต่โหลดรายชื่อผู้ใช้จากเซิร์ฟเวอร์ไม่ได้ — ลองรีเฟรชอีกครั้ง");
          return false;
        }

        var nextEmail = String(result.data.email || "").trim().toLowerCase();
        var previousEmail = window.__fsSessionIdentity && window.__fsSessionIdentity.email;
        // The handshake remains boolean-only. The verified email is published
        // separately for the in-page visibility guard and is never accepted
        // from localStorage or a form field.
        // canFormulaEdit is the IAM FORMULA_EDIT decision the gateway computed
        // for this session; the page uses it only to show the formula editor
        // to accounts that were granted it (the gateway re-checks every save).
        window.__fsSessionIdentity = { email: nextEmail, canFormulaEdit: result.data.canFormulaEdit === true };
        if (currentUser === result.data.name && previousEmail === nextEmail) return true;

        currentUser = result.data.name;
        impersonator = "";
        window.afterUserChange();
        // A failed Create can finish staging a local recovery panel while this
        // initial handshake is still in flight. Do not let the late handshake
        // hide that panel and return the user to the dashboard.
        if (!document.getElementById("fsJobRecoveryPanel")) window.switchView("dash");
        return currentUser === result.data.name;
      }, signedIn, isCurrent);

    }).catch(function () { return false; }).finally(function () { actorAttempt = null; });
    window.__fsSessionActorReady = actorAttempt;
    return actorAttempt;
  }
  // Retrying is an explicit read-only operation. The caller supplies only the
  // profiles from its freshly completed core read; cached profiles cannot fill
  // a missing server match. Listeners and legacy boot/seed paths run once.
  window.__fsRetrySessionActor = function (profiles) {
    if (!Array.isArray(profiles)) return Promise.resolve(false);
    return beginActorAttempt(profiles);
  };
  beginActorAttempt();
})();
