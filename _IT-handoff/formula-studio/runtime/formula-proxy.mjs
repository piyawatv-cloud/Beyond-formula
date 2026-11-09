// Formula Studio runtime proxy
// ---------------------------------------------------------------------------
// หน้าที่ 3 อย่าง เท่านั้น:
//   1. เสิร์ฟ index.html สำเนาที่ผนึกไว้ พร้อมแทรกสคริปต์/CSS ของเราเข้าไป
//   2. เป็นประตูข้อมูลไปยัง Supabase โดยถือคีย์จริงไว้ฝั่งนี้ ไม่ให้ปรากฏในหน้าเว็บ
//   3. บอกสถานะตัวเองให้ด่านตรวจอ่านได้ (/__formula/health)
//
// สิ่งที่ไฟล์นี้จงใจไม่ทำ: ไม่เลือกสี ไม่สลับสี ไม่ตัดสินใจเรื่อง failover
// (งานนั้นเป็นของ formula-edge.mjs) การแยกแบบนี้ยกมาจากระบบ OPC โดยตรง
//
// ไม่มี dependency และไม่มีขั้นตอน build — ไฟล์นี้ถูก mount เข้าไปใน node:22-alpine
// ตรง ๆ ผลคือ: แก้ไฟล์นี้แล้วรีสตาร์ตคอนเทนเนอร์ = ได้โค้ดใหม่ทันที
// และผลข้างเคียงที่ต้องระวัง: ตราบใดที่ยังไม่รีสตาร์ต คอนเทนเนอร์ยังรันโค้ดเก่ากว่าไฟล์บนดิสก์
// ด่าน verify-formula-parity.sh มีข้อ "เทียบของที่เสิร์ฟจริงกับไฟล์บนดิสก์" ไว้จับเรื่องนี้

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { JobIntake } from "./job-intake.mjs";

const PORT = Number(process.env.PORT || 3000);
const COLOR = process.env.FORMULA_COLOR || "blue";
// สแตกจริงกับสแตกทดสอบเขียนบันทึกลงโฟลเดอร์เดียวกัน (mount เดียวกันโดยตั้งใจ)
// ถ้าบรรทัดไม่บอกว่ามาจากสแตกไหน ตัวเฝ้าจะนับของ testlab เป็นของสแตกจริง
// การทดลองบน testlab หนึ่งครั้งจึงทำให้เตือนว่าสแตกจริงมีปัญหา และของจริงก็ถูกกลบได้
const STACK = process.env.FORMULA_STACK || "formula";
const RELEASE_DIR = process.env.FORMULA_RELEASE_DIR || "/release";
const ASSET_DIR = process.env.FORMULA_ASSET_DIR || "/assets";
const LOG_DIR = process.env.FORMULA_LOG_DIR || "/logs";
// Delivery receipts are private operational state, never a second job master.
// Both colours mount the same durable directory; PostgreSQL remains authoritative.
const JOB_INTAKE_DIR = process.env.FORMULA_JOB_INTAKE_DIR || "";
const JOB_INTEGRITY_INTERVAL_MS = STACK === "formula" ? 60_000 : Math.max(50, Number(process.env.FORMULA_JOB_INTEGRITY_INTERVAL_MS) || 60_000);
const jobIntakeSourceSha = createHash("sha256").update(readFileSync(new URL("./job-intake.mjs", import.meta.url))).digest("hex");
const PUBLIC_ORIGIN = process.env.FORMULA_PUBLIC_ORIGIN || "";
const SB_ORIGIN = (process.env.SB_ORIGIN || "").replace(/\/+$/, "");
const SB_KEY = process.env.SB_SERVICE_KEY || process.env.SB_ANON_KEY || "";
const SB_KEY_KIND = process.env.SB_SERVICE_KEY ? "service_role" : "anon";

// ปลายทางข้อมูลย้ายมาอยู่ที่ PostgreSQL + PostgREST ในเครื่องแล้ว ไม่ใช่ Supabase
// สองอย่างนี้จึงต้องตั้งได้ ไม่ใช่ฝังตาย:
//
//   SB_REST_BASE     Supabase วางตารางไว้หลัง /rest/v1 เพราะมีประตูของตัวเองคั่นอยู่
//                    PostgREST เปล่าวางไว้ที่ราก (/fs_records) ตั้งเป็น "/" เมื่อยิงตรง
//   SB_UPSTREAM_AUTH Supabase ต้องได้ apikey + Bearer ทุกครั้ง แต่ PostgREST ที่ไม่ได้
//                    ตั้ง jwt-secret จะตอบ PGRST300 "Server lacks JWT secret" ทันทีที่
//                    เห็นหัวข้อ Authorization — แนบไปแล้วพังทุกคำขอ ไม่ใช่แค่ถูกเมิน
//
// 2026-08-25 เจ้าของสั่งหยุดเชื่อม Supabase หลังยืนยันว่าข้อมูลสองฝั่งตรงกันแล้ว
// ค่าเริ่มต้นจึงกลับด้าน: เดิมตั้งไว้เป็นของ Supabase เพื่อให้ถอยกลับง่าย
// แต่ "ถอยกลับง่าย" กับ "หลุดกลับไปเองโดยไม่มีใครรู้" เป็นสิ่งเดียวกันเมื่อไฟล์ค่าหาย
// ถ้า runtime/data.env หายไป ของเดิมจะเงียบ ๆ ไปคุย Supabase ต่อด้วยคีย์จริง
// ตอนนี้ค่าเริ่มต้นเป็นของ PostgREST ในเครื่อง ไฟล์ค่าหายเมื่อไหร่จะพังดัง ๆ ไม่ใช่เงียบ
const SB_REST_BASE = (process.env.SB_REST_BASE || "/").replace(/\/+$/, "");
const SB_UPSTREAM_AUTH = process.env.SB_UPSTREAM_AUTH === "bearer" ? "bearer" : "none";

// Backend selection is explicit. A cloud origin alone never enables Supabase.
// Missing traffic mode preserves the local default only; Supabase must opt in.
const CONFIGURED_BACKEND = process.env.FORMULA_BACKEND || "local";
const TRAFFIC_MODE = process.env.FORMULA_TRAFFIC_MODE || (CONFIGURED_BACKEND === "local" ? "serving" : "invalid");
const SB_IS_SUPABASE = /(^|\.)supabase\.(co|com|in)$/i.test((() => { try { return new URL(SB_ORIGIN).hostname.replace(/\.$/, ""); } catch { return ""; } })());
const BACKEND_CONFIG_VALID = (() => {
  if (!["local", "supabase"].includes(CONFIGURED_BACKEND) || !["serving", "standby"].includes(TRAFFIC_MODE) || !SB_KEY) return false;
  try {
    const origin = new URL(SB_ORIGIN);
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") return false;
    if (!["none", "bearer"].includes(process.env.SB_UPSTREAM_AUTH || "none")) return false;
    if (CONFIGURED_BACKEND === "local") return !SB_IS_SUPABASE;
    // Plain HTTP bearer transport is allowed only for loopback synthetic fixtures.
    const secureTransport = origin.protocol === "https:" || ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname);
    return secureTransport && SB_REST_BASE === "/rest/v1" && SB_UPSTREAM_AUTH === "bearer";
  } catch { return false; }
})();
const DATA_ENABLED = BACKEND_CONFIG_VALID && TRAFFIC_MODE === "serving";
// Standby/invalid configuration must not even init (chmod/fsync) shared receipts.
const jobIntake = DATA_ENABLED && JOB_INTAKE_DIR ? new JobIntake({ dir: JOB_INTAKE_DIR }) : null;
let intakeReady = !jobIntake;
let intakeCapacity = null;
if (jobIntake) {
  try { await jobIntake.init(); intakeReady = true; }
  catch { console.error("[ใบงาน] ที่รับข้อมูลกลางไม่พร้อม จึงยังไม่รับข้อมูลใหม่"); }
}

// ตัวตนของผู้ใช้มาจาก OPC Workflow แล้วจับคู่กับแถวใน fs_users ด้วยอีเมล
//
// ทำไมไม่ตรวจรหัสผ่านเอง: กฎ 2.4 ของ OPC เขียนไว้ตรง ๆ ว่าการเทียบความลับต้องผ่าน
// ตัวช่วยตัวเดียว ห้ามปลายทางไหนเขียนวิธีเทียบของตัวเอง (เคยมีสำเนาเก่าที่เทียบด้วย
// ความยาวหลงเหลืออยู่บนปลายทางที่ไม่ต้องล็อกอินถึงสองที่) เราจึงส่งต่อไปให้
// /api/auth/login ของ OPC ตัดสิน แล้วเอาแค่ "ใครคือคนนี้" กลับมา
const OPC_LOGIN_ORIGIN = process.env.OPC_LOGIN_ORIGIN || "";
const OPC_LOGIN_HOST = process.env.OPC_LOGIN_HOST || "opc.beyond-workflow.com";
const IAM_CONSUMER_ORIGIN = (process.env.IAM_CONSUMER_ORIGIN || "").replace(/\/+$/, "");
const IAM_CONSUMER_SHARED_SECRET = process.env.IAM_CONSUMER_SHARED_SECRET || "";
const IAM_CONSUMER_NAME = process.env.IAM_CONSUMER_NAME || "FORMULA_RUNTIME";
const IAM_ACCESS_CLIENT_ID = process.env.IAM_ACCESS_CLIENT_ID || "";
const IAM_ACCESS_CLIENT_SECRET = process.env.IAM_ACCESS_CLIENT_SECRET || "";
// เมื่อ Formula อยู่หลัง Cloudflare Access ให้ Access เป็นผู้ยืนยันบัญชี
// แล้วให้ IAM เป็นผู้ตัดสินว่าอีเมลนั้นมีสิทธิ์ Formula หรือไม่
// ค่าเริ่มต้นปิดไว้ เพื่อไม่ให้เปิดพฤติกรรมนี้ก่อนสร้าง Access application
const FORMULA_ACCESS_SSO_ENABLED = process.env.FORMULA_ACCESS_SSO_ENABLED === "true";
// สวิตช์ถอย — ปิดการบังคับสิทธิ์ผ่าน IAM ชั่วคราว แล้วกลับไปใช้สิทธิ์ระดับแอป (can()/requirePerm())
// เหมือนก่อนต่อ IAM · ตั้งได้โดย Runtime Operator เท่านั้น และต้องมีกำหนดเปิดกลับ
// มีไว้เพราะเคสจริง 19-21 ก.ย. 2026: IAM ตอบ SENSITIVE_GRANT_REQUIRED กับทุกคน
// ทั้งองค์กรจึงกลายเป็นอ่านอย่างเดียวเงียบ ๆ และงานสามวันค้างอยู่ในเบราว์เซอร์
const IAM_ENFORCE = process.env.FORMULA_IAM_ENFORCE !== "false";
const SESSION_SECRET = process.env.FORMULA_SESSION_SECRET || "";
const SESSION_TTL_MS = Number(process.env.FORMULA_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const COOKIE_SECURE = process.env.FORMULA_COOKIE_SECURE !== "false";
// โหมด session ของ IAM (OPC–Formula–IAM 2026-10-01) — ค่าเริ่มต้นปิด
// เปิดแล้ว: ตัวตนมาจาก session ของ IAM ที่ IAM ยืนยันทุกคำขอเท่านั้น (ไม่มีแคช)
// ไม่ออก fs_session เอง ไม่รับทางเข้า Cloudflare Access และบทบาทมาจาก IAM ไม่ใช่ fs_users
const FORMULA_IAM_SESSION_MODE = process.env.FORMULA_IAM_SESSION_MODE === "required";
// กุญแจที่ OPC ใช้เรียกประตูสร้างโปรไฟล์ Formula — ไม่ตั้ง = ประตูนี้ปิด
const FORMULA_PROVISIONING_SECRET = process.env.FORMULA_PROVISIONING_SECRET || "";
// สวิตช์ถอย FORMULA_IAM_ENFORCE=false ปิดการตรวจสิทธิ์ทั้งหมด — รวมกับโหมด IAM แล้ว admin
// อนุมัติได้ทุกขั้นโดยไม่มีใครถาม IAM · ห้ามเปิดคู่กัน ให้ตายตั้งแต่เปิดโปรแกรมดีกว่าเปิดช่อง
if (FORMULA_IAM_SESSION_MODE && process.env.FORMULA_IAM_ENFORCE === "false") {
  throw new Error("FORMULA_IAM_SESSION_MODE=required cannot run with FORMULA_IAM_ENFORCE=false");
}

// โทเคนสำหรับด่านตรวจเท่านั้น — ไม่เคยถูกส่งไปกับหน้าเว็บ และอ่านได้แค่ fs_meta
// มีไว้เพื่อให้ด่านตรวจพิสูจน์ได้ว่า "คีย์ฝั่งเซิร์ฟเวอร์ยังใช้การได้" โดยไม่ต้องมีเซสชันจริง
// ถ้าหลุดออกไปก็ทำอะไรไม่ได้มากกว่าอ่านตัวนับเลขงานกับรายชื่อ Tag
const PROBE_TOKEN = process.env.FORMULA_PROBE_TOKEN || "";

// ---------------------------------------------------------------------------
// 1. รุ่นที่ผนึกไว้ — อ่านแบบเข้มงวด ขาดไม่ได้ ถ้าอ่านไม่ได้ให้ตายตั้งแต่เปิดโปรแกรม
// ---------------------------------------------------------------------------
const releaseId = readFileSync(`${RELEASE_DIR}/CURRENT`, "utf8").trim();
const sealedHtml = readFileSync(`${RELEASE_DIR}/${releaseId}/index.html`, "utf8");
const releaseMeta = JSON.parse(readFileSync(`${RELEASE_DIR}/${releaseId}/meta.json`, "utf8"));

const sha = text => createHash("sha256").update(text).digest("hex");
const assetVersion = text => sha(text).slice(0, 12);

// ค่าแฮชของ "ซอร์สที่โปรเซสนี้อ่านตอนเปิดตัว"
//
// ไฟล์นี้ถูก mount เข้ามาตรง ๆ แปลว่าแก้ไฟล์บนดิสก์แล้วไฟล์ในคอนเทนเนอร์เปลี่ยนทันที
// แต่ "โปรเซสที่กำลังรัน" ยังเป็นโค้ดเก่าจนกว่าจะรีสตาร์ต — ช่องว่างตรงนี้เคยทำให้
// ด่านตรวจของ OPC ขึ้นว่าเรียบร้อย ทั้งที่ทั้งสองสีรันโค้ดเก่ากว่าไฟล์บนดิสก์
// การประกาศค่านี้ออกมาทำให้ด่านตรวจเทียบได้ตรง ๆ ว่าโปรเซสตามไฟล์ทันหรือยัง
const proxySourceSha = sha(readFileSync(new URL(import.meta.url), "utf8"));

// ---------------------------------------------------------------------------
// 2. ไฟล์ที่แทรกเข้าไปในหน้า — สองระดับ
//
//    เข้มงวด (readStrict)  : ขาดแล้วระบบไม่ปลอดภัยหรือทำงานผิด → ตายไปเลย
//    ผ่อนได้ (readOptional): เป็นแค่ของเพิ่ม → หายได้ เสียแค่ปุ่มเดียว
//
//    เหตุผลของระดับที่สอง: รายชื่อไฟล์ที่ mount ถูกล็อกตอน "สร้าง" คอนเทนเนอร์
//    ช่วงระหว่าง commit ที่เพิ่มไฟล์ใหม่ กับตอนที่ recreate คอนเทนเนอร์ทั้งสองสี
//    คอนเทนเนอร์จะถูกสั่งให้อ่านไฟล์ที่ตัวเองยังไม่มี ถ้าอ่านเข้มทุกไฟล์ = เว็บล่มทั้งเว็บ
// ---------------------------------------------------------------------------
// (ระดับ "เข้มงวด" คือ readFileSync ตรง ๆ — จะมีผู้ใช้จริงตอนเฟสเซสชัน
//  ยังไม่ประกาศไว้ตอนนี้ เพราะโค้ดที่ไม่มีใครเรียกคือโค้ดที่ไม่มีใครตรวจ)
const readOptional = name => {
  try {
    return readFileSync(`${ASSET_DIR}/${name}`, "utf8");
  } catch (error) {
    console.error(
      `[proxy] ไม่มี ${name} ใน ${ASSET_DIR} — ฟีเจอร์นั้นจะหายไปจนกว่าจะ recreate คอนเทนเนอร์:`,
      error?.code ?? error,
    );
    return "";
  }
};

const assets = new Map();
const registerAsset = (name, source, type) => {
  if (!source) return "";
  const route = `/fs-${name}`;
  assets.set(route, { source, type, version: assetVersion(source) });
  return route;
};

const mobileCssRoute = registerAsset(
  "mobile-fixes.css",
  readOptional("fs-mobile-fixes.css"),
  "text/css; charset=utf-8",
);
const sessionBridgeRoute = registerAsset(
  "session-bridge.js",
  readOptional("fs-session-bridge.js"),
  "application/javascript; charset=utf-8",
);
const jobSyncRoute = registerAsset(
  "job-sync.js",
  readOptional("fs-job-sync.js"),
  "application/javascript; charset=utf-8",
);

const chatJournalRoute = registerAsset(
  "chat-journal.js",
  readOptional("fs-chat-journal.js"),
  "application/javascript; charset=utf-8",
);
const rollbackChatRecoveryRoute = registerAsset(
  "rollback-chat-recovery.js",
  readOptional("fs-rollback-chat-recovery.js"),
  "application/javascript; charset=utf-8",
);
const chatRecoveryRoute = registerAsset(
  "chat-recovery.js",
  readOptional("fs-chat-recovery.js"),
  "application/javascript; charset=utf-8",
);
const adminActivityLogRoute = registerAsset(
  "admin-activity-log.js",
  readOptional("fs-admin-activity-log.js"),
  "application/javascript; charset=utf-8",
);

const scriptTag = route =>
  route ? `<script src="${route}?v=${assets.get(route).version}" defer></script>` : "";
const styleTag = route =>
  route ? `<link rel="stylesheet" href="${route}?v=${assets.get(route).version}">` : "";
// The sealed application renders ingredient rows with five inputs: name,
// weight, origin, purity and note. Its onIngChange handler writes indexes
// 3/4/5 as if origin started at 3, corrupting purity/note and throwing on 5.
// Keep this repair at the runtime boundary because the sealed source is not
// ours to edit. It runs after that source has declared IDB/calcRow/checkFDA
// and before a user can interact with the completed page.
const ingredientInputRepair = `<script data-fs-ingredient-input-repair="1">(function(){
  'use strict';
  if (typeof window.onIngChange !== 'function') return;
  window.onIngChange = function(inp, id) {
    var name = inp && typeof inp.value === 'string' ? inp.value : '';
    var entry = typeof IDB === 'object' && IDB ? IDB[name] : null;
    var row = document.getElementById('row_' + id);
    if (entry && row) {
      var inputs = row.querySelectorAll('input');
      if (inputs[2] && !inputs[2].value) inputs[2].value = entry.o;
      if (inputs[3] && !inputs[3].value) inputs[3].value = entry.p;
      if (inputs[4] && !inputs[4].value && entry.note) inputs[4].value = entry.note;
    }
    if (typeof calcRow === 'function') calcRow(id);
    var fdaCell = document.getElementById('fda_' + id);
    if (fdaCell && name.trim() && typeof checkFDA === 'function') {
      var result = checkFDA(name.trim(), 0);
      if (result.status === 'not_approved') {
        fdaCell.innerHTML = '<span class="' + result.cls + '">' + result.icon + '</span><div class="fda-tip">' + result.tip.replace(/\\n/g, '<br>') + '</div>';
      }
    }
  };
}());</script>`;
// This is deliberately inline and placed after the sealed application: deferred
// bridge assets can be missing from one colour after a mount change. Until the
// durable bridge replaces this placeholder, mutation globals must fail closed
// before their legacy handler changes the in-memory record or writes Activity.
const jobSyncBootstrapGuard = `<script data-fs-job-sync-bootstrap="1">(function(){
  'use strict';
  // The versions this page was served with. The runtime compares them with
  // /__formula/health and reloads an idle page after a deploy, so a tab left
  // open overnight does not keep running yesterday's code (14 ต.ค. 2569).
  window.__fsAssetVersions = ${JSON.stringify(Object.fromEntries([...assets].map(([route, a]) => [route, a.version])))};
  var pending = window.__fsJobSync || {ready:false};
  if (!pending.installed) { pending.ready = false; window.__fsJobSync = pending; }
  var names = ['generateDash','saveJobSection','toggleJobTag','saveChatFormula','chatSaveFormula','chatIngEdit','chatIngAdd','chatIngDel'];
  function unavailable(){
    var message = 'กำลังเตรียมระบบบันทึกใบงาน กรุณารอให้ระบบพร้อมก่อนสร้างหรือแก้ไขชุดข้อมูล แท็ก หรือสูตร';
    if (typeof window.alert === 'function') window.alert(message);
    return null;
  }
  names.forEach(function(name){
    var original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function(){
      if (!window.__fsJobSync || window.__fsJobSync.ready !== true) return unavailable();
      return original.apply(this,arguments);
    };
  });
}());</script>`;

// ---------------------------------------------------------------------------
// 3. เปลี่ยนปลายทางข้อมูลของแอปให้มาที่ประตูของเรา
//
//    ทำด้วยการแทนที่ข้อความสองบรรทัดในไฟล์ที่ผนึกไว้ ตอนเปิดโปรแกรมครั้งเดียว
//    ถ้าวันหนึ่งเจ้าของแอปเขียนสองบรรทัดนี้ใหม่จนหาไม่เจอ ตัวแปร gatewayPatchState
//    จะเป็น "unchanged" และด่านตรวจก่อนสลับสีจะไม่ยอมให้สลับ
//    — นี่คือด่านแบบเดียวกับ verify_auth_store_patch ของ OPC ที่จับกรณี
//      "ทุกอย่างเขียวหมด แต่ไม่มีใครใช้งานได้จริง"
// ---------------------------------------------------------------------------
const SB_URL_NEEDLE = /let SB_URL = '[^']*';/;
const SB_KEY_NEEDLE = /let SB_KEY = '[^']*';/;

const gatewayBase = PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN.replace(/\/+$/, "")}/sb` : "/sb";

const SB_URL_VALUE = /let SB_URL = '([^']*)';/;
const SB_KEY_VALUE = /let SB_KEY = '([^']*)';/;

function applyGatewayPatch(html) {
  const urlHits = html.match(new RegExp(SB_URL_NEEDLE, "g")) || [];
  const keyHits = html.match(new RegExp(SB_KEY_NEEDLE, "g")) || [];
  if (urlHits.length !== 1 || keyHits.length !== 1) {
    return {
      html,
      state: "unchanged",
      why: `พบ SB_URL ${urlHits.length} จุด และ SB_KEY ${keyHits.length} จุด (ต้องเป็นอย่างละ 1)`,
    };
  }

  // จับ "ค่าจริง" ที่อยู่ในไฟล์ไว้ก่อน เพื่อใช้ตรวจหลังแทนที่ว่าค่าพวกนี้หายไปหมดจริง
  // (ตรวจด้วยคำกว้าง ๆ อย่าง ".supabase.co" ใช้ไม่ได้ เพราะบรรทัดนั้นมีคอมเมนต์
  //  ตัวอย่างโดเมนต่อท้ายอยู่ ซึ่งไม่ใช่ค่าที่แอปใช้ และไม่ได้ทำให้คีย์รั่ว)
  const originalUrl = html.match(SB_URL_VALUE)?.[1] ?? "";
  const originalKey = html.match(SB_KEY_VALUE)?.[1] ?? "";

  // ค่าที่ใส่แทน SB_KEY ไม่ใช่ความลับ และไม่มีอำนาจอะไรเลย
  // เป็นแค่ค่าที่ไม่ว่าง เพื่อให้ sbOn() ของแอปยอมเปิดโหมดซิงก์
  // อำนาจจริงอยู่ที่คุกกี้เซสชัน ซึ่งเบราว์เซอร์แนบไปเองเพราะเป็นโดเมนเดียวกัน
  // ผลคือ: ใครเปิดหน้านี้โดยไม่ล็อกอิน ก็ไม่ได้อะไรติดมือไปเลย
  const deleteJobNeedle = `function canDeleteJob(r){
  if(!r || !currentUser) return false;
  return !!can('manageUsers');          // ลบงานได้เฉพาะ Role: Admin
}`;
  const deleteJobReplacement = `function canDeleteJob(r){
  if(!r || !currentUser) return false;
  return !!can('manageUsers') || isJobOwner(r);
}`;
  const jobDeleteButtonNeedle = [
    "function jobDelBtnHTML(r, tag){",
    "  if(!canDeleteJob(r)) return '';",
    "  const t = tag || 'button';",
    "  return `<${t} class=\"job-del\" title=\"ลบงาน ${esc(r.id)}\" onclick=\"event.stopPropagation();deleteJob('${r.id}')\">🗑</${t}>`;",
    "}",
  ].join("\n");
  const jobDeleteButtonReplacement = [
    "function jobDelBtnHTML(r, tag){",
    "  if(!canDeleteJob(r)) return '';",
    "  const t = tag || 'button';",
    "  const type = t==='button' ? ' type=\"button\"' : '';",
    "  return `<${t}${type} class=\"job-del\" data-fs-delete-job=\"1\" data-fs-job-id=\"${esc(r.id)}\" aria-label=\"ลบงาน ${esc(r.id)}\" title=\"ลบงาน ${esc(r.id)}\" onclick=\"event.stopPropagation();deleteJob('${r.id}')\"><span aria-hidden=\"true\">🗑</span><span class=\"fs-dashboard-delete-label\">ลบ</span></${t}>`;",
    "}",
  ].join("\n");
  const deleteCallbackNeedle = [
    "function doDeleteJob(r, c, msgN){",
    "  const id = r.id;",
    "  logAct('job','ลบ Job งาน',",
  ].join("\n");
  const deleteCallbackReplacement = [
    "function doDeleteJob(r, c, msgN){",
    "  const id = r.id;",
    "  if (typeof window.__fsBeforeDeleteJob !== 'function') { alert('ระบบกำลังเตรียมการบันทึกใบงาน กรุณาลองใหม่อีกครั้ง'); return; }",
    "  if (!window.__fsBeforeDeleteJob(id)) return;",
    "  logAct('job','ลบ Job งาน',",
  ].join("\n");
  // Keep the browser's Sales visibility rule aligned with the server-side
  // ownership contract. Older records may carry a decorated salesOwner
  // (for example "15.Sales แยม") while the signed Formula session carries
  // only the person's name. An exact createdBy comparison made those records
  // disappear for the owner even though the server would accept the same
  // owner proof. This is a visibility repair only; it does not broaden the
  // server permission boundary or allow cross-owner access.
  const ownerVisibilityNeedle = `function canSeeRecord(r){
  return !!r && (!can('ownOnly') || r.createdBy===currentUser);
}`;
  const ownerVisibilityReplacement = `function fsOwnerName(v){
  return String(v||'').replace(/^\\d+\\./,'').replace(/^(Sales|MKT)\\s*/i,'').replace(/^พี่/,'').trim().toLowerCase();
}
function fsOwnerEmail(v){
  return String(v||'').trim().toLowerCase();
}
function canSeeRecord(r){
  if(!r || !can('ownOnly')) return !!r;
  var actorEmail=fsOwnerEmail(typeof window !== 'undefined' && window.__fsSessionIdentity && window.__fsSessionIdentity.email);
  if(fsOwnerEmail(r.ownerEmail)) return !!actorEmail && fsOwnerEmail(r.ownerEmail)===actorEmail;
  if(r.createdBy===currentUser) return true;
  const owner=fsOwnerName(r.salesOwner), actor=fsOwnerName(currentUser);
  return !!owner && !!actor && owner===actor;
}`;
  // แก้สูตรได้เมื่อ IAM ให้ FORMULA_EDIT แก่บัญชีนั้น (owner 14 ต.ค. 2569: Sales/Oversea/OPC ที่ได้
  // grant รายคนต้องแก้สารได้) ตาราง ROLES ของแอปรู้จักแค่ Admin/PD/MKT และไม่รู้จักการ grant รายคน
  // ค่า canFormulaEdit มาจาก /sb/session (คำตัดสินของ IAM) ผ่าน fs-session-bridge.js — ไม่ใช่จากหน้าเว็บ
  // ประตูข้อมูลยังตรวจ FORMULA_EDIT เองทุกครั้ง ปุ่มที่โผล่จึงไม่ใช่สิทธิ์ เป็นแค่การไม่ซ่อนปุ่มจากคนที่มีสิทธิ์
  const capabilityNeedle = `function can(cap){
  const r = ROLES[currentRole()];
  return !!(r && r.can[cap]);
}`;
  const capabilityReplacement = `function can(cap){
  const r = ROLES[currentRole()];
  if(cap==='editFormula' && typeof window !== 'undefined' && window.__fsSessionIdentity && window.__fsSessionIdentity.canFormulaEdit===true) return true;
  return !!(r && r.can[cap]);
}`;
  // ประวัติเวอร์ชันต่อเครื่อง (fs_recbak) กิน 1.5M จาก 5M ของทุกคน ตั้งแต่ประวัติเก็บที่ระบบกลางแล้ว
  // (runtime/record-versions.sql + /__formula/job-versions) เพดานในเครื่องลดลงได้ · ของเก่าที่เกินเพดาน
  // ถูกตัดจากงานที่มีเวอร์ชันมากสุดก่อน (saveRecBak ของแอปเดิม) · ไม่แตะโครงสร้างข้อมูล
  const versionCapNeedle = "const RECBAK_MAX_CHARS = 1500000;";
  const versionCapReplacement = "const RECBAK_MAX_CHARS = 500000;";
  const patched = html
    .replace(SB_URL_NEEDLE, `let SB_URL = '${gatewayBase}';`)
    .replace(SB_KEY_NEEDLE, `let SB_KEY = 'session-cookie';`);
  if (patched.split(deleteJobNeedle).length !== 2
      || patched.split(jobDeleteButtonNeedle).length !== 2
      || patched.split(deleteCallbackNeedle).length !== 2
      || patched.split(ownerVisibilityNeedle).length !== 2
      || patched.split(capabilityNeedle).length !== 2
      || patched.split(versionCapNeedle).length !== 2) {
    return { html, state: "unchanged", why: "ไม่พบหรือพบซ้ำจุดเปลี่ยนสิทธิ์/ปุ่มลบงานที่อนุมัติไว้" };
  }
  const patchedWithDelete = patched
    .replace(deleteJobNeedle, deleteJobReplacement)
    .replace(jobDeleteButtonNeedle, jobDeleteButtonReplacement)
    .replace(deleteCallbackNeedle, deleteCallbackReplacement)
    .replace(ownerVisibilityNeedle, ownerVisibilityReplacement)
    .replace(capabilityNeedle, capabilityReplacement)
    .replace(versionCapNeedle, versionCapReplacement)
    .replace('// สิทธิ์: Role Admin เท่านั้น', '// สิทธิ์: Admin หรือเจ้าของงาน')
    .replace("ลบงานได้เฉพาะ Role: Admin\\nRole ของคุณ:", "ลบงานได้เฉพาะ Admin หรือเจ้าของงาน\\nRole ของคุณ:");

  if (originalKey && patchedWithDelete.includes(originalKey)) {
    return { html, state: "unchanged", why: "หลังแทนที่แล้วยังพบคีย์เดิมค้างอยู่ในไฟล์" };
  }
  if (originalUrl && patchedWithDelete.includes(originalUrl)) {
    return { html, state: "unchanged", why: "หลังแทนที่แล้วยังพบต้นทาง Supabase เดิมค้างอยู่ในไฟล์" };
  }
  return { html: patchedWithDelete, state: "rewritten", why: "", originalUrl, originalKey };
}

const patch = applyGatewayPatch(sealedHtml);
const gatewayPatchState = patch.state;
if (gatewayPatchState !== "rewritten") {
  console.error(`[proxy] เปลี่ยนปลายทาง Supabase ไม่สำเร็จ: ${patch.why}`);
}

// ---------------------------------------------------------------------------
// 4. ประกอบหน้าเว็บและล็อกการบันทึกจน deferred job bridge พร้อม
// ---------------------------------------------------------------------------
// Preserve the sealed build identity for the existing deployment gate without displaying it to users.
const buildIdentity = String(releaseMeta.buildStamp || '').replace(/[&"<>]/g, ch => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[ch]));
const shellMarker = `<meta name="fs-shell" content="sealed:${releaseId}:${COLOR}"><meta name="fs-build" content="${buildIdentity}">`;
const createButtonAnchor = '<button class="btn btn-p" id="btnCreate" onclick="generateDash()">';
const createNoticeAnchor = '<span id="gen_err" style="color:var(--re);font-size:12px"></span>';
const nextIdSource = patch.html.match(/function nextRecordId\(\)\{[\s\S]*?\n\}/)?.[0];
// Only the immutable approved allocator body may be composed; unknown semantics block deployment.
const approvedNextIdHash = "253147f6ebbcb195366b9e9bd2c53ec0e7dce3081af524e10f6eccb5af771d41";
const nextIdCompatible = Boolean(nextIdSource)
  && sha(nextIdSource) === approvedNextIdHash
  && patch.html.split('function nextRecordId(){').length === 2
  && nextIdSource.includes('while(pooled && sbIdPool.length)')
  && /  if\(pooled\) sbTopUpIdPool\(\);[\s\S]*\n\}$/.test(nextIdSource);
const nextIdGuard = `function nextRecordId(){
  const stopCreation = message => {
    const field = document.getElementById('gen_err');
    if(field){ field.textContent = message; field.setAttribute('role','alert'); }
    window.alert(message);
    throw new Error(message);
  };
  if(!window.__fsJobSync || !window.__fsJobSync.ready
    || typeof window.__fsJobSync.canCreate !== 'function' || !window.__fsJobSync.canCreate()){
    stopCreation('ยังสร้างใบงานไม่ได้ ระบบบันทึกยังไม่พร้อม ข้อมูลในฟอร์มยังอยู่ กรุณารอแล้วลองบันทึกอีกครั้ง');
  }`;
const guardedNextId = nextIdCompatible ? nextIdSource
  .replace('function nextRecordId(){', nextIdGuard)
  .replace(/  if\(pooled\) sbTopUpIdPool\(\);[\s\S]*\n\}$/, `  if(pooled) sbTopUpIdPool();
  stopCreation('ยังขอเลขใบงานจากระบบกลางไม่ได้ ข้อมูลในฟอร์มยังอยู่ กรุณาตรวจการเชื่อมต่อแล้วลองบันทึกอีกครั้ง');
}`) : nextIdSource;
const jobSubmitCompatible = [createButtonAnchor, createNoticeAnchor]
  .every(anchor => patch.html.split(anchor).length === 2) && nextIdCompatible;
const runtimeBootAnchor = "sbBoot();";
// The sealed page used to start its full pull before the deferred runtime
// asset was installed.  That allowed the asset to start a second full pull at
// the same time.  Delegate the one call to the mounted runtime so it can own
// the startup lock and keep large history hydration off the critical path.
const runtimeBootCompatible = patch.html.split(runtimeBootAnchor).length === 2;
const runtimeBootMarker = "window.__fsRuntimeBoot = function(){ return sbBoot(); };";
const activityJobCellAnchor = `<td>\${e.job?\`<span class="chk-id">\${esc(e.job)}</span>\`:'—'}</td>`;
const activityJobCellReplacement = `<td>\${e.job?\`<button type="button" class="rec-idlink fs-activity-job-link" data-fs-activity-job-link="1" data-fs-activity-job-id="\${esc(e.job)}" aria-label="เปิดรายละเอียดใบงาน \${esc(e.job)}" title="เปิดรายละเอียดใบงาน \${esc(e.job)}" onclick="return window.openRecordPopup(this.getAttribute('data-fs-activity-job-id'))">\${esc(e.job)}</button>\`:'—'}</td>`;
const activityLogCompatible = patch.html.split(activityJobCellAnchor).length === 2;
// Validate the sealed view before enabling the trusted-session presentation gate.
// A changed/missing contract degrades release readiness; the current approved
// runtime keeps serving until deployment checks accept a compatible release.
const adminActivityNavAnchor = `<button class="side-item" id="sideActivities" style="display:none" onclick="switchView('act')">`;
const adminActivityViewAnchor = '<div id="actView" class="view">\n  <div id="actContent"></div>\n</div>';
const adminActivitySwitchAnchor = "if(v==='act' && !can('manageUsers'))";
const adminActivityRenderAnchor = "function renderActivities(){\n  const el = document.getElementById('actContent');\n  if(!el) return;\n  if(!can('manageUsers'))";
const adminActivityLogCompatible = Boolean(adminActivityLogRoute) && Boolean(sessionBridgeRoute)
  && [adminActivityNavAnchor, adminActivityViewAnchor, adminActivitySwitchAnchor, adminActivityRenderAnchor]
    .every(anchor => patch.html.split(anchor).length === 2);
const adminActivityAllowed = "(typeof window.__fsAdminActivityLogAllowed==='function' && window.__fsAdminActivityLogAllowed())";
const adminActivityLogStyle = `<style data-fs-admin-activity-log-style="1">
html:not([data-fs-admin-activity-log="ready"]) #sideActivities,
html:not([data-fs-admin-activity-log="ready"]) #actView{display:none!important}
</style>`;
const adminActivityLogBootstrap = `<script data-fs-admin-activity-log-bootstrap="1">window.__fsAdminActivityLogCompatible=${adminActivityLogCompatible};</script>`;

// Customer Data renders a wide table. Keep its action column visible while
// horizontally scrolling so the scoped delete control is usable on this page,
// including narrow browser widths. Authorization stays in canDeleteJob/deleteJob.
const recordsActionHeadAnchor = '<th>รหัส</th><th>แบรนด์</th><th>ลูกค้า</th><th>รูปแบบ</th><th>#สาร</th><th>วันที่สร้าง</th><th>ผู้สร้าง</th><th>Chat</th><th>สถานะ</th><th></th>';
const recordsActionHeadReplacement = '<th>รหัส</th><th>แบรนด์</th><th>ลูกค้า</th><th>รูปแบบ</th><th>#สาร</th><th>วันที่สร้าง</th><th>ผู้สร้าง</th><th>Chat</th><th>สถานะ</th><th class="rec-actions-head">การทำงาน</th>';
const recordsActionCellAnchor = '      <td style="white-space:nowrap">\n        <button class="btn btn-s btn-sm" onclick="openRecordPopup(\'${r.id}\')">รายละเอียด</button>';
const recordsActionCellReplacement = '      <td class="rec-actions" style="white-space:nowrap">\n        <button class="btn btn-s btn-sm" onclick="openRecordPopup(\'${r.id}\')">รายละเอียด</button>';
const recordsActionUxCompatible = patch.html.split(recordsActionHeadAnchor).length === 2
  && patch.html.split(recordsActionCellAnchor).length === 2;
const recordsActionStyle = `<style data-fs-record-actions="1">
.rec-actions-head,.rec-actions{position:sticky;right:0;background:var(--card);z-index:2;box-shadow:-8px 0 12px rgba(60,64,67,.10)}
.rec-actions-head{z-index:3;text-align:center}
.rec-actions .job-del{width:auto;min-width:48px;padding:0 8px;border:1px solid #f5c2c0;border-radius:4px;color:var(--re);font-size:13px}
.fs-dashboard-delete-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.rec-actions .fs-dashboard-delete-label{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;white-space:nowrap;font-family:'Noto Sans Thai',sans-serif;font-size:12px;margin-left:4px}
.rec-actions .job-del:hover{background:#FCE8E6;color:var(--re)}
.rec-actions .job-del:focus-visible{outline:2px solid #1A73E8;outline-offset:2px}
@media(max-width:640px){.rec-actions .btn-g{display:none}}
</style>`;
const guardedHtml = (nextIdCompatible ? patch.html.replace(nextIdSource, guardedNextId) : patch.html)
  .replace(runtimeBootAnchor, runtimeBootCompatible ? runtimeBootMarker : runtimeBootAnchor)
  .replace(adminActivitySwitchAnchor, `if(v==='act' && !${adminActivityAllowed})`)
  .replace(adminActivityRenderAnchor, adminActivityRenderAnchor.replace("!can('manageUsers')", `!${adminActivityAllowed}`))
  .replace(activityJobCellAnchor, activityLogCompatible ? activityJobCellReplacement : activityJobCellAnchor)
  .replace(recordsActionHeadAnchor, recordsActionUxCompatible ? recordsActionHeadReplacement : recordsActionHeadAnchor)
  .replace(recordsActionCellAnchor, recordsActionUxCompatible ? recordsActionCellReplacement : recordsActionCellAnchor)
  .replace(/<div class="hdr-sub">[^<]*<\/div>/, '<div class="hdr-sub">ระบบจัดทำใบงานและประสานงาน</div>')
  .replace("txt = 'ซิงก์ไม่สำเร็จ — กดเพื่อลองใหม่'", "txt = 'เชื่อมต่อไม่สำเร็จ — กดเพื่อลองใหม่'")
  .replace("txt = 'กำลังซิงก์…'", "txt = 'กำลังเชื่อมต่อระบบกลาง…'")
  .replace("txt = 'ซิงก์แล้ว · อ่านอย่างเดียว'", "txt = 'เชื่อมต่อแล้ว · ดูข้อมูลได้อย่างเดียว'")
  .replace("txt = 'ซิงก์แล้ว'", "txt = 'เชื่อมต่อระบบกลางแล้ว'")
  .replace("'ข้อผิดพลาด: ' + sbErr + '\\nกดเพื่อลองซิงก์ใหม่'", "'ยังเชื่อมต่อระบบกลางไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'")
  .replace('ข้อมูลซิงก์กับเซิร์ฟเวอร์กลาง — กดเพื่อซิงก์ทันที', 'สถานะการเชื่อมต่อระบบกลาง — กดเพื่ออัปเดตข้อมูล')
  .replace(createButtonAnchor, '<button class="btn btn-p" id="btnCreate" onclick="generateDash()" disabled aria-disabled="true" aria-describedby="gen_err">')
  .replace(createNoticeAnchor, '<span id="gen_err" style="color:var(--re);font-size:12px" role="status" data-fs-job-preparing="1">กำลังเตรียมระบบบันทึกใบงาน กรุณารอสักครู่</span>');

const servedHtml = guardedHtml
  .replace("<head>", `<head>${shellMarker}`)
  .replace("</head>", `${styleTag(mobileCssRoute)}${recordsActionUxCompatible ? recordsActionStyle : ''}${adminActivityLogStyle}</head>`)
  .replace("</body>", `${ingredientInputRepair}${jobSyncBootstrapGuard}${adminActivityLogBootstrap}${scriptTag(sessionBridgeRoute)}${scriptTag(adminActivityLogRoute)}${scriptTag(chatJournalRoute)}${scriptTag(chatRecoveryRoute)}${scriptTag(jobSyncRoute)}</body>`);

const servedHtmlBuffer = Buffer.from(servedHtml, "utf8");
const jobSyncFunctions = ["saveRecordsStore", "sbApply", "sbPush", "sbUpsert", "stableStr", "sendChatMsg", "renderChat", "generateDash", "saveJobSection", "bakRecord", "saveRecBak", "logAct", "toggleJobTag", "saveChatFormula", "chatSaveFormula", "chatIngEdit", "chatIngAdd", "chatIngDel"];
const generatorStart = patch.html.indexOf("function generateDash()");
const generatorEnd = generatorStart >= 0 ? patch.html.indexOf("// ========== RENDER DASHBOARD", generatorStart) : -1;
const generatorSource = generatorEnd > generatorStart ? patch.html.slice(generatorStart, generatorEnd) : "";
const generatorActivityCompatible = /logAct\('job',\s*editing\s*\?\s*'แก้ไขชุดข้อมูล'\s*:\s*'สร้างชุดข้อมูลใหม่'[\s\S]*?,\s*d\.id\);[\s\S]*?saveRecordsStore\(\);/.test(generatorSource);
const jobSyncActivityCompatible = [
  /function\s+saveJobSection\s*\([\s\S]*?saveRecordsStore\(\);[\s\S]*?logAct\('job','แก้ไขชุดข้อมูล \('\+s\.title\+'\)'/,
  /function\s+toggleJobTag\s*\([\s\S]*?saveRecordsStore\(\);[\s\S]*?logAct\('job',\s*[^;\n]*(?:ติด Tag|ถอด Tag)/,
  /function\s+saveChatFormula\s*\([\s\S]*?logAct\('formula','แก้สูตรในห้องแชท \(กดบันทึก\)'[\s\S]*?chatSaveFormula\(/,
  /function\s+chatIngEdit\s*\([\s\S]*?logAct\('formula','แก้สูตรในห้องแชท'[\s\S]*?chatSaveFormula\(/,
  /function\s+chatIngAdd\s*\([\s\S]*?logAct\('formula','เพิ่มสารในสูตร \(แชท\)'[\s\S]*?chatSaveFormula\(/,
  /function\s+chatIngDel\s*\([\s\S]*?logAct\('formula','ลบสารออกจากสูตร \(แชท\)'[\s\S]*?chatSaveFormula\(/,
].every(contract => contract.test(patch.html)) && generatorActivityCompatible;
// The sealed page still contains legacy onchange handlers. The mounted
// runtime asset must expose the explicit-save draft boundary; a stale asset
// would silently restore blur-to-save behaviour while sealed source checks
// continued to pass.
const jobSyncDraftCompatible = Boolean(jobSyncRoute)
  && /var\s+formulaDrafts\s*=\s*Object\.create\(null\)/.test(assets.get(jobSyncRoute)?.source || "")
  && /__fsCommitChatFormula/.test(assets.get(jobSyncRoute)?.source || "")
  && /window\.saveChatFormula\s*=/.test(assets.get(jobSyncRoute)?.source || "")
  && /window\.saveModifyFormula\s*=/.test(assets.get(jobSyncRoute)?.source || "");
const jobSyncCompatible = jobSyncFunctions
  .every(name => new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(patch.html)) && jobSyncActivityCompatible && jobSubmitCompatible && jobSyncDraftCompatible && runtimeBootCompatible && activityLogCompatible && recordsActionUxCompatible;

// CSP — ด่านที่สองของประตูข้อมูล
//
// connect-src ไม่มี *.supabase.co อยู่ในรายการโดยเจตนา ถ้าการแทนที่ข้างบนพลาด
// เบราว์เซอร์จะยิงตรงไป Supabase ไม่ได้เลย แอปจะขึ้น error ให้เห็น
// แทนที่จะแอบทำงานได้ต่อโดยที่คีย์หลุดอยู่ — พังแบบปิด ไม่ใช่พังแบบเปิด
//
// 'unsafe-inline' ของ script-src เลี่ยงไม่ได้ เพราะโค้ดทั้งแอปอยู่ใน index.html ไฟล์เดียว
// การจะเอาออกต้องแก้ตัวแอป ซึ่งขัดกฎ "ไฟล์เดียว" ของโปรเจกต์นั้น
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://cdnjs.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function baseHeaders(extra = {}) {
  return {
    "x-formula-runtime-color": COLOR,
    "x-formula-release": releaseId,
    "x-fs-sb-gateway": gatewayPatchState,
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 5. ประตูข้อมูล /sb/*
//
// ถือคีย์ไว้ฝั่งเซิร์ฟเวอร์ · จำกัดตารางและเมธอด · บังคับนโยบายรายฟิลด์ · บันทึกทุกครั้ง
//
// ด่านนี้ไม่ใช่ด่านเดียว — runtime/data-policy.sql เป็นด่านชั้นที่สองอยู่ในฐาน
// สองชั้นแบ่งงานกันชัด ๆ และตั้งใจไม่ทำซ้ำกัน:
//
//   ฐานเป็นเจ้าของ "กฎที่จริงเสมอ ไม่ว่าใครเรียก" — ตรึง role/pass ตอนแก้แถวเดิม,
//   ห้ามแก้/ลบ Activity Log, ห้ามเขียน reccounter ตรง, เก็บสำเนาก่อนลบทุกครั้ง
//   กฎพวกนี้ยังทำงานต่อให้ไฟล์นี้มีบั๊ก หรือมีคนยิงตรงเข้า PostgREST ข้ามเราไป
//
//   proxy เป็นเจ้าของ "กฎที่ต้องรู้ว่าใครกำลังเรียก" — ฐานไม่รู้จักใครเลย ทุกคำขอ
//   มาถึงในนาม anon เหมือนกันหมด สิ่งที่มีแต่ที่นี่เท่านั้นที่ทำได้คือ
//   admin เท่านั้นที่สร้าง/ลบผู้ใช้และเปลี่ยนบทบาท · ประทับชื่อผู้ทำลง Activity Log
//   ตามเซสชันจริง · และกรองของที่ฐานจะปฏิเสธออกก่อน ไม่ให้แอปไปชนกำแพง
// ---------------------------------------------------------------------------

// >>> นโยบายรายฟิลด์ — เริ่มบล็อกที่ tests/write-policy.test.mjs ยกออกไปรันของจริง
//     (เทสต์ที่ assert แค่ว่ามีข้อความอยู่ในไฟล์ เคยผ่านทั้งที่กฎข้างในผิด)

const ALLOWED_RPC = new Set(["fs_next_rec_seq", "fs_save_record"]);

// รายชื่อบทบาทของแอป (ROLE_KEYS ใน index.html) — คัดลอกมา จึงเคลื่อนจากต้นทางได้
// tests/write-policy.test.mjs อ่านบันเดิลที่ผนึกไว้จริงมาเทียบ เคลื่อนเมื่อไหร่แดงทันที
const KNOWN_ROLES = ["admin", "pd", "ra", "rd", "sales", "oversea", "opc", "mkt", "purchasing"];

// Formula's own role policy is the source for normal workflow writes.  IAM's
// direct FORMULA_EDIT grant remains a separate, sensitive check for changes to
// formula ingredients and other protected Formula fields.
const FORMULA_DATA_ROLES = new Set(["admin", "sales", "oversea", "opc", "mkt"]);
const FORMULA_EDIT_ROLES = new Set(["admin", "pd", "mkt"]);
const FORMULA_CHAT_ROLES = new Set(["admin", "pd", "ra", "rd", "sales", "oversea", "opc", "mkt", "purchasing"]);
// Approval ownership is deliberately explicit.  The browser sends PostgREST
// filters (for example `part=eq.pd`), so never compare the raw filter text to
// a part name and never accept an unscoped DELETE.
const APPROVAL_PART_NAMES = new Set(["pd", "ra", "rd", "sales"]);
const FORMULA_APPROVAL_PARTS = {
  pd: ["pd"],
  ra: ["ra"],
  rd: ["rd"],
  sales: ["sales"],
};

function rolePartAllowed(role, part) {
  if (!APPROVAL_PART_NAMES.has(part)) return false;
  return role === "admin"
    || (Object.hasOwn(FORMULA_APPROVAL_PARTS, role) && FORMULA_APPROVAL_PARTS[role].includes(part));
}

function validApprovalJobFilter(value) {
  const raw = String(value ?? "");
  const eq = /^eq\.([A-Z]+[0-9]{5})$/.exec(raw);
  if (eq) return true;
  const list = /^in\.\(([^()]+)\)$/.exec(raw);
  if (!list) return false;
  const ids = list[1].split(",").map(token => {
    const value = token.trim();
    if (/^[A-Z]+[0-9]{5}$/.test(value)) return value;
    const quoted = /^"([A-Z]+[0-9]{5})"$/.exec(value);
    return quoted?.[1] || null;
  });
  return ids.length > 0
    && ids.every(Boolean)
    && new Set(ids).size === ids.length;
}

function parseJobIdsFilter(value) {
  const raw = String(value ?? "");
  const eq = /^eq\.([A-Z]+[0-9]{5})$/.exec(raw);
  if (eq) return [eq[1]];
  const list = /^in\.\(([^()]+)\)$/.exec(raw);
  if (!list) return null;
  const ids = list[1].split(",").map(token => {
    const value = token.trim();
    if (/^[A-Z]+[0-9]{5}$/.test(value)) return value;
    const quoted = /^"([A-Z]+[0-9]{5})"$/.exec(value);
    return quoted?.[1] || null;
  });
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  return ids;
}

function normalizedOwnerName(value) {
  return String(value || "")
    .replace(/^\d+\./, "")
    .replace(/^(Sales|MKT)\s*/i, "")
    .replace(/^พี่/, "")
    .trim()
    .toLowerCase();
}

function normalizedOwnerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function storedJobOwner(data, session) {
  if (!data || typeof data !== "object") return false;
  const recordEmail = normalizedOwnerEmail(data.ownerEmail);
  const sessionEmail = normalizedOwnerEmail(session?.email);
  // A canonical owner identity is intentionally exclusive: once present,
  // a duplicate display name must never regain access through the legacy path.
  if (recordEmail) return Boolean(sessionEmail && recordEmail === sessionEmail);
  const name = String(session?.name || "").trim();
  if (!name) return false;
  if (String(data.createdBy || "").trim() === name) return true;
  const owner = String(data.salesOwner || "").trim();
  const normalizedOwner = normalizedOwnerName(owner);
  const normalizedName = normalizedOwnerName(name);
  return Boolean(normalizedOwner && normalizedName) && normalizedOwner === normalizedName;
}

function ownershipChanged(before, after) {
  return String(before?.createdBy || "") !== String(after?.createdBy || "")
    || String(before?.salesOwner || "") !== String(after?.salesOwner || "")
    || normalizedOwnerEmail(before?.ownerEmail) !== normalizedOwnerEmail(after?.ownerEmail);
}

/* ใบงานเก่าที่ยังไม่มี ownerEmail รับอีเมลที่ยืนยันแล้วของเจ้าของเดิมได้หนึ่งครั้ง
 *
 * ตั้งแต่ 12 ต.ค. 2569 client เติม ownerEmail ให้แถวที่คนแก้ในเครื่อง ถ้านับการเติมนี้
 * เป็น "เปลี่ยนเจ้าของ" ทุกการแก้ใบงานเก่าของคนที่ไม่ใช่ admin จะถูกปฏิเสธ
 * (FORMULA_OWNER_IMMUTABLE) ทั้งที่คนแก้คือเจ้าของตามชื่อเดิม — ยอมให้เฉพาะเมื่อ
 * แถวเดิมไม่มีอีเมล ชื่อเจ้าของไม่เปลี่ยน อีเมลใหม่คืออีเมลของเซสชันนี้ และเซสชันนี้
 * เป็นเจ้าของตามกติกาชื่อเดิม · อีเมลคนอื่น หรือทับอีเมลที่มีอยู่แล้ว ยังถือเป็นเปลี่ยนเจ้าของ
 */
function ownerEmailAdopted(before, after, session) {
  if (!before || !after) return false;
  if (normalizedOwnerEmail(before.ownerEmail)) return false;
  const sessionEmail = normalizedOwnerEmail(session?.email);
  if (!sessionEmail || normalizedOwnerEmail(after.ownerEmail) !== sessionEmail) return false;
  if (String(before.createdBy || "") !== String(after.createdBy || "")
      || String(before.salesOwner || "") !== String(after.salesOwner || "")) return false;
  return storedJobOwner(before, session);
}

function ownershipChangedBy(before, after, session) {
  return ownershipChanged(before, after) && !ownerEmailAdopted(before, after, session);
}

function newJobOwnershipIsAcceptable(data, session) {
  const actor = String(session?.name || "").trim();
  const actorEmail = normalizedOwnerEmail(session?.email);
  const ownerEmail = normalizedOwnerEmail(data?.ownerEmail);
  if (ownerEmail) return Boolean(actorEmail && ownerEmail === actorEmail);
  // The old sealed page may still submit a new row without ownerEmail. Keep
  // that path readable during the migration window; the client runtime adds
  // the canonical email before the save is queued.
  const createdBy = String(data?.createdBy || "").trim();
  const salesOwner = String(data?.salesOwner || "").trim();
  if (salesOwner) return storedJobOwner(data, session);
  if (!createdBy || createdBy === actor) return true;
  // Older sealed create flows used the role slug in createdBy and did not yet
  // carry salesOwner. Preserve that wire contract; a named salesOwner still
  // has to match the authenticated actor above.
  return createdBy.toLowerCase() === String(session?.role || "").trim().toLowerCase();
}

async function enforceOwnershipBaseline(args, session, decision, permissionCheck = iamPermission) {
  if (decision?.allowed !== true || args?.p_expected === null || !ownershipChangedBy(args.p_expected, args.p_data, session)) {
    return decision;
  }
  if (String(session?.role || "") !== "admin") return { allowed: false, reason_code: "FORMULA_OWNER_IMMUTABLE" };
  return permissionCheck(session.centralUserId, "FORMULA_EDIT");
}

const OWNER_DELETE_RESERVATION_TTL_MS = Number(process.env.FORMULA_OWNER_DELETE_RESERVATION_TTL_MS || 120_000);
const ownerDeleteReservations = new Map();

function ownerDeleteReservationKey(session) {
  return `${String(session?.centralUserId || "")}|${String(session?.name || "")}`;
}

function rememberOwnerDelete(session, ids) {
  const key = ownerDeleteReservationKey(session);
  const now = Date.now();
  const current = ownerDeleteReservations.get(key) || new Map();
  for (const [id, expiresAt] of current) if (expiresAt <= now) current.delete(id);
  for (const id of ids) current.set(id, now + OWNER_DELETE_RESERVATION_TTL_MS);
  ownerDeleteReservations.set(key, current);
}

function ownerDeleteReserved(session, ids) {
  const key = ownerDeleteReservationKey(session);
  const current = ownerDeleteReservations.get(key);
  if (!current) return false;
  const now = Date.now();
  for (const [id, expiresAt] of current) if (expiresAt <= now) current.delete(id);
  const allowed = ids.length > 0 && ids.every(id => current.has(id));
  if (!current.size) ownerDeleteReservations.delete(key);
  return allowed;
}

async function deleteOwnerChildren(ids) {
  const filter = ids.length === 1 ? `eq.${ids[0]}` : `in.(${ids.join(",")})`;
  const results = await Promise.all(["fs_approvals", "fs_messages", "fs_chats"].map(table => {
    const query = new URLSearchParams({ job_id: filter }).toString();
    return fetch(`${SB_ORIGIN}${SB_REST_BASE}/${table}?${query}`, {
      method: "DELETE",
      headers: upstreamAuthHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
  }));
  return results.every(upstream => upstream.ok);
}

function approvalDeleteScope(role, partParam, jobParam) {
  // The job filter is mandatory.  Without it, even a valid part would delete
  // that approval across every job in the table.
  if (!validApprovalJobFilter(jobParam)) return null;
  const rawPart = String(partParam ?? "");
  if (!rawPart) {
    // The sealed admin delete flow removes the child approvals in bulk before
    // deleting the record.  Keep that operation job-scoped and require the
    // same Formula edit grant as the record DELETE itself.
    return role === "admin" ? { part: null, permission: "FORMULA_EDIT" } : { part: null, permission: null };
  }
  const match = /^eq\.([a-z]+)$/.exec(rawPart.toLowerCase());
  if (!match || !rolePartAllowed(role, match[1])) return null;
  const part = match[1];
  return { part, permission: `FORMULA_APPROVE_${part.toUpperCase()}` };
}

function formulaRoleCanWrite(role, table, method) {
  const normalizedRole = String(role || "");
  if (method === "DELETE") {
    if (table === "fs_approvals") return normalizedRole === "admin" || Object.hasOwn(FORMULA_APPROVAL_PARTS, normalizedRole);
    return normalizedRole === "admin";
  }
  if (table === "fs_records") return FORMULA_DATA_ROLES.has(normalizedRole) || FORMULA_EDIT_ROLES.has(normalizedRole);
  if (["fs_chats", "fs_messages", "fs_activities"].includes(table)) return FORMULA_CHAT_ROLES.has(normalizedRole);
  if (table === "fs_approvals") return normalizedRole === "admin" || Object.hasOwn(FORMULA_APPROVAL_PARTS, normalizedRole);
  if (table === "fs_meta") return FORMULA_DATA_ROLES.has(normalizedRole);
  if (table === "fs_users") return normalizedRole === "admin";
  return false;
}

function activityLogReadAllowed(session) {
  return session?.role === "admin";
}

function formulaSyncCanWrite(role) {
  return formulaRoleCanWrite(role, "fs_records", "POST")
    || formulaRoleCanWrite(role, "fs_chats", "POST")
    || formulaRoleCanWrite(role, "fs_activities", "POST");
}

// เมธอดที่แต่ละตารางรับได้ — สั้นกว่ารายการรวมเดิมโดยตั้งใจ
//
// นับในบันเดิลที่ผนึกไว้: แอปไม่เคยส่ง PATCH สักครั้ง (0 ที่) และไม่เคยลบ fs_activities
// หรือ fs_meta เลย · เมธอดที่ไม่มีใครใช้ คือประตูที่เปิดค้างไว้เฉย ๆ รอวันถูกใช้ผิด
const TABLE_METHODS = {
  // Saves require a captured baseline through fs_save_record. A legacy blind
  // upsert can overwrite a newer committed job even after the new client ACKs.
  fs_records: ["GET", "HEAD", "DELETE"],
  fs_chats: ["GET", "HEAD", "POST", "DELETE"],
  fs_messages: ["GET", "HEAD", "POST", "DELETE"],
  fs_approvals: ["GET", "HEAD", "POST", "DELETE"],
  fs_users: ["GET", "HEAD", "POST", "DELETE"],
  fs_activities: ["GET", "HEAD", "POST"],
  fs_meta: ["GET", "HEAD", "POST"],
};

/* ตัดสินว่าคำขอเขียนหนึ่งครั้งจะถูกส่งต่อในรูปไหน
 *
 * คืน "แถวที่แก้แล้ว" ไม่ใช่ "ผ่าน/ไม่ผ่าน" โดยตั้งใจ:
 * sbPush() ของแอปเรียง await เปลือย ๆ ต่อกันสิบกว่าบรรทัด มีแค่ msg กับ apv ที่ครอบ
 * try/catch ไว้ · ตอบไม่ใช่ 2xx หนึ่งครั้ง = ทุกบรรทัดหลังจากนั้นไม่ได้ทำงานเลย
 * แล้วป้ายบอกสถานะค้างว่าซิงก์ไม่ผ่านตลอดไป
 * ของที่เรา "ตั้งใจกรอง" จึงต้องกรองแล้วตอบสำเร็จ ส่วนของที่ "ไม่ควรมีทางเกิด"
 * (เมธอดนอกรายการ ตารางนอกรายการ) ตอบปฏิเสธดัง ๆ — สองอย่างนี้ไม่เหมือนกัน
 *
 * ฝั่งแอปกู้ตัวเองได้: มันจดสิ่งที่ส่งไปแล้วลง sbSnap จึงไม่ยิงซ้ำ และรอบดึงข้อมูล
 * เต็มรอบถัดไปเอาค่าจริงจากเซิร์ฟเวอร์มาทับให้เอง ค่าที่ถูกกรองจึงหายไป ไม่ใช่เพี้ยน
 *
 * stored = Map(ชื่อผู้ใช้ -> data ของแถวที่เก็บอยู่จริง) หรือ null ถ้าอ่านไม่ได้
 */
function applyWritePolicy({ table, method, rows, session, stored }) {
  const dropped = [];
  const roleChanges = [];
  const admin = String(session?.role || "") === "admin";
  const out = (value, skipUpstream = false, reject = "") =>
    ({ rows: value, skipUpstream, dropped, roleChanges, reject });

  if (method === "DELETE") {
    if (table === "fs_users" && !admin) {
      dropped.push({ key: "(ทั้งคำขอ)", why: "ลบผู้ใช้ได้เฉพาะ admin" });
      return out(null, true);
    }
    // ตารางที่เหลือลบได้ตามปกติ — ฐานเก็บสำเนาเข้า fs_archive ให้ก่อนเสมอ
    return out(null);
  }

  /* เนื้อคำขอที่ไม่ใช่รายการ ต้องกลายเป็นรายการก่อน ไม่ใช่ปล่อยผ่านไปเฉย ๆ
   *
   * บรรทัดเดิมเขียนว่า "ไม่ใช่รายการ = ส่งผ่าน" และมันอยู่ "เหนือ" กฎทุกข้อข้างล่าง
   * PostgREST รับทั้ง [{...}] และ {...} เท่ากัน ผลคือส่งก้อนเดียวขึ้นมาคำขอเดียว
   * = ข้ามด่านรายฟิลด์ทั้งหมด · เซลล์คนหนึ่งสร้างผู้ใช้บทบาท admin ได้
   * ปลอมชื่อผู้ทำในประวัติได้ และเขียนตัวนับเลขงานทับได้
   * (ผู้ตรวจจับได้ 24 ส.ค. หลังโค้ดขึ้นระบบไปแล้ว — เป็นรูจริง ไม่ใช่ข้อสงสัย)
   *
   * ห่อให้เป็นรายการแล้วปล่อยให้กฎที่เหลือทำงานตามปกติ ไม่ปฏิเสธดื้อ ๆ เพราะรูปแบบนี้
   * เป็นรูปแบบที่ปลายทางรับอยู่แล้ว การปฏิเสธจะทำรอบซิงก์พังทั้งรอบตามกฎ 3.3
   *
   * ส่วนที่ไม่ใช่ทั้งรายการและไม่ใช่ก้อนข้อมูล (ตัวเลข ข้อความ ว่างเปล่า) ปฏิเสธไปเลย
   * — ปลายทางเคยตอบ 201 ให้เนื้อคำขอที่เป็นข้อความเปล่า ๆ ซึ่งไม่มีทางเป็นสิ่งที่ตั้งใจ
   */
  let list = rows;
  if (!Array.isArray(list)) {
    if (list !== null && typeof list === "object") list = [list];
    else return out(rows, false, `เนื้อคำขอต้องเป็นรายการหรือก้อนข้อมูล ไม่ใช่ ${list === null ? "ค่าว่าง" : typeof list}`);
  }

  if (table === "fs_meta") {
    return out(
      list.filter(row => {
        if (row?.key !== "reccounter") return true;
        // ปล่อยไปถึงฐานเมื่อไหร่ ฐานโยน exception แล้วซิงก์ค้างถาวร
        // แอปส่งค่านี้เฉพาะตอน rpc ออกเลขให้ไม่ได้ (counterUp = !sbCap.seq && ...)
        // มาถึงตรงนี้เมื่อไหร่จึงแปลว่า rpc กำลังมีปัญหา — ต้องเห็นในบันทึก
        dropped.push({ key: "reccounter", why: "ตัวนับเลขงานออกได้ทางเดียวคือ rpc/fs_next_rec_seq" });
        return false;
      }),
    );
  }

  if (table === "fs_activities") {
    return out(
      list.map(row => {
        const data = { ...(row?.data || {}) };
        // ประทับเฉพาะ "ใครทำ" เพราะเบราว์เซอร์เขียน role:"admin" ลงประวัติได้ตามใจ
        //
        // ไม่แตะ uid — มันคือกุญแจกันรายการซ้ำ ไม่ใช่รหัสประจำตัว แอปเทียบ uid ทั้งฝั่ง
        // ตัวเอง (sbSnap.acts) และตอนดึงกลับ เขียนทับเมื่อไหร่ = ได้แถวซ้ำทุกรอบซิงก์
        // ไม่แตะ ts ด้วย เพราะมันอยู่สองที่ (คอลัมน์ ts และ data.ts) แก้ที่เดียวลำดับเพี้ยน
        if (session?.name) data.user = session.name;
        if (session?.role) data.role = session.role;

        /* เติม data.ts ให้เฉพาะตอนที่ "ไม่มี" — ไม่ใช่เขียนทับของที่มีอยู่
         *
         * 25 ส.ค. เจอว่าแถวประวัติที่ขาด data.ts คือยาพิษของรอบซิงก์ทั้งระบบ:
         * แอปอ่าน data.ts ไม่เจอ จึงสร้างรายการในเครื่องด้วย ts = 0 แล้ว uid กลายเป็น "0-xxxx"
         * เวลาดึงกลับ แอปสั่ง order=ts.desc limit=ACT_MAX (3000) แถว ts=0 อยู่ท้ายสุดของ 5,100 แถว
         * จึงไม่เคยอยู่ในชุดที่ดึงกลับมา → แอปคิดว่ายังไม่ได้ซิงก์ → ส่งซ้ำทุกรอบตลอดไป
         * และเพราะ uid ซ้ำ มันกลายเป็น UPDATE ที่ trigger append-only ข้ามให้เงียบ ๆ
         * ทุกชั้นตอบ 200 ไม่มี error สักบรรทัด แต่รอบซิงก์ถูกกินทิ้งเปล่า ๆ
         *
         * ต้นเหตุคือแถวทดสอบที่เราเขียนเข้าฐานตรง ๆ โดยตั้งแต่คอลัมน์ ts ไม่ได้ตั้ง data.ts
         * — ของที่เขียนข้ามแอปเข้าไป ต้องมีรูปร่างเหมือนที่แอปเขียนเอง ไม่งั้นแอปจะสำลัก */
        if (data.ts === undefined || data.ts === null) {
          data.ts = Number(row?.ts) > 0 ? Number(row.ts) : Date.now();
        }
        return { ...row, data };
      }),
    );
  }

  if (table === "fs_users") {
    if (!stored) {
      // อ่านแถวเดิมมาเทียบไม่ได้ = แยกไม่ออกว่าอันไหนผู้ใช้ใหม่ อันไหนเปลี่ยนบทบาท
      // ตัดสินใจแบบปิด: ไม่ส่งอะไรขึ้นไปเลย ค่าจริงบนเซิร์ฟเวอร์ไม่ถูกแตะ และส่งเสียงดัง
      dropped.push({ key: "(ทั้งคำขอ)", why: "อ่าน fs_users เดิมมาเทียบไม่ได้ จึงไม่ยอมเขียนทับ" });
      return out([]);
    }
    const kept = [];
    for (const row of list) {
      const name = row?.name;
      const known = stored.get(name);
      // สองช่องนี้มาจากประตู provisioning ที่มีลายเซ็นเท่านั้น — browser sync ห้ามลบหรือปลอม
      const data = { ...(row?.data || {}) };
      for (const field of ["central_user_id", "provisionedBy"]) {
        delete data[field];
        if (known && Object.hasOwn(known, field)) data[field] = known[field];
      }
      const safeRow = { ...row, data };
      if (!known) {
        if (!admin) {
          dropped.push({ key: String(name), why: "สร้างผู้ใช้ใหม่ได้เฉพาะ admin" });
          continue;
        }
        // ฐานถอด role ออกตอน INSERT เสมอ (ดู data-policy.sql ข้อ 5) บทบาทของผู้ใช้ใหม่
        // จึงต้องออกทางประตูเฉพาะเหมือนกับการเปลี่ยนบทบาท ไม่ใช่ติดมากับแถวที่ส่งขึ้นไป
        const fresh = row?.data?.role;
        if (fresh !== undefined) {
          if (KNOWN_ROLES.includes(fresh)) roleChanges.push({ name, from: "(ผู้ใช้ใหม่)", to: fresh });
          else dropped.push({ key: String(name), why: `บทบาท ${fresh} ไม่อยู่ในรายการที่รู้จัก` });
        }
        kept.push(safeRow);
        continue;
      }
      const wanted = row?.data?.role;
      const current = known?.role;
      if (wanted !== undefined && wanted !== current) {
        if (!admin) {
          dropped.push({ key: String(name), why: `เปลี่ยนบทบาทได้เฉพาะ admin (ขอ ${wanted})` });
        } else if (!KNOWN_ROLES.includes(wanted)) {
          dropped.push({ key: String(name), why: `บทบาท ${wanted} ไม่อยู่ในรายการที่รู้จัก` });
        } else {
          roleChanges.push({ name, from: current, to: wanted });
        }
      }
      // ฐานเป็นคนตรึง role/pass กลับให้เอง ไม่ทำซ้ำที่นี่
      // ฟิลด์อื่น (ชื่อที่แสดง อีเมล) แก้ได้ตามปกติ นั่นคือสิ่งที่ผู้ใช้ตั้งใจจะแก้
      kept.push(safeRow);
    }
    return out(kept);
  }

  return out(list);
}

// <<< นโยบายรายฟิลด์ — จบบล็อก

const ALLOWED_TABLES = new Set(Object.keys(TABLE_METHODS));

let deniedCount = 0;
let filteredCount = 0;
let forwardedCount = 0;

async function auditDenied(entry) {
  deniedCount += 1;
  return auditLine(entry);
}

async function auditLine(entry) {
  const day = new Date().toISOString().slice(0, 10);
  const line = `${JSON.stringify({ at: new Date().toISOString(), stack: STACK, color: COLOR, ...entry })}\n`;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(`${LOG_DIR}/gateway-${day}.ndjson`, line);
    return true;
  } catch (error) {
    // บันทึกไม่ได้ ต้องส่งเสียงออก stdout เสมอ ห้ามเงียบ
    console.error("[proxy] เขียนบันทึกการปฏิเสธไม่ได้:", error?.code ?? error, line.trim());
    return false;
  }
}

function sameSecret(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// 5a. เซสชัน — คุกกี้ที่เซ็นด้วย HMAC ไม่เก็บสถานะไว้ในหน่วยความจำ
//
// ไม่เก็บสถานะโดยตั้งใจ: สลับสีน้ำเงิน/เขียวแล้วผู้ใช้ต้องไม่หลุด และคอนเทนเนอร์
// ที่ถูก recreate ตอน deploy ต้องไม่เตะทุกคนออกจากระบบ ทั้งสองสีถือกุญแจเดียวกัน
// จึงอ่านคุกกี้ของกันและกันได้ ด่านเทียบสองสีตรวจว่ากุญแจตรงกันอยู่
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "fs_session";

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  // HMAC จริง ไม่ใช่ sha256(ข้อความ+ความลับ) — แบบหลังต่อท้ายข้อความเพิ่มได้โดยไม่รู้ความลับ
  const mac = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function readSession(request) {
  if (!SESSION_SECRET) return null;
  const raw = String(request.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) return null;
  const value = raw.slice(SESSION_COOKIE.length + 1);
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (!sameSecret(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionCookieHeader(value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// 5b. จำกัดจำนวนครั้งที่กรอกรหัสผิด — ทำที่นี่ก่อนส่งต่อไป OPC
//
// เหตุผลที่ต้องมีของเราเอง ไม่ใช่พึ่งของ OPC อย่างเดียว:
// ตัวนับฝั่ง OPC นับตาม IP ของผู้เรียก ถ้าเราส่งต่อโดยไม่บอกว่าใครเป็นคนกรอกจริง
// คนทั้งบริษัทจะไปกองอยู่ในถังเดียวกัน แล้วคนเดียวพิมพ์ผิด 5 ครั้ง = ล็อกทุกคน
// เราจึงทั้งบอก IP จริงต่อไปให้ OPC และนับของเราเองรายบัญชีไว้อีกชั้น
// ---------------------------------------------------------------------------
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function loginBlocked(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

function clientIp(request) {
  const forwarded = String(request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "unknown";
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error("payload ใหญ่เกิน 12MB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function deny(response, status, why, extra = {}, options = {}) {
  // "ยังไม่ได้ล็อกอิน" เป็นเรื่องปกติที่เกิดทุกไม่กี่วินาทีตราบใดที่มีคนค้างอยู่หน้า Login
  // ถ้าบันทึกทุกครั้ง ไฟล์บันทึกจะเต็มไปด้วยเรื่องที่ไม่ได้แปลว่าอะไร แล้วไม่มีใครอ่านมันอีก
  // สิ่งที่ต้องบันทึกคือของที่ผิดปกติจริง เช่น แตะตารางนอกรายการ หรือกรอกรหัสผิดซ้ำ ๆ
  if (options.quiet) deniedCount += 1;
  else auditDenied({ decision: "denied", status, why, ...extra });
  response.writeHead(status, baseHeaders({ "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify({ message: why, hint: "ถูกปฏิเสธที่ประตูข้อมูลของ runtime" }));
}

function upstreamAuthHeaders() {
  return SB_UPSTREAM_AUTH === "bearer" ? { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } : {};
}

function iamHeaders(path, timestamp, body) {
  const canonical = `POST\n${path}\n${timestamp}\n${body}`;
  const signature = createHmac("sha256", IAM_CONSUMER_SHARED_SECRET).update(canonical).digest("hex");
  return {
    "content-type": "application/json",
    "x-iam-consumer": IAM_CONSUMER_NAME,
    "x-iam-timestamp": timestamp,
    "x-iam-signature": signature,
    ...(IAM_ACCESS_CLIENT_ID && IAM_ACCESS_CLIENT_SECRET
      ? {
          "CF-Access-Client-Id": IAM_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": IAM_ACCESS_CLIENT_SECRET,
        }
      : {}),
  };
}

// จำคำตอบของ IAM ไว้สั้น ๆ เพื่อไม่ให้ IAM สะดุดไม่กี่วินาทีแล้วผู้ใช้ทั้งระบบเห็น "ซิงก์ไม่สำเร็จ"
// เคสจริง 22 ก.ย. 2026: ทุกคำขอ /sb/* ยิงถาม IAM ใหม่ทุกครั้ง ช่วง 20:24-20:26 น. IAM สะดุด
// ประตูข้อมูลจึงตอบ 503 รวม 25 ครั้ง ทั้งที่ปกติ IAM ตอบภายใน ~100 ms
// ถอนสิทธิ์จะมีผลช้าสุดเท่าอายุแคช ซึ่งเป็นการแลกที่ตั้งใจ
const IAM_DECISION_TTL_MS = Number(process.env.FORMULA_IAM_CACHE_MS || 60_000);
const iamDecisionCache = new Map();

async function iamPermissionFetch(centralUserId, requiredPermission) {
  const path = "/consumer/v1/permission-check";
  const body = JSON.stringify({
    central_user_id: centralUserId,
    system_code: "FORMULA",
    required_permission: requiredPermission,
    record_scope: "ALL",
  });
  // ลองใหม่อีกครั้งเมื่อพลาด — IAM สะดุดชั่วครู่ไม่ควรกลายเป็นระบบใช้ไม่ได้
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${IAM_CONSUMER_ORIGIN}${path}`, {
        method: "POST",
        headers: iamHeaders(path, String(Math.floor(Date.now() / 1000)), body),
        body,
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok) return await response.json();
    } catch {
      // ตกไปลองรอบถัดไป
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function iamPermission(centralUserId, requiredPermission) {
  // ปิดการบังคับไว้ = ตอบอนุญาตโดยไม่ยิงไป IAM เลย ทุกปลายทางจึงเห็นภาพเดียวกัน
  if (!IAM_ENFORCE) return { allowed: true, reason_code: "IAM_ENFORCEMENT_DISABLED" };
  if (!IAM_CONSUMER_ORIGIN || IAM_CONSUMER_SHARED_SECRET.length < 32) return null;

  // โหมด IAM: ไม่มีแคชการอนุญาต — ถอนสิทธิ์แล้วต้องมีผลคำขอถัดไป (DEC-06)
  if (FORMULA_IAM_SESSION_MODE) return iamPermissionFetch(centralUserId, requiredPermission);

  const key = `${centralUserId}|${requiredPermission}`;
  const now = Date.now();
  const hit = iamDecisionCache.get(key);
  if (hit && hit.expires > now) return hit.decision;

  const decision = await iamPermissionFetch(centralUserId, requiredPermission);
  // เก็บเฉพาะคำตอบจริงจาก IAM · ถามไม่ได้ (null) ต้องไม่ถูกจำ ไม่งั้นจะพังค้างยาว
  if (decision) {
    iamDecisionCache.set(key, { decision, expires: now + IAM_DECISION_TTL_MS });
    // กันแคชโตไม่จำกัดบนเครื่องที่รันยาว ๆ
    if (iamDecisionCache.size > 500) {
      for (const [k, v] of iamDecisionCache) if (v.expires <= now) iamDecisionCache.delete(k);
    }
    return decision;
  }
  // เรียกไม่ได้จริง ๆ — ยัง fail-closed เหมือนเดิม
  return null;
}

async function formulaEditAllowed(centralUserId) {
  const decision = await iamPermission(centralUserId, "FORMULA_EDIT");
  return decision?.allowed === true;
}

async function iamIdentityByEmail(email) {
  if (!IAM_CONSUMER_ORIGIN || IAM_CONSUMER_SHARED_SECRET.length < 32) return null;
  const path = "/consumer/v1/identity/resolve-email";
  const body = JSON.stringify({
    source_system: "formula",
    email: String(email || "").trim().toLowerCase(),
  });
  try {
    const response = await fetch(`${IAM_CONSUMER_ORIGIN}${path}`, {
      method: "POST",
      headers: iamHeaders(path, String(Math.floor(Date.now() / 1000)), body),
      body,
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const identity = await response.json();
    if (!identity?.central_user_id || identity.status !== "ACTIVE") return null;
    return identity;
  } catch {
    return null;
  }
}

// >>> โหมด session ของ IAM — เริ่มบล็อกที่ tests/iam-session-mode.test.mjs ยกออกไปรันของจริง
//
// คุกกี้ fs_iam_session เป็นแค่ "ที่ถือ" session ของ IAM · เราไม่เซ็น ไม่ต่ออายุ ไม่แคช
// ทุกคำขอถาม IAM ใหม่ (audience FORMULA) — ถอนสิทธิ์ใน IAM มีผลคำขอถัดไปทันที
const IAM_CARRIER_COOKIE = "fs_iam_session";
const IAM_FORMULA_ROLES = { FORMULA_ADMIN: "admin", FORMULA_RD: "rd" };

/** คำตอบ introspect → เซสชันรูปเดิมที่ประตูข้อมูลใช้ · ขาดอะไรไปอย่างเดียว = ไม่มีเซสชัน */
function sessionFromIntrospection(result, profile, now = Date.now()) {
  if (!result || result.active !== true || result.status !== "ACTIVE" || result.audience !== "FORMULA") return null;
  if (typeof result.central_user_id !== "string" || !result.central_user_id) return null;
  if (typeof result.grant_version !== "string" || !/^\d{1,18}$/.test(result.grant_version)) return null;
  const exp = Date.parse(String(result.expires_at || ""));
  if (!Number.isFinite(exp) || exp <= now) return null;
  const role = Object.hasOwn(IAM_FORMULA_ROLES, String(result.app_role || "")) ? IAM_FORMULA_ROLES[result.app_role] : "";
  if (!role) return null;
  if (typeof result.legacy_user_id !== "string" || !result.legacy_user_id) return null;
  // โปรไฟล์ต้องมีอยู่จริงและเป็นคนเดียวกับที่ IAM จับคู่ไว้
  if (!profile || profile.name !== result.legacy_user_id) return null;
  return {
    name: profile.data?.name || profile.name,
    formulaUserId: profile.name,
    role,
    email: String(result.email || profile.data?.email || ""),
    centralUserId: result.central_user_id,
    grantVersion: result.grant_version,
    exp,
    iam: true,
  };
}

/** สิ่งที่โหมด IAM ปิดเพิ่มเหนือนโยบายเดิม (DEC-02: ไม่ลบ ไม่จัดการผู้ใช้ ใน Formula) */
function iamModeDenies(method, table) {
  if (method === "DELETE") return "FORMULA_DELETE_DISABLED";
  if (table === "fs_users" && method !== "GET" && method !== "HEAD") return "FORMULA_USER_MANAGEMENT_DISABLED";
  return "";
}

function iamCarrierHeader(value, maxAgeSeconds) {
  const parts = [`${IAM_CARRIER_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

function cookieValue(request, name) {
  const raw = String(request.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : "";
}

/** ลายเซ็นจาก OPC สำหรับประตูสร้างโปรไฟล์ — แบบเดียวกับผู้เรียก IAM, คลาดเวลาได้ ±60 วินาที */
function provisioningSignatureValid(path, timestamp, body, signature, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || secret.length < 32) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > 60) return false;
  const expected = createHmac("sha256", secret).update(`POST\n${path}\n${timestamp}\n${body}`).digest("hex");
  return sameSecret(String(signature || ""), expected);
}
// <<< โหมด session ของ IAM — จบบล็อก

/** เรียก IAM consumer v2 · `unknown` = อาจเกิดผลแล้ว (หมดเวลา/5xx) ไม่ใช่ "ถูกปฏิเสธ" */
async function iamV2(path, payload) {
  if (!IAM_CONSUMER_ORIGIN || IAM_CONSUMER_SHARED_SECRET.length < 32) return { kind: "unconfigured" };
  const body = JSON.stringify(payload);
  try {
    const response = await fetch(`${IAM_CONSUMER_ORIGIN}${path}`, {
      method: "POST",
      headers: iamHeaders(path, String(Math.floor(Date.now() / 1000)), body),
      body,
      signal: AbortSignal.timeout(4_000),
    });
    if (response.status >= 500) return { kind: "unknown" };
    const parsed = await response.json().catch(() => null);
    if (!parsed || typeof parsed !== "object") return { kind: "unknown" };
    return response.ok ? { kind: "ok", body: parsed } : { kind: "rejected", status: response.status, body: parsed };
  } catch {
    return { kind: "unknown" };
  }
}

async function formulaProfileByName(name) {
  const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_users?select=name,data&name=eq.${encodeURIComponent(name)}`, {
    headers: upstreamAuthHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!upstream.ok) throw new Error(`fs_users HTTP ${upstream.status}`);
  const rows = await upstream.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** IAM หรือฐานตอบไม่ได้ — ต่างจาก "ไม่มีเซสชัน": ตอบ 503 และบันทึก ไม่ใช่ 401 เงียบ ๆ */
const IAM_UNAVAILABLE = Symbol("iam-unavailable");

/** ตัวตนของคำขอนี้จาก IAM — ถามทุกครั้ง · ไม่ผ่าน = null · ถามไม่ได้ = IAM_UNAVAILABLE (ทั้งคู่ไม่ให้เข้า) */
async function iamSessionFromToken(token) {
  if (!token) return null;
  const result = await iamV2("/consumer/v2/auth/session/introspect", { session_token: token, audience: "FORMULA" });
  if (result.kind === "unknown" || result.kind === "unconfigured") return IAM_UNAVAILABLE;
  if (result.kind !== "ok" || result.body.active !== true) return null;
  let profile = null;
  try {
    profile = typeof result.body.legacy_user_id === "string" && result.body.legacy_user_id
      ? await formulaProfileByName(result.body.legacy_user_id)
      : null;
  } catch {
    return IAM_UNAVAILABLE;
  }
  return sessionFromIntrospection(result.body, profile);
}

async function currentSession(request) {
  if (FORMULA_IAM_SESSION_MODE) return iamSessionFromToken(cookieValue(request, IAM_CARRIER_COOKIE));
  return readSession(request);
}

const READ_SCOPE_PAGE_SIZE = 1000;

function validScopedParentRows(rows) {
  if (!Array.isArray(rows)) return false;
  const ids = new Set();
  for (const row of rows) {
    const id = String(row?.id || "");
    if (!/^[A-Z]+[0-9]{5}$/.test(id) || ids.has(id)) return false;
    if (!row?.data || typeof row.data !== "object" || Array.isArray(row.data) || String(row.data.id || "") !== id) return false;
    ids.add(id);
  }
  return true;
}

async function readCompleteScopedTable(table, requestedIds = null) {
  const rows = [];
  let offset = 0;
  let expectedTotal = null;
  const orderKeys = table === "fs_records" ? ["id"] : table === "fs_chats" ? ["job_id"] : ["job_id", "uid"];
  const orderClause = orderKeys.map(key => `${key}.asc`).join(",");
  const identityColumn = table === "fs_records" ? "id" : "job_id";
  const filter = requestedIds ? `&${identityColumn}=${encodeURIComponent(`in.(${[...requestedIds].map(id => JSON.stringify(id)).join(",")})`)}` : "";
  for (let page = 0; page < 1000; page += 1) {
    let upstream;
    try {
      upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/${table}?select=*&order=${orderClause}${filter}`, {
        headers: { ...upstreamAuthHeaders(), Prefer: "count=exact", Range: `${offset}-${offset + READ_SCOPE_PAGE_SIZE - 1}`, "Range-Unit": "items" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch { return null; }
    if (!upstream.ok) return null;
    let batch;
    try { batch = await upstream.json(); } catch { return null; }
    if (!Array.isArray(batch) || batch.length > READ_SCOPE_PAGE_SIZE) return null;
    if (requestedIds && batch.some(row => !requestedIds.has(row?.[identityColumn])
      || !row?.data || typeof row.data !== "object" || Array.isArray(row.data))) return null;
    const contentRange = upstream.headers.get("content-range") || "";
    if (contentRange === "*/0") return offset === 0 && rows.length === 0 && batch.length === 0 ? rows : null;
    const range = /^(?:items )?(\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange);
    if (!range) return null;
    const from = Number(range[1]);
    const to = Number(range[2]);
    const total = range[3] === "*" ? null : Number(range[3]);
    if (from !== offset || (batch.length && to - from + 1 !== batch.length) || (!batch.length && total !== 0)) return null;
    if (expectedTotal !== null && total !== expectedTotal) return null;
    if (total === null) return null;
    expectedTotal = total;
    rows.push(...batch);
    if (rows.length === expectedTotal) {
      const seen = new Set();
      let prior = null;
      for (const row of rows) {
        const values = orderKeys.map(key => String(row?.[key] ?? ""));
        if (values.some(value => !value)) return null;
        const key = values.join("\u0000");
        const comparison = prior === null ? 1 : values.reduce((result, value, index) => {
          if (result !== 0) return result;
          const before = prior[index];
          return value < before ? -1 : value > before ? 1 : 0;
        }, 0);
        if (seen.has(key) || (prior !== null && comparison < 0)) return null;
        seen.add(key);
        prior = values;
      }
      return rows;
    }
    if (rows.length > expectedTotal || batch.length !== READ_SCOPE_PAGE_SIZE) return null;
    offset += batch.length;
  }
  return null;
}

function visibleScopedRows(table, rows, parentRows, session) {
  if (!Array.isArray(rows) || !validScopedParentRows(parentRows)) return null;
  const broadParentVisibility = !["sales", "oversea"].includes(String(session?.role || ""));
  const visibleParentIds = new Set(parentRows.filter(row => broadParentVisibility || storedJobOwner(row.data, session)).map(row => String(row.id)));
  if (table === "fs_records") return rows.filter(row => visibleParentIds.has(String(row?.id || "")));
  const childIds = new Set();
  for (const row of rows) {
    const id = String(row?.job_id || "");
    const childIdentity = table === "fs_chats" ? id : String(row?.uid || "");
    if (!/^[A-Z]+[0-9]{5}$/.test(id) || !childIdentity || childIds.has(`${id}\u0000${childIdentity}`)) return null;
    childIds.add(`${id}\u0000${childIdentity}`);
  }
  return rows.filter(row => visibleParentIds.has(String(row.job_id)));
}

// Retained history can outlive its current parent. It never grants normal
// visibility; report counts only after a stable authorized snapshot. One shared
// cooldown bounds logging even if callers or retained counts keep changing.
let retainedHistoryAuditAt = 0;
let retainedHistoryAuditPending = false;
async function auditRetainedHistory(children, parentRows) {
  const currentIds = new Set(parentRows.map(row => String(row.id)));
  const [retainedChats, retainedMessages] = children.map(rows => rows.reduce((count, row) => count + (currentIds.has(String(row.job_id)) ? 0 : 1), 0));
  if ((!retainedChats && !retainedMessages) || retainedHistoryAuditPending || Date.now() - retainedHistoryAuditAt < 60_000) return;
  retainedHistoryAuditPending = true;
  try {
    if (await auditLine({ decision: "history-retained-out-of-scope", reason: "FORMULA_HISTORY_PARENT_NOT_CURRENT",
      why: "Validated history retained because its parent is absent from current records", retainedChats, retainedMessages })) {
      retainedHistoryAuditAt = Date.now();
    }
  } finally {
    // auditLine reports append failures to stderr; allow retry after failure.
    retainedHistoryAuditPending = false;
  }
}

function sameParentRead(left, right) {
  if (!validScopedParentRows(left) || !validScopedParentRows(right) || left.length !== right.length) return false;
  const project = rows => rows.map(row => ({ id: String(row.id), data: row.data })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return canonical(project(left)) === canonical(project(right));
}

function sameChildRead(table, left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const keys = table === "fs_chats" ? ["job_id"] : ["job_id", "uid"];
  const stableRows = rows => rows.map(row => ({ ...row })).sort((a, b) => {
    for (const key of keys) {
      const av = String(a?.[key] ?? ""), bv = String(b?.[key] ?? "");
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
  });
  return canonical(stableRows(left)) === canonical(stableRows(right));
}

function readRange(url, total, headerRange = "") {
  if (headerRange) {
    const match = /^(?:items=)?(\d+)-(\d+)$/.exec(String(headerRange).trim());
    if (!match) return null;
    const offset = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || end < offset || end - offset > 1_000_000) return null;
    return { offset, limit: end - offset + 1 };
  }
  const header = url.searchParams.get("limit");
  const offsetText = url.searchParams.get("offset");
  const offset = /^\d+$/.test(offsetText || "") ? Number(offsetText) : 0;
  const limit = /^\d+$/.test(header || "") ? Number(header) : total;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset < 0 || limit < 0 || offset + limit > 10_000_000) return null;
  return { offset, limit };
}

async function readScopedChildPage(request, table, url, parentRows, session) {
  const visibleParents = visibleScopedRows("fs_records", parentRows, parentRows, session);
  if (!visibleParents) return null;
  const callerFilter = safeFilterIds(url.searchParams.get("job_id"));
  if (!callerFilter.ok) return null;
  const allowedIds = visibleParents.map(row => String(row.id)).filter(id => !callerFilter.ids || callerFilter.ids.has(id)).sort();
  const query = applySafeReadQuery(table, [], url);
  if (!query) return null;
  const selection = url.searchParams.get("select") || "*";
  const requestedRange = readRange(url, READ_SCOPE_PAGE_SIZE, request.headers.range);
  if (!requestedRange || requestedRange.limit < 1 || requestedRange.limit > READ_SCOPE_PAGE_SIZE) return null;
  if (!allowedIds.length) return { rows: [], total: 0, range: requestedRange, requestedColumns: selection === "*" ? null : selection.split(",") };
  const requestedColumns = selection === "*" ? null : selection.split(",");
  const internalColumns = requestedColumns ? [...new Set([...requestedColumns, "job_id", ...(url.searchParams.has("updated_at") ? ["updated_at"] : [])])] : ["*"];
  const order = url.searchParams.get("order") || (table === "fs_chats" ? "job_id.asc" : "uid.asc");
  const upstreamUrl = new URL(`${SB_ORIGIN}${SB_REST_BASE}/${table}`);
  upstreamUrl.searchParams.set("select", internalColumns.join(","));
  if (allowedIds.length) upstreamUrl.searchParams.set("job_id", `in.(${allowedIds.map(id => `"${id}"`).join(",")})`);
  else return { rows: [], total: 0, range: requestedRange, requestedColumns };
  if (url.searchParams.has("updated_at")) upstreamUrl.searchParams.set("updated_at", url.searchParams.get("updated_at"));
  upstreamUrl.searchParams.set("order", order);
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { ...upstreamAuthHeaders(), Prefer: "count=exact", Range: `${requestedRange.offset}-${requestedRange.offset + requestedRange.limit - 1}`, "Range-Unit": "items" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch { return null; }
  if (!upstream.ok) return null;
  let rows;
  try { rows = await upstream.json(); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const contentRange = upstream.headers.get("content-range") || "";
  if (contentRange === "*/0") {
    if (rows.length) return null;
    return { rows: [], total: 0, range: requestedRange, requestedColumns };
  }
  const match = /^(?:items )?(\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  if (!match) return null;
  const from = Number(match[1]), to = Number(match[2]), total = Number(match[3]);
  if (from !== requestedRange.offset || (rows.length && to - from + 1 !== rows.length) || rows.length > requestedRange.limit) return null;
  const allowed = new Set(allowedIds);
  const unique = new Set();
  const updatedAtFilter = url.searchParams.get("updated_at");
  const updatedAtMatch = updatedAtFilter ? /^gte\.(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))$/.exec(updatedAtFilter) : null;
  for (const row of rows) {
    const jobId = String(row?.job_id || "");
    const rowId = table === "fs_chats" ? jobId : String(row?.uid || "");
    if (!allowed.has(jobId) || (callerFilter.ids && !callerFilter.ids.has(jobId)) || !/^[A-Z]+[0-9]{5}$/.test(jobId)
        || !rowId || unique.has(`${jobId}\u0000${rowId}`)
        || (updatedAtFilter && (!updatedAtMatch || String(row?.updated_at || "") < updatedAtMatch[1]))) return null;
    unique.add(`${jobId}\u0000${rowId}`);
  }
  return { rows, total, range: requestedRange, requestedColumns };
}

function safeFilterIds(value) {
  if (value === null) return { ok: true, ids: null };
  const raw = String(value);
  const eq = /^eq\.([A-Z]+[0-9]{5})$/.exec(raw);
  if (eq) return { ok: true, ids: new Set([eq[1]]) };
  const list = /^in\.\((.+)\)$/.exec(raw);
  if (!list) return { ok: false };
  const ids = list[1].split(",").map(item => {
    const quoted = /^"([A-Z]+[0-9]{5})"$/.exec(item);
    return quoted ? quoted[1] : item;
  });
  if (!ids.length || ids.some(id => !/^[A-Z]+[0-9]{5}$/.test(id)) || new Set(ids).size !== ids.length) return { ok: false };
  return { ok: true, ids: new Set(ids) };
}

function applySafeReadQuery(table, rows, url) {
  const allowed = new Set(["select", "limit", "offset", "order", table === "fs_records" ? "id" : "job_id", "updated_at"]);
  for (const key of new Set(url.searchParams.keys())) if (!allowed.has(key)) return null;
  for (const key of allowed) if (url.searchParams.getAll(key).length > 1) return null;
  const filterKey = table === "fs_records" ? "id" : "job_id";
  const filter = safeFilterIds(url.searchParams.get(filterKey));
  if (!filter.ok) return null;
  let result = filter.ids ? rows.filter(row => filter.ids.has(String(row?.[filterKey] || ""))) : rows.slice();
  if (url.searchParams.has("updated_at")) {
    const raw = String(url.searchParams.get("updated_at") || "");
    const match = /^gte\.(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))$/.exec(raw);
    if (!match || !Number.isFinite(Date.parse(match[1]))) return null;
    result = result.filter(row => String(row?.updated_at || "") >= match[1]);
  }
  const order = url.searchParams.get("order");
  if (order) {
    const sortable = table === "fs_records" ? ["id", "updated_at"] : table === "fs_chats" ? ["job_id", "updated_at"] : ["uid", "job_id", "ts", "updated_at"];
    const terms = order.split(",").map(term => new RegExp(`^(${sortable.join("|")})(?:\\.(asc|desc))?$`).exec(term));
    if (!terms.length || terms.some(term => !term) || new Set(terms.map(term => term[1])).size !== terms.length) return null;
    result.sort((a, b) => {
      for (const term of terms) {
        const direction = term[2] === "desc" ? -1 : 1;
        const left = a?.[term[1]], right = b?.[term[1]];
        const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
        if (comparison) return comparison * direction;
      }
      return 0;
    });
  }
  const selection = url.searchParams.get("select");
  if (url.searchParams.has("select") && !selection) return null;
  if (selection && selection !== "*") {
    const columns = selection.split(",");
    const knownColumns = new Set(table === "fs_records" ? ["id", "data", "updated_at"]
      : table === "fs_chats" ? ["job_id", "data", "updated_at"]
        : ["uid", "job_id", "ts", "data", "updated_at"]);
    if (!columns.length || columns.some(column => !/^[a-z_][a-z0-9_]*$/i.test(column) || !knownColumns.has(column)) || new Set(columns).size !== columns.length) return null;
    result = result.map(row => Object.fromEntries(columns.filter(column => Object.hasOwn(row, column)).map(column => [column, row[column]])));
  }
  return result;
}

async function handleScopedRead(request, response, url, { snapshot = false, idsOnly = false, scopedHistory = false } = {}) {
  if (scopedHistory) snapshot = true;
  if (request.method !== "GET" && request.method !== "HEAD") return deny(response, 405, "อ่านข้อมูลได้ด้วย GET หรือ HEAD เท่านั้น", { path: url.pathname });
  const session = await currentSession(request);
  if (session === IAM_UNAVAILABLE) return deny(response, 503, "ยังตรวจสอบสิทธิ์ไม่ได้", { path: url.pathname, method: request.method });
  if (!session) return deny(response, 401, "กรุณาเข้าระบบก่อนอ่านข้อมูล", { path: url.pathname }, { quiet: true });
  if (!DATA_ENABLED) return deny(response, 503, "ประตูข้อมูลยังไม่พร้อมอ่านข้อมูล", { path: url.pathname });
  if (!session.centralUserId && IAM_ENFORCE) return deny(response, 403, "บัญชีนี้ยังไม่เชื่อมกับผู้ใช้กลางของ IAM", { path: url.pathname });
  const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
  if (view === null) return deny(response, 503, "IAM ไม่พร้อมตรวจสิทธิ์ จึงหยุดคำขอไว้ก่อน", { path: url.pathname });
  if (view.allowed !== true) return deny(response, 403, "บัญชีนี้ไม่มีสิทธิ์ใช้งานรายการนี้ใน Formula", { path: url.pathname, reason: view.reason_code || "DENIED" });
  if (!KNOWN_ROLES.includes(String(session.role || ""))) return deny(response, 403, "บทบาทนี้ยังไม่มีขอบเขตการอ่านที่กำหนดไว้", { path: url.pathname, by: session.name || "", byRole: session.role || "" });

  let requestedIds = null;
  if (scopedHistory) {
    const filter = safeFilterIds(url.searchParams.get("job_id"));
    if ([...url.searchParams.keys()].some(key => key !== "job_id") || url.searchParams.getAll("job_id").length !== 1
        || !filter.ok || !filter.ids || !filter.ids.size || filter.ids.size > 50) {
      return deny(response, 400, "ต้องระบุใบงานที่แน่นอนครั้งละ 1 ถึง 50 รหัส", { path: url.pathname });
    }
    requestedIds = filter.ids;
  }
  const targetTable = idsOnly ? "fs_records" : snapshot ? null : ["fs_records", "fs_chats", "fs_messages"].find(table => url.pathname.endsWith(`/${table}`));
  if (!snapshot && !targetTable) return deny(response, 404, "ปลายทางอ่านข้อมูลนี้ไม่มี", { path: url.pathname });
  if (!snapshot && applySafeReadQuery(targetTable, [], url) === null) return deny(response, 400, "ตัวกรองอ่านข้อมูลนี้ไม่รองรับหรือไม่ถูกต้อง", { path: url.pathname });
  if (!snapshot && targetTable !== "fs_records") {
    const range = readRange(url, READ_SCOPE_PAGE_SIZE, request.headers.range);
    if (!range || range.limit < 1 || range.limit > READ_SCOPE_PAGE_SIZE) return deny(response, 400, "ช่วงอ่านข้อมูลไม่ถูกต้อง", { path: url.pathname });
  }
  const needsChildren = snapshot || targetTable !== "fs_records";
  if (idsOnly && url.search) return deny(response, 400, "ปลายทางนี้ไม่รับตัวกรอง", {path:url.pathname});
  const [records, initialChildren] = await Promise.all([
    readCompleteScopedTable("fs_records", requestedIds),
    snapshot && !scopedHistory ? Promise.all([readCompleteScopedTable("fs_chats"), readCompleteScopedTable("fs_messages")]) : Promise.resolve([]),
  ]);
  if (!records || !validScopedParentRows(records)) return deny(response, 503, "ข้อมูลส่วนกลางไม่ครบพอสำหรับตรวจขอบเขตการอ่าน", { path: url.pathname, reason: "FORMULA_READ_SCOPE_INCOMPLETE" });
  const scopedRecords = visibleScopedRows("fs_records", records, records, session);
  if (requestedIds && (!scopedRecords || scopedRecords.length !== requestedIds.size)) return deny(response, 403, "ใบงานที่ร้องขออยู่นอกขอบเขตการอ่านปัจจุบัน", { path: url.pathname, reason: "FORMULA_READ_SCOPE_DENIED" });
  // Scoped history authorizes every requested parent before touching children.
  // Two complete selected scans catch offset shifts without global history reads.
  const snapshotChildren = scopedHistory
    ? await Promise.all([readCompleteScopedTable("fs_chats", requestedIds), readCompleteScopedTable("fs_messages", requestedIds)])
    : initialChildren;
  if (snapshotChildren.some(rows => !rows)) return deny(response, 503, "ข้อมูลส่วนกลางไม่ครบพอสำหรับตรวจขอบเขตการอ่าน", { path: url.pathname, reason: "FORMULA_READ_SCOPE_INCOMPLETE" });
  const scopedChats = snapshot ? visibleScopedRows("fs_chats", snapshotChildren[0], records, session) : [];
  const scopedMessages = snapshot ? visibleScopedRows("fs_messages", snapshotChildren[1], records, session) : [];
  if (!scopedRecords || !scopedChats || !scopedMessages) return deny(response, 503, "ข้อมูลใบงานหรือห้องสนทนาคลุมเครือ จึงงดส่งข้อมูล", { path: url.pathname, reason: "FORMULA_READ_SCOPE_AMBIGUOUS" });
  let childPage = null;
  if (!snapshot && (targetTable === "fs_chats" || targetTable === "fs_messages")) {
    childPage = await readScopedChildPage(request, targetTable, url, records, session);
    if (!childPage) return deny(response, 503, "ข้อมูลห้องสนทนาอ่านได้ไม่ครบหรือมีแถวที่อยู่นอกขอบเขต", { path: url.pathname, reason: "FORMULA_READ_CHILD_PAGE_INVALID" });
  }
  if (needsChildren || idsOnly) {
    if (snapshot) {
      const recheckedChildren = await Promise.all([readCompleteScopedTable("fs_chats", requestedIds), readCompleteScopedTable("fs_messages", requestedIds)]);
      if (recheckedChildren.some(rows => !rows)
          || !sameChildRead("fs_chats", snapshotChildren[0], recheckedChildren[0])
          || !sameChildRead("fs_messages", snapshotChildren[1], recheckedChildren[1])) {
        return deny(response, 503, "ข้อมูลห้องสนทนาเปลี่ยนระหว่างอ่าน จึงงดส่งผลลัพธ์ที่ไม่ครบ", { path: url.pathname, reason: "FORMULA_READ_CHILDREN_CHANGED" });
      }
    }
    // Parent ownership is checked after the child response (and, for snapshots,
    // after the complete child re-scan) so a transfer during the read cannot
    // authorize one last result.
    const recheckedParents = await readCompleteScopedTable("fs_records", requestedIds);
    if (!sameParentRead(records, recheckedParents)) return deny(response, 503, "ข้อมูลเจ้าของใบงานเปลี่ยนระหว่างอ่านห้องสนทนา จึงงดส่งข้อมูล", { path: url.pathname, reason: "FORMULA_READ_SCOPE_CHANGED" });
  }
  // Revalidate identity after the upstream reads so a mid-flight session change
  // cannot receive a response authorized under the prior actor.
  const fresh = await currentSession(request);
  if (!fresh || fresh === IAM_UNAVAILABLE || fresh.centralUserId !== session.centralUserId || fresh.role !== session.role || fresh.email !== session.email || fresh.name !== session.name) {
    return deny(response, 401, "เซสชันเปลี่ยนระหว่างอ่านข้อมูล จึงยกเลิกผลลัพธ์", { path: url.pathname }, { quiet: true });
  }
  if ((needsChildren || idsOnly) && IAM_ENFORCE) {
    // A cached allow predating the data read cannot authorize its response.
    const freshView = await iamPermissionFetch(fresh.centralUserId, "FORMULA_VIEW");
    if (freshView === null) return deny(response, 503, "IAM ไม่พร้อมตรวจสิทธิ์ จึงหยุดคำขอไว้ก่อน", { path: url.pathname });
    if (freshView.allowed !== true) return deny(response, 403, "บัญชีนี้ไม่มีสิทธิ์ใช้งานรายการนี้ใน Formula", { path: url.pathname, reason: freshView.reason_code || "DENIED" });
  }
  if (snapshot && !scopedHistory) await auditRetainedHistory(snapshotChildren, records);
  const result = snapshot ? { chats: scopedChats, messages: scopedMessages }
    : targetTable === "fs_records" ? applySafeReadQuery("fs_records", scopedRecords, url) : childPage?.rows;
  if (result === null) return deny(response, 400, "ตัวกรองอ่านข้อมูลนี้ไม่รองรับหรือไม่ถูกต้อง", { path: url.pathname });
  if (snapshot || idsOnly) {
    response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
    return response.end(request.method === "HEAD" ? undefined : JSON.stringify(idsOnly ? {ids:scopedRecords.map(row => row.id)} : result));
  }
  if (childPage) {
    const selected = childPage.requestedColumns ? childPage.rows.map(row => Object.fromEntries(childPage.requestedColumns.filter(column => Object.hasOwn(row, column)).map(column => [column, row[column]]))) : childPage.rows;
    const end = selected.length ? childPage.range.offset + selected.length - 1 : childPage.range.offset;
    response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-range": `items ${childPage.range.offset}-${end}/${childPage.total}` }));
    return response.end(request.method === "HEAD" ? undefined : JSON.stringify(selected));
  }
  const range = readRange(url, result.length, request.headers.range);
  if (!range) return deny(response, 400, "ช่วงอ่านข้อมูลไม่ถูกต้อง", { path: url.pathname });
  const sliced = result.slice(range.offset, range.offset + range.limit);
  const end = sliced.length ? range.offset + sliced.length - 1 : range.offset;
  response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-range": `items ${range.offset}-${end}/${result.length}` }));
  return response.end(request.method === "HEAD" ? undefined : JSON.stringify(sliced));
}

/* อ่านแถวผู้ใช้ที่เก็บอยู่จริง เพื่อเทียบกับสิ่งที่เบราว์เซอร์ส่งขึ้นมา
 *
 * ตารางนี้เล็ก (หลักสิบแถว) และรอบซิงก์ส่ง fs_users ก็ต่อเมื่อมีอะไรเปลี่ยนจริง
 * จึงอ่านสดทุกครั้งได้ ไม่ต้องแคช — แคชที่เก่าไปหนึ่งรอบ แปลว่าตัดสินสิทธิ์ด้วยของเก่า
 *
 * คืน null เมื่ออ่านไม่ได้ ซึ่ง applyWritePolicy แปลว่า "ไม่ยอมเขียนอะไรเลย"
 */
async function storedUsers() {
  try {
    const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_users?select=name,data`, {
      headers: upstreamAuthHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return null;
    const rows = await upstream.json();
    if (!Array.isArray(rows)) return null;
    return new Map(rows.map(row => [row?.name, row?.data ?? {}]));
  } catch {
    return null;
  }
}

async function storedRecords(ids) {
  try {
    const query = new URLSearchParams({ select: "id,data" });
    if (ids) {
      if (!ids.length) return new Map();
      // IDs are data, never SQL or PostgREST filter syntax supplied by a caller.
      if (ids.some(id => !/^[A-Z]+[0-9]{5}$/.test(String(id)))) return null;
      query.set("id", `in.(${[...new Set(ids)].join(",")})`);
    }
    const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_records?${query}`, {
      headers: upstreamAuthHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return null;
    const rows = await upstream.json();
    if (!Array.isArray(rows)) return null;
    return new Map(rows.map(row => [String(row?.id || ""), row?.data ?? {}]));
  } catch {
    return null;
  }
}

async function storedArchivedRecords(ids, session) {
  try {
    if (!ids?.length || ids.some(id => !/^[A-Z]+[0-9]{5}$/.test(String(id)))) return null;
    const ownerName = String(session?.name || "");
    const owned = await privateRpc("fs_owner_deleted_jobs", {
      p_ids: ids,
      p_owner_email: normalizedOwnerEmail(session?.email),
      p_owner_name: ownerName,
    });
    if (Array.isArray(owned)) {
      return new Map(owned.map(id => [String(id), { ownerEmail: normalizedOwnerEmail(session?.email), createdBy: ownerName }]));
    }
    // The production path must use the narrow SECURITY DEFINER RPC above. A
    // direct archive read is retained only for isolated synthetic gateways
    // that have no RPC fixture and never use SB_UPSTREAM_AUTH=none in a live
    // deployment; archive remains ungranted to browser roles.
    if (SB_UPSTREAM_AUTH === "none" && STACK === "formula") return null;
    const query = new URLSearchParams({
      select: "row_key,data",
      source: "eq.fs_records",
      row_key: `in.(${[...new Set(ids)].join(",")})`,
    });
    const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_archive?${query}`, {
      headers: upstreamAuthHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return null;
    const rows = await upstream.json();
    if (!Array.isArray(rows)) return null;
    return new Map(rows.map(row => [String(row?.row_key || ""), row?.data?.data ?? null]));
  } catch {
    return null;
  }
}

// JSONB object equality does not depend on object-key insertion order, while
// JSON.stringify does.  Normalize nested objects before comparing rows so a
// normal Sales save cannot be mistaken for a protected ingredient edit merely
// because the browser serialized equivalent fields in a different order.
function canonical(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

function rowsChanged(before, after) {
  return canonical(before ?? null) !== canonical(after ?? null);
}

function formulaRowsWriteNeedsEdit(rows, stored) {
  if (!Array.isArray(rows)) return { blocked: true, needsEdit: false };
  for (const row of rows) {
    const id = String(row?.id || "");
    const current = stored?.get(id);
    if (!current) {
      if (!FORMULA_DATA_ROLES.has(String(row?.sessionRole || ""))) return { blocked: true, needsEdit: false };
      continue;
    }
    if (rowsChanged(current?.rows, row?.data?.rows)) return { blocked: false, needsEdit: true };
  }
  return { blocked: false, needsEdit: false };
}

async function authorizeFormulaWrite({ resource, method, rows, session, url }) {
  const role = String(session?.role || "");
  const table = resource;
  const isSequenceRpc = resource === "rpc/fs_next_rec_seq";

  if (isSequenceRpc) {
    return FORMULA_DATA_ROLES.has(role)
      ? { allowed: true, reason_code: "ROLE_CAPABILITY" }
      : { allowed: false, reason_code: "FORMULA_ROLE_WRITE_DENIED" };
  }
  const ownerDeleteCandidate = method === "DELETE" && table === "fs_records" && KNOWN_ROLES.includes(role);
  const ownerApprovalCleanupCandidate = method === "DELETE" && table === "fs_approvals"
    && !url.searchParams.get("part") && KNOWN_ROLES.includes(role);
  const ownerChildDeleteCandidate = method === "DELETE"
    && ["fs_chats", "fs_messages"].includes(table)
    && KNOWN_ROLES.includes(role);
  if (!formulaRoleCanWrite(role, table, method)
      && !ownerDeleteCandidate && !ownerApprovalCleanupCandidate && !ownerChildDeleteCandidate) {
    return { allowed: false, reason_code: "FORMULA_ROLE_WRITE_DENIED" };
  }

  if (method === "DELETE") {
    if (table === "fs_records") {
      const ids = parseJobIdsFilter(url.searchParams.get("id"));
      if (!ids) return { allowed: false, reason_code: "FORMULA_DELETE_SCOPE_DENIED" };
      if (role === "admin") return iamPermission(session.centralUserId, "FORMULA_EDIT");
      const stored = await storedRecords(ids);
      if (!stored) return null;
      if (ids.some(id => !stored.has(id) || !storedJobOwner(stored.get(id), session))) {
        return { allowed: false, reason_code: "FORMULA_DELETE_OWNER_DENIED" };
      }
      const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
      if (view === null || view.allowed !== true) return view;
      rememberOwnerDelete(session, ids);
      return { allowed: true, reason_code: "FORMULA_OWNER_CAPABILITY" };
    }
    if (["fs_chats", "fs_messages"].includes(table)) {
      const ids = parseJobIdsFilter(url.searchParams.get("job_id"));
      if (!ids) return role === "admin"
        ? iamPermission(session.centralUserId, "FORMULA_EDIT")
        : { allowed: false, reason_code: "FORMULA_DELETE_OWNER_DENIED" };
      if (ownerDeleteReserved(session, ids)) {
        const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
        if (view === null || view.allowed !== true) return view;
        return { allowed: true, reason_code: "FORMULA_OWNER_CAPABILITY" };
      }
      if (role !== "admin") {
        const archived = await storedArchivedRecords(ids, session);
        if (!archived || ids.some(id => !archived.has(id) || !storedJobOwner(archived.get(id), session))) {
          return { allowed: false, reason_code: "FORMULA_DELETE_OWNER_DENIED" };
        }
        const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
        if (view === null || view.allowed !== true) return view;
        return { allowed: true, reason_code: "FORMULA_OWNER_CAPABILITY" };
      }
      return iamPermission(session.centralUserId, "FORMULA_EDIT");
    }
    if (table !== "fs_approvals") return iamPermission(session.centralUserId, "FORMULA_EDIT");
    const scope = approvalDeleteScope(role, url.searchParams.get("part"), url.searchParams.get("job_id"));
    if (!scope) return { allowed: false, reason_code: "FORMULA_APPROVAL_SCOPE_DENIED" };
    if (scope.permission === null) {
      const ids = parseJobIdsFilter(url.searchParams.get("job_id"));
      if (ownerDeleteReserved(session, ids)) {
        const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
        if (view === null || view.allowed !== true) return view;
        return { allowed: true, reason_code: "FORMULA_OWNER_CAPABILITY" };
      }
      const stored = await storedRecords(ids);
      if (!stored) return null;
      if (ids.some(id => stored.has(id))) {
        if (ids.some(id => !stored.has(id) || !storedJobOwner(stored.get(id), session))) {
          return { allowed: false, reason_code: "FORMULA_DELETE_OWNER_DENIED" };
        }
        const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
        if (view === null || view.allowed !== true) return view;
        return { allowed: true, reason_code: "FORMULA_OWNER_CAPABILITY" };
      }
      const archived = await storedArchivedRecords(ids, session);
      if (!archived) return { allowed: false, reason_code: "FORMULA_DELETE_OWNER_DENIED" };
      if (ids.some(id => !archived.has(id) || !storedJobOwner(archived.get(id), session))) {
        return { allowed: false, reason_code: "FORMULA_DELETE_OWNER_DENIED" };
      }
      const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
      if (view === null || view.allowed !== true) return view;
      return { allowed: true, reason_code: "FORMULA_OWNER_CAPABILITY" };
    }
    return iamPermission(session.centralUserId, scope.permission);
  }

  if (table === "fs_users") return iamPermission(session.centralUserId, "FORMULA_EDIT");

  if (table === "fs_records") {
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const stored = await storedRecords(list.map(row => String(row?.id || "")));
    if (!stored) return null;
    const withRole = Array.isArray(rows) ? rows.map(row => ({ ...row, sessionRole: role })) : rows;
    for (const row of list) {
      const id = String(row?.id || "");
      const current = stored.get(id);
      const next = row?.data;
      if (!current) {
        if (role !== "admin" && !newJobOwnershipIsAcceptable(next, session)) {
          return { allowed: false, reason_code: "FORMULA_OWNER_IMMUTABLE" };
        }
        continue;
      }
      if (ownershipChangedBy(current, next, session)) {
        if (role !== "admin") return { allowed: false, reason_code: "FORMULA_OWNER_IMMUTABLE" };
        const permission = await iamPermission(session.centralUserId, "FORMULA_EDIT");
        if (permission === null || permission.allowed !== true) return permission;
      }
    }
    const change = formulaRowsWriteNeedsEdit(withRole, stored);
    if (change.blocked) return { allowed: false, reason_code: "FORMULA_DATA_SCOPE_DENIED" };
    if (change.needsEdit) return iamPermission(session.centralUserId, "FORMULA_EDIT");
    return { allowed: true, reason_code: "ROLE_CAPABILITY" };
  }

  if (table === "fs_approvals") {
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (!list.length) return { allowed: false, reason_code: "FORMULA_APPROVAL_SCOPE_DENIED" };
    const requested = [...new Set(list.map(row => String(row?.part || "").toLowerCase()).filter(Boolean))];
    if (!requested.length) return { allowed: false, reason_code: "FORMULA_APPROVAL_SCOPE_DENIED" };
    for (const part of requested) {
      if (!rolePartAllowed(role, part)) return { allowed: false, reason_code: "FORMULA_APPROVAL_SCOPE_DENIED" };
      const decision = await iamPermission(session.centralUserId, `FORMULA_APPROVE_${part.toUpperCase()}`);
      if (decision === null || decision.allowed !== true) return decision;
    }
  }

  return { allowed: true, reason_code: "ROLE_CAPABILITY" };
}

// >>> durable job acknowledgement — isolated, deterministic validation
function validSavedJob(id, data) {
  return /^[A-Z]+[0-9]{5}$/.test(String(id)) && data && typeof data === "object"
    && !Array.isArray(data) && data.id === id && Array.isArray(data.rows)
    && [data.brand, data.customer].some(value => typeof value === "string" && value.trim());
}

function validJobSaveRequest(args) {
  return args && typeof args === "object" && !Array.isArray(args)
    && Object.keys(args).every(key => ["p_id", "p_data", "p_expected"].includes(key))
    && Object.hasOwn(args, "p_expected") && validSavedJob(args.p_id, args.p_data)
    && (args.p_expected === null || (typeof args.p_expected === "object" && !Array.isArray(args.p_expected)));
}

function filterJobChildren(rows, stored) {
  const kept = [], dropped = [];
  for (const row of rows) {
    const id = String(row?.job_id || "");
    if (!validSavedJob(id, stored.get(id))) dropped.push({ key: id, why: "JOB_NOT_COMMITTED" });
    else kept.push(row);
  }
  return { kept, dropped };
}

let integrityRunning = null;
let integrityTimer;
let integrityReport = { version: 1, complete: false, status: "unknown", checkedAt: null, items: [], counts: {} };
const pendingStates = new Set(["pending", "retry", "unknown"]);
let intakeActive = 0;
async function privateRpc(fn, args) {
  try {
    const r = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/rpc/${fn}`, {
      method: "POST", headers: { ...upstreamAuthHeaders(), "content-type": "application/json" },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function jobSaveDecision(args, session, fresh = false) {
  if (fresh) {
    if (!formulaRoleCanWrite(session.role, "fs_records", "POST")) return { allowed: false, reason_code: "FORMULA_ROLE_WRITE_DENIED" };
    const stored = await storedRecords([args.p_id]);
    if (!stored) return null;
    const current = stored.get(args.p_id);
    if (!current && !FORMULA_DATA_ROLES.has(String(session.role))) return { allowed: false, reason_code: "FORMULA_DATA_SCOPE_DENIED" };
    if ((current?.closed || current?.rejected) && canonical(current) !== canonical(args.p_data)) return { allowed: false, reason_code: "FORMULA_JOB_CLOSED" };
    const ownerMutation = current
      ? ownershipChangedBy(current, args.p_data, session)
      : !newJobOwnershipIsAcceptable(args.p_data, session);
    const expectedOwnerMutation = args.p_expected !== null && ownershipChangedBy(args.p_expected, args.p_data, session);
    if (ownerMutation || expectedOwnerMutation) {
      if (String(session.role) !== "admin") return { allowed: false, reason_code: "FORMULA_OWNER_IMMUTABLE" };
      const ownerGrant = await iamPermissionFetch(session.centralUserId, "FORMULA_EDIT");
      if (ownerGrant === null || ownerGrant.allowed !== true) return ownerGrant;
    }
    const edit = Boolean(session.iam) || (current && rowsChanged(current.rows, args.p_data.rows))
      || (args.p_expected !== null && rowsChanged(args.p_expected.rows, args.p_data.rows));
    return edit ? iamPermissionFetch(session.centralUserId, "FORMULA_EDIT") : { allowed: true };
  }
  let decision = await authorizeFormulaWrite({ resource: "fs_records", method: "POST",
    rows: [{ id: args.p_id, data: args.p_data }], session });
  decision = await enforceOwnershipBaseline(args, session, decision);
  if (decision?.allowed === true && args.p_expected !== null && rowsChanged(args.p_expected.rows, args.p_data.rows)) {
    decision = await iamPermission(session.centralUserId, "FORMULA_EDIT");
  }
  return decision;
}
async function commitReceivedJob(entry, background = false) {
  const decision = await jobSaveDecision(entry.args, entry.actor, background);
  if (!decision) return { status: "pending", reason: "ยังติดต่อฐานข้อมูลหรือระบบตรวจสิทธิ์ไม่ได้", reason_code: "IAM_UNAVAILABLE" };
  // The reason code travels with the receipt and the audit line. Without it a
  // forbidden save is indistinguishable from every other forbidden save.
  if (decision.allowed !== true) return { status: "forbidden", reason: "สิทธิ์ปัจจุบันไม่อนุญาตให้บันทึกใบงานนี้", reason_code: decision.reason_code || "DENIED" };
  const result = await privateRpc("fs_save_record", entry.args);
  if (result?.status === "saved" && result.id === entry.args.p_id && canonical(result.data) === canonical(entry.args.p_data)) {
    // Read the authoritative row back; HTTP 200 by itself is not confirmation.
    const rows = await storedRecords([entry.args.p_id]);
    if (rows && canonical(rows.get(entry.args.p_id)) === canonical(entry.args.p_data)) {
      // Which grant let this save through stays with the receipt and the audit
      // line (owner, 14 ต.ค. 2569: every ingredient edit must leave evidence).
      return { ...result, permission: decision.grant_source || decision.reason_code || "GRANTED" };
    }
    return { status: "pending", reason: "รอตรวจยืนยันข้อมูลที่บันทึกในระบบกลาง" };
  }
  if (["conflict", "invalid"].includes(result?.status)) return { status: result.status, reason: result.status === "conflict"
    ? "ข้อมูลกลางเปลี่ยนไปหรือใบงานถูกลบ จึงหยุดการเขียนทับ" : "ข้อมูลใบงานไม่ครบตามเงื่อนไข" };
  return { status: "pending", reason: "รับข้อมูลไว้แล้ว รอฐานข้อมูลพร้อมเพื่อส่งซ้ำ" };
}
async function replayActor(actor) {
  if (!Number.isFinite(actor.exp) || actor.exp <= Date.now()) return { allowed: false, reason: "ต้องให้เจ้าของเข้าระบบใหม่เพื่อยืนยันสิทธิ์ก่อนส่งต่อ" };
  // Revalidate profile/role and IAM independently of the original signed request.
  try {
    const query = new URLSearchParams({ select: "name,data", name: `eq.${actor.formulaUserId || actor.name}` });
    const r = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_users?${query}`, { headers: upstreamAuthHeaders(), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const users = await r.json();
    if (!Array.isArray(users) || users.length !== 1) return { allowed: false, reason: "ไม่พบผู้รับผิดชอบที่ตรงกับข้อมูลรับเข้า" };
    const profile = users[0];
    if ((profile.data?.name || profile.name) !== actor.name || (!actor.iam && String(profile.data?.role || "").toLowerCase() !== actor.role.toLowerCase())) {
      return { allowed: false, reason: "บัญชีหรือบทบาทเปลี่ยนไป จึงหยุดส่งอัตโนมัติ" };
    }
    if (actor.email && String(profile.data?.email || "").toLowerCase() !== actor.email.toLowerCase()) {
      return { allowed: false, reason: "บัญชีผู้รับผิดชอบไม่ตรงกับข้อมูลรับเข้า" };
    }
    if (actor.email) {
      const identity = await iamIdentityByEmail(actor.email);
      if (!identity) return null;
      if (String(identity.central_user_id) !== String(actor.centralUserId)) return { allowed: false, reason: "ตัวตนในระบบสิทธิ์เปลี่ยนไป จึงหยุดส่งอัตโนมัติ" };
    } else if (actor.iam) return { allowed: false, reason: "ข้อมูลยืนยันตัวตนของผู้รับผิดชอบไม่ครบ" };
    const view = await iamPermissionFetch(actor.centralUserId, "FORMULA_VIEW");
    return view === null ? null : view.allowed === true ? { allowed: true } : { allowed: false, reason: "บัญชีนี้ถูกถอนสิทธิ์ใช้งานระบบ" };
  } catch { return null; }
}
let repairRunning = null;
let repairCursor = 0;
async function runJobRepair() {
  if (!jobIntake || repairRunning) return;
  repairRunning = (async () => {
    try {
      const active = (await jobIntake.list()).filter(entry => pendingStates.has(entry.state));
      const byId = new Map();
      for (const entry of active) byId.set(entry.args.p_id, [...(byId.get(entry.args.p_id) || []), entry]);
      // A slow retry must not delay the independent once-per-minute checker.
      const groups = [...byId.values()].filter(group => group.some(entry => !entry.nextAttemptAt || entry.nextAttemptAt <= Date.now()));
      const chosen = Array.from({ length: Math.min(4, groups.length) }, (_, index) => groups[(repairCursor + index) % groups.length]);
      repairCursor = groups.length ? (repairCursor + chosen.length) % groups.length : 0;
      await Promise.all(chosen.map(async group => {
        if (new Set(group.map(entry => canonical(entry.args))).size > 1) {
          for (const entry of group) await jobIntake.mark(entry.key, { state: "conflict", reason: "มีข้อมูลรอส่งหลายฉบับ จึงหยุดเพื่อป้องกันการเขียนทับ", lastAttemptAt: Date.now(), nextAttemptAt: null });
          return;
        }
        for (const entry of group) {
          if (entry.nextAttemptAt && entry.nextAttemptAt > Date.now()) continue;
          const actor = await replayActor(entry.actor);
          const result = actor?.allowed ? await commitReceivedJob(entry, true) : { status: actor === null ? "pending" : "forbidden", reason: actor?.reason || "รอตรวจสิทธิ์ผู้รับผิดชอบจากระบบกลาง" };
          await jobIntake.mark(entry.key, { state: result.status, reason: result.reason || "บันทึกและตรวจยืนยันแล้ว", lastAttemptAt: Date.now(), nextAttemptAt: result.status === "pending" ? Date.now() + JOB_INTEGRITY_INTERVAL_MS : null });
        }
      }));
    } catch (error) {
      if (error?.name === "JobIntakeError" || error?.code) intakeReady = false;
      /* Keep receipts. The independent checker reports unavailable state. */
    }
  })().finally(() => { repairRunning = null; });
  await repairRunning;
}
async function runJobIntegrity() {
  if (!jobIntake) return integrityReport;
  if (integrityRunning) return integrityRunning;
  integrityRunning = (async () => {
    let observingMetadata = false;
    try {
      await jobIntake.list();
      intakeReady = true;
      const snapshot = await privateRpc("fs_job_integrity_snapshot", {});
      if (snapshot?.version !== 1 || snapshot.complete !== true || !Array.isArray(snapshot.items)
        || snapshot.items.some(item => !/^[A-Z]+[0-9]{5}$/.test(String(item.id)) || ["exists", "valid", "closed", "rejected", "deleted", "chatRequired", "chatExists", "chatDeleted"].some(key => typeof item[key] !== "boolean"))) {
        throw new Error("incomplete snapshot");
      }
      const meta = await jobIntake.metadata();
      intakeCapacity = { bytes: meta.bytes, limitBytes: meta.limitBytes, nearFull: meta.bytes >= meta.limitBytes * 0.8 };
      observingMetadata = true;
      const firstSeen = await jobIntake.firstSeenMany(snapshot.items.map(row => row.id));
      observingMetadata = false;
      const latestReceipts = new Map();
      for (const entry of meta.entries) {
        const previous = latestReceipts.get(entry.id);
        if (!previous || entry.firstSeenAt > previous.firstSeenAt
          || (entry.firstSeenAt === previous.firstSeenAt && (entry.lastAttemptAt || 0) > (previous.lastAttemptAt || 0))) latestReceipts.set(entry.id, entry);
      }
      const items = [];
      for (const row of snapshot.items) {
        let state = row.exists ? row.valid ? row.closed ? "closed" : row.rejected ? "rejected" : "saved" : "invalid" : row.deleted ? "deleted" : "missing";
        let reason = { saved: "พบใบงานที่บันทึกครบในระบบกลาง", closed: "ใบงานปิดแล้ว", rejected: "ใบงานถูกปฏิเสธแล้ว", invalid: "ข้อมูลกลางไม่ครบตามเงื่อนไข", deleted: "ใบงานถูกลบแล้ว ระบบจะไม่คืนกลับอัตโนมัติ", missing: "มีประวัติสร้าง แต่ยังไม่มีต้นฉบับใบงานที่ระบบกลาง" }[state];
        if (state === "saved" && row.chatRequired && !row.chatExists) { state = row.chatDeleted ? "deleted" : "missing"; reason = row.chatDeleted ? "ห้องแชตถูกลบแล้ว ระบบจะไม่คืนกลับอัตโนมัติ" : "พบใบงานแล้ว แต่ยังไม่พบห้องแชตที่เคยขอสร้าง"; }
        const receipt = latestReceipts.get(row.id);
        if (receipt && receipt.state !== "saved" && !["deleted", "closed", "rejected"].includes(state)) { state = receipt.state; reason = receipt.reason || "รับต้นฉบับไว้แล้ว กำลังส่งซ้ำ"; }
        items.push({ id: row.id, state, reason, firstSeenAt: firstSeen.get(row.id), lastAttemptAt: receipt?.lastAttemptAt || null, nextAttemptAt: receipt?.nextAttemptAt || null });
      }
      for (const entry of latestReceipts.values()) if (!items.some(item => item.id === entry.id) && entry.state !== "saved") {
        items.push({ id: entry.id, state: entry.state, reason: entry.reason || "รับต้นฉบับไว้แล้ว กำลังส่งซ้ำ", firstSeenAt: entry.firstSeenAt, lastAttemptAt: entry.lastAttemptAt, nextAttemptAt: entry.nextAttemptAt });
      }
      const counts = {};
      for (const item of items) counts[item.state] = (counts[item.state] || 0) + 1;
      items.sort((a, b) => Number(["saved", "deleted", "closed", "rejected"].includes(a.state)) - Number(["saved", "deleted", "closed", "rejected"].includes(b.state)) || b.firstSeenAt - a.firstSeenAt);
      integrityReport = { version: 1, complete: true, status: "ok", checkedAt: Date.now(), items, counts, notice: intakeCapacity.nearFull ? "พื้นที่รับต้นฉบับใบงานใกล้เต็ม กรุณาตรวจสอบพื้นที่เก็บข้อมูล โดยคงต้นฉบับที่รับไว้แล้ว" : null };
      intakeReady = true;
    } catch (error) {
      const invalidMetadata = observingMetadata && error?.name === "JobIntakeError"
        && ["invalid_id", "invalid_batch", "oversized_observation", "oversized_batch"].includes(error.code);
      if (!invalidMetadata && (error?.name === "JobIntakeError" || error?.code)) intakeReady = false;
      integrityReport = { ...integrityReport, complete: false, status: "unknown", checkedAt: Date.now() };
    }
    return integrityReport;
  })().finally(() => { integrityRunning = null; });
  return integrityRunning;
}
function scheduleJobIntegrity() {
  if (!jobIntake || integrityTimer) return;
  integrityTimer = setTimeout(() => { integrityTimer = null; void runJobIntegrity(); void runJobRepair(); }, 500);
  integrityTimer.unref();
}
/* รับ "ด่านแรกที่หยุดผู้ใช้" จากเบราว์เซอร์ลง gateway log
 *
 * การบันทึกใบงานและการเปิดแชตถูกหยุดในเบราว์เซอร์ได้หลายจุด (รอ handshake, สิทธิ์,
 * สำเนาในเครื่องไม่ตรงของกลาง, คิวค้างสถานะ forbidden) โดยไม่มีคำขอใดถึงเซิร์ฟเวอร์
 * 14 ต.ค. 2569 ผู้ใช้แจ้งว่าบันทึกไม่ได้/เปิดแชตไม่ได้ แต่ log ไม่มีอะไรเลย
 * ปลายทางนี้บันทึกอย่างเดียว ไม่แตะข้อมูล ไม่เปลี่ยนสิทธิ์ และรับเฉพาะเซสชันที่ล็อกอินแล้ว
 * เนื้อหาถูกตัดความยาวและจำกัดอัตราต่อผู้ใช้ เพื่อไม่ให้หน้าค้างกลายเป็นเครื่องเขียน log
 */
const CLIENT_DIAGNOSTIC_LIMIT = 40;
const clientDiagnosticWindow = new Map();
function clientDiagnosticAllowed(key) {
  const now = Date.now();
  const hit = clientDiagnosticWindow.get(key);
  if (!hit || hit.until <= now) { clientDiagnosticWindow.set(key, { until: now + 60_000, count: 1 }); return true; }
  hit.count += 1;
  if (clientDiagnosticWindow.size > 500) for (const [k, v] of clientDiagnosticWindow) if (v.until <= now) clientDiagnosticWindow.delete(k);
  return hit.count <= CLIENT_DIAGNOSTIC_LIMIT;
}
function diagnosticText(value, max) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}
async function handleClientDiagnostic(request, response) {
  if (request.method !== "POST") return deny(response, 405, "ปลายทางนี้รับ POST เท่านั้น", { path: "/__formula/client-diagnostic" });
  const session = await currentSession(request);
  if (session === IAM_UNAVAILABLE) return deny(response, 503, "ยังตรวจสอบสิทธิ์ไม่ได้", {});
  if (!session) return deny(response, 401, "กรุณาเข้าระบบก่อน", {}, { quiet: true });
  let body;
  try {
    const raw = await readBody(request);
    if (raw.length > 4096) return deny(response, 413, "รายงานยาวเกินกำหนด", { path: "/__formula/client-diagnostic" });
    body = JSON.parse(raw.toString("utf8") || "null");
  } catch { return deny(response, 400, "รูปแบบรายงานไม่ถูกต้อง", { path: "/__formula/client-diagnostic" }); }
  const key = diagnosticText(body?.job, 12);
  const stage = diagnosticText(body?.stage, 64);
  const reason = diagnosticText(body?.reason, 64);
  if (!body || typeof body !== "object" || Array.isArray(body) || !stage || !reason || (key && !/^[A-Z]+[0-9]{5}$/.test(key))) {
    return deny(response, 400, "รายงานต้องมี stage, reason และรหัสงานที่ถูกต้อง", { path: "/__formula/client-diagnostic" });
  }
  if (clientDiagnosticAllowed(`${session.centralUserId || ""}|${session.name || ""}`)) {
    await auditLine({ decision: "client-blocked", key, stage, reason, detail: diagnosticText(body.detail, 200),
      by: session.name ?? "", byRole: session.role ?? "" });
  }
  response.writeHead(204, baseHeaders({ "cache-control": "no-store" }));
  response.end();
}
// ประวัติเวอร์ชันของใบงานจากระบบกลาง (runtime/record-versions.sql) — อ่านอย่างเดียว
// เห็นได้เท่าที่เห็นใบงานนั้นในแอป: บทบาท own-only (sales/oversea) ต้องเป็นเจ้าของตามสัญญาเดียวกับ
// การเขียน (storedJobOwner) · บทบาทอื่นเห็นทุกใบ · ค่าที่ส่งคือ data เดิมของใบงานทั้งก้อน
// (ผู้แก้ = updatedBy ในก้อนนั้น) · RPC ยังไม่ติดตั้ง/อ่านไม่ได้ = 503 แล้วเบราว์เซอร์แสดงเฉพาะของในเครื่อง
const FORMULA_OWN_ONLY_ROLES = new Set(["sales", "oversea"]);
async function handleJobVersions(request, response, url) {
  if (request.method !== "GET") return deny(response, 405, "อ่านประวัติเวอร์ชันได้ด้วย GET เท่านั้น", { path: "/__formula/job-versions" });
  const session = await currentSession(request);
  if (session === IAM_UNAVAILABLE) return deny(response, 503, "ยังตรวจสอบสิทธิ์ไม่ได้", {});
  if (!session) return deny(response, 401, "กรุณาเข้าระบบก่อน", {}, { quiet: true });
  const id = String(url.searchParams.get("id") || "");
  if (!/^[A-Z]+[0-9]{5}$/.test(id)) return deny(response, 400, "รหัสใบงานไม่ถูกต้อง", { path: "/__formula/job-versions", by: session.name ?? "", byRole: session.role ?? "" });
  const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
  if (!view?.allowed) return deny(response, view === null ? 503 : 403, "ยังไม่ได้รับสิทธิ์อ่านรายการนี้", { path: "/__formula/job-versions", by: session.name ?? "", byRole: session.role ?? "" });
  if (FORMULA_OWN_ONLY_ROLES.has(String(session.role))) {
    const stored = await storedRecords([id]);
    if (!stored) return deny(response, 503, "ตรวจความเป็นเจ้าของใบงานไม่ได้", { path: "/__formula/job-versions", key: id });
    const current = stored.get(id);
    if (!current || !storedJobOwner(current, session)) {
      return deny(response, 403, "ประวัติเวอร์ชันนี้ไม่ใช่ของใบงานที่คุณดูแล", { path: "/__formula/job-versions", key: id, by: session.name ?? "", byRole: session.role ?? "", reason: "FORMULA_DATA_SCOPE_DENIED" });
    }
  }
  const rows = await privateRpc("fs_record_versions", { p_id: id, p_limit: 12 });
  if (!Array.isArray(rows)) return deny(response, 503, "อ่านประวัติเวอร์ชันจากระบบกลางไม่ได้", { path: "/__formula/job-versions", key: id });
  const versions = rows
    .filter(row => row && row.data && typeof row.data === "object" && !Array.isArray(row.data) && String(row.data.id || "") === id)
    .map(row => ({ at: Date.parse(row.archived_at) || 0, by: String(row.data.updatedBy || row.data.createdBy || ""), data: row.data }))
    .slice(0, 12);
  response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
  response.end(JSON.stringify({ id, versions }));
}
async function handleJobIntegrity(request, response) {
  if (request.method !== "GET") return deny(response, 405, "ตรวจสอบใบงานได้ด้วยการอ่านเท่านั้น", { path: "/__formula/job-integrity" });
  const session = await currentSession(request);
  if (session === IAM_UNAVAILABLE) return deny(response, 503, "ยังตรวจสอบสิทธิ์ไม่ได้", {});
  if (!session) return deny(response, 401, "กรุณาเข้าระบบก่อนตรวจสอบใบงาน", {}, { quiet: true });
  if (session.role !== "admin") return deny(response, 403, "รายการนี้สำหรับผู้ดูแลระบบ", {});
  const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
  if (!view?.allowed) return deny(response, view === null ? 503 : 403, "ยังไม่ได้รับสิทธิ์ตรวจสอบรายการนี้", {});
  // Reading the panel does not perform writes. Only the bounded background worker does.
  response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
  response.end(JSON.stringify(integrityReport.checkedAt && Date.now() - integrityReport.checkedAt > 120_000
    ? { ...integrityReport, complete: false, status: "unknown" } : integrityReport));
}
// <<< durable job acknowledgement

/* ประตูเดียวที่เปลี่ยนบทบาทได้ — ดู runtime/data-policy.sql ข้อ 6
 *
 * ฐานตรึง role ไว้ทุกกรณีที่ผู้เรียกเป็น anon ซึ่งรวมถึงตอน admin กดเปลี่ยนบทบาทด้วย
 * เพราะแอปเปลี่ยนบทบาทด้วยคำสั่งเดียวกับการซิงก์ทั่วไป ไม่มีปลายทางแยก
 * ถ้าไม่มีทางนี้ หน้าจัดการผู้ใช้จะขึ้นว่า "บันทึกเรียบร้อย" ทุกครั้งแล้วค่าเด้งกลับเงียบ ๆ
 *
 * ชื่อฟังก์ชันนี้ไม่อยู่ใน ALLOWED_RPC โดยตั้งใจ เบราว์เซอร์จึงเรียกเองไม่ได้
 * (tests/write-policy.test.mjs มีข้อที่ยืนยันเรื่องนี้)
 */
async function setUserRole(name, role) {
  try {
    const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/rpc/fs_set_user_role`, {
      method: "POST",
      headers: { ...upstreamAuthHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ p_name: name, p_role: role }),
      signal: AbortSignal.timeout(20_000),
    });
    if (upstream.ok) return { ok: true };
    return { ok: false, error: `ฐานปฏิเสธ (HTTP ${upstream.status}) ${(await upstream.text()).slice(0, 200)}` };
  } catch (error) {
    return { ok: false, error: `เรียกฐานไม่ได้: ${String(error?.message ?? error)}` };
  }
}

async function handleGateway(request, response, url) {
  if (!DATA_ENABLED) {
    return deny(response, 503, "ปลายทางข้อมูลยังไม่เปิดรับคำขอ", {
      path: url.pathname,
    });
  }
  if (!SB_ORIGIN || !SB_KEY) {
    return deny(response, 503, "ประตูข้อมูลยังไม่ได้ตั้งค่าคีย์ปลายทาง", { path: url.pathname });
  }
  const rest0 = url.pathname.replace(/^\/sb\/rest\/v1\//, "");
  const resource0 = rest0.split("?")[0];
  if (["fs_records", "fs_chats", "fs_messages"].includes(resource0) && (request.method === "GET" || request.method === "HEAD")) {
    return handleScopedRead(request, response, url);
  }
  const apikey =
    request.headers.apikey || (request.headers.authorization || "").replace(/^Bearer /, "");

  // ทางเข้าที่ 1 — ด่านตรวจ: อ่าน fs_meta ได้อย่างเดียว ไม่มีสิทธิ์อื่นเลย
  const isProbe =
    PROBE_TOKEN
    && sameSecret(apikey, PROBE_TOKEN)
    && request.method === "GET"
    && resource0 === "fs_meta";

  // ทางเข้าที่ 2 — ผู้ใช้จริง: ต้องมีคุกกี้เซสชันที่เราเซ็นเอง ซึ่งออกให้หลังจาก
  // OPC Workflow ยืนยันรหัสผ่านแล้วเท่านั้น เบราว์เซอร์แนบคุกกี้มาเองเพราะโดเมนเดียวกัน
  const resolved = isProbe ? null : await currentSession(request);
  if (resolved === IAM_UNAVAILABLE) {
    return deny(response, 503, "IAM หรือฐานข้อมูลไม่พร้อมยืนยันเซสชัน จึงหยุดคำขอไว้ก่อน", { path: url.pathname, method: request.method });
  }
  const session = resolved;

  if (!isProbe && !session) {
    return deny(
      response,
      401,
      "ยังไม่ได้เข้าใช้งาน — กรุณาล็อกอินด้วยบัญชี OPC Workflow",
      { path: url.pathname, method: request.method },
      { quiet: true },
    );
  }
  if (resource0 === "fs_activities" && ["GET", "HEAD"].includes(request.method)
      && !activityLogReadAllowed(session)) {
    // The sealed sbPull awaits activity reads without a catch. Filter with a
    // successful empty result so a non-admin can still finish the sync cycle.
    filteredCount += 1;
    await auditLine({
      decision: "filtered",
      table: resource0,
      method: request.method,
      by: session.name,
      byRole: session.role,
      reason: "FORMULA_ACTIVITY_READ_ADMIN_REQUIRED",
    });
    response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
    return response.end(request.method === "HEAD" ? undefined : "[]");
  }
  // กรองเฉพาะคำขอที่ allow-list เดิมรับอยู่แล้ว — ตารางนอกรายการหรือเมธอดที่ไม่รับ ยังต้องโดน 403/405 ดัง ๆ ข้างล่าง
  const legalRequest = ALLOWED_TABLES.has(resource0) && TABLE_METHODS[resource0].includes(request.method);
  if (!isProbe && FORMULA_IAM_SESSION_MODE && legalRequest) {
    const blocked = iamModeDenies(request.method, resource0);
    if (blocked) {
      // กรองแล้วตอบสำเร็จ ไม่ใช่ตอบปฏิเสธ (กฎ 3.3): รอบซิงก์ของแอปเรียก fs_users และคำสั่งลบ
      // แบบ await เปลือย ๆ ก่อนบันทึก fs_activities · ตอบ 403 ครั้งเดียว = ทั้งรอบที่เหลือไม่ทำงาน
      request.resume();
      filteredCount += 1;
      await auditLine({
        decision: "filtered",
        table: resource0,
        method: request.method,
        by: session.name,
        byRole: session.role,
        reason: blocked,
      });
      response.writeHead(204, baseHeaders({ "cache-control": "no-store" }));
      return response.end();
    }
  }
  if (!isProbe) {
    if (!session.centralUserId && IAM_ENFORCE) {
      return deny(response, 403, "บัญชีนี้ยังไม่เชื่อมกับผู้ใช้กลางของ IAM", { path: url.pathname });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const decision = await iamPermission(session.centralUserId, "FORMULA_VIEW");
      if (decision === null) {
        return deny(response, 503, "IAM ไม่พร้อมตรวจสิทธิ์ จึงหยุดคำขอไว้ก่อน", { path: url.pathname, method: request.method });
      }
      if (decision.allowed !== true) {
        return deny(response, 403, "บัญชีนี้ไม่มีสิทธิ์ใช้งานรายการนี้ใน Formula", {
          path: url.pathname,
          method: request.method,
          reason: decision.reason_code || "DENIED",
        });
      }
    }
  }
  const rest = url.pathname.replace(/^\/sb\/rest\/v1\//, "");
  const resource = rest.split("?")[0];
  const isRpc = resource.startsWith("rpc/");
  if (isRpc) {
    const fn = resource.slice(4);
    if (!ALLOWED_RPC.has(fn)) {
      return deny(response, 403, `ฟังก์ชัน ${fn} ไม่อยู่ในรายการที่อนุญาต`, { path: url.pathname });
    }
    if (request.method !== "POST") {
      return deny(response, 405, `เรียกฟังก์ชันได้ด้วย POST เท่านั้น ไม่ใช่ ${request.method}`, {
        path: url.pathname,
      });
    }
  } else if (!ALLOWED_TABLES.has(resource)) {
    return deny(response, 403, `ตาราง ${resource || "(ว่าง)"} ไม่อยู่ในรายการที่อนุญาต`, {
      path: url.pathname,
    });
  } else if (!TABLE_METHODS[resource].includes(request.method)) {
    if (resource === "fs_records" && request.method === "POST") {
      response.setHeader("x-fs-client-reload-required", "job-sync-v1");
      return deny(response, 405, "ต้องโหลดเว็บรุ่นใหม่ก่อนบันทึกใบงาน ข้อมูลในเครื่องยังไม่ถูกส่งหรือเขียนทับ", {
        path: url.pathname, method: request.method, reason: "JOB_SYNC_PROTOCOL_REQUIRED",
      });
    }
    return deny(response, 405, `ตาราง ${resource} ไม่รับเมธอด ${request.method}`, {
      path: url.pathname,
    });
  }

  // RPCs and DELETE requests have no JSON body to pass through the policy block
  // below, so authorize them here using the route and session role.
  const isJobSave = resource === "rpc/fs_save_record";
  let ownerDeleteIds = null;
  if (!isProbe && request.method !== "GET" && request.method !== "HEAD" && ((isRpc && !isJobSave) || request.method === "DELETE")) {
    const decision = await authorizeFormulaWrite({ resource, method: request.method, rows: null, session, url });
    if (decision === null) {
      return deny(response, 503, "IAM ไม่พร้อมตรวจสิทธิ์ จึงหยุดคำขอไว้ก่อน", { path: url.pathname, method: request.method });
    }
    if (decision.allowed !== true) {
      return deny(response, 403, "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ใน Formula", {
        path: url.pathname,
        method: request.method,
        reason: decision.reason_code || "DENIED",
      });
    }
    if (resource === "fs_records" && request.method === "DELETE"
        && decision.reason_code === "FORMULA_OWNER_CAPABILITY") {
      ownerDeleteIds = parseJobIdsFilter(url.searchParams.get("id"));
    }
  }

  let body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);

  // A save RPC is not an authorization shortcut: inspect its record payload using
  // the same role and sensitive ingredient-edit check as fs_records POST.
  if (isJobSave) {
    const replyJob = result => {
      response.writeHead(200, baseHeaders({ "content-type": "application/json", "cache-control": "no-store" }));
      response.end(JSON.stringify(result));
    };
    // Every path that stops a save must leave an audit line with who, which job,
    // and why. 12–14 ต.ค. 2569: users reported saves that never worked while the
    // gateway log showed nothing, because the early returns below were silent.
    const actor = { by: session?.name ?? "", byRole: session?.role ?? "" };
    const blockJob = async (status, key, reason) => {
      await auditLine({ decision: "job-save-blocked", table: "fs_records", key, status, reason, ...actor });
      return replyJob({ status, ...(key ? { id: key } : {}), reason });
    };
    let args;
    try { args = JSON.parse(body?.toString("utf8") || "null"); }
    catch { return blockJob("invalid", "", "INVALID_JSON"); }
    if (!validJobSaveRequest(args)) return blockJob("invalid", /^[A-Z]+[0-9]{5}$/.test(String(args?.p_id || "")) ? args.p_id : "", "INVALID_JOB");
    if (jobIntake) {
      // Accept only authenticated, current role-capable requests. Acceptance is
      // durable delivery, not permission to bypass CAS or the later IAM check.
      if (!formulaRoleCanWrite(session.role, "fs_records", "POST")) return blockJob("forbidden", args.p_id, "FORMULA_ROLE_WRITE_DENIED");
      const view = await iamPermission(session.centralUserId, "FORMULA_VIEW");
      if (view?.allowed !== true) return blockJob(view === null ? "retry" : "forbidden", args.p_id, view === null ? "IAM_UNAVAILABLE" : view.reason_code || "FORMULA_VIEW_DENIED");
      if (!intakeReady || intakeActive >= 8) return blockJob("retry", args.p_id, intakeReady ? "INTAKE_BUSY" : "INTAKE_UNAVAILABLE");
      intakeActive += 1;
      try {
        const entry = await jobIntake.capture(args, session);
        const result = await commitReceivedJob(entry);
        await jobIntake.mark(entry.key, { state: result.status, reason: result.reason || "บันทึกและตรวจยืนยันแล้ว", lastAttemptAt: Date.now(), nextAttemptAt: result.status === "pending" ? Date.now() + JOB_INTEGRITY_INTERVAL_MS : null });
        scheduleJobIntegrity();
        // An accepted save names whether the ingredient rows changed, against the
        // CAS baseline the database just verified (p_expected is the stored row at
        // commit time; a create counts its initial rows). The row contents stay
        // in fs_records and fs_activities — the log records who, which job, and
        // that the formula changed, never the formula itself.
        const ingredientEdit = result.status === "saved"
          ? (args.p_expected === null ? (Array.isArray(args.p_data.rows) && args.p_data.rows.length > 0) : rowsChanged(args.p_expected.rows, args.p_data.rows))
          : undefined;
        await auditLine({ decision: "job-received", table: "fs_records", key: args.p_id, status: result.status,
          ...(result.status === "saved"
            ? { ingredientEdit, rowsBefore: args.p_expected === null ? 0 : (Array.isArray(args.p_expected.rows) ? args.p_expected.rows.length : 0),
                rowsAfter: Array.isArray(args.p_data.rows) ? args.p_data.rows.length : 0, permission: result.permission || "" }
            : { reason: result.reason_code || result.reason || "" }), ...actor });
        return replyJob(result.status === "pending" ? { status: "queued", id: args.p_id } : result);
      } catch (error) {
        // Never forward a new write when the receipt could not be confirmed.
        return blockJob("retry", args.p_id, "INTAKE_UNAVAILABLE");
      } finally { intakeActive -= 1; }
    }
    let decision = await authorizeFormulaWrite({
      resource: "fs_records", method: "POST", rows: [{ id: args.p_id, data: args.p_data }], session, url,
    });
    // The row may change between the authorization read and the SQL row lock.
    // A caller-supplied baseline must never conceal an ingredient change that
    // the CAS subsequently applies against that newer row.
    decision = await enforceOwnershipBaseline(args, session, decision);
    if (decision?.allowed === true && args.p_expected !== null
        && rowsChanged(args.p_expected.rows, args.p_data.rows)) {
      decision = await iamPermission(session.centralUserId, "FORMULA_EDIT");
    }
    if (decision === null || decision.allowed !== true) {
      return blockJob(decision === null ? "retry" : "forbidden", args.p_id, decision?.reason_code || "IAM_UNAVAILABLE");
    }
  }

  // ---- นโยบายรายฟิลด์ ----------------------------------------------------
  // ด่านตรวจ (isProbe) อ่านอย่างเดียวอยู่แล้ว จึงไม่มีทางมาถึงตรงนี้
  let roleChanges = [];
  let rowCount = 0;   // จำนวนแถวที่ส่งขึ้นไป ใช้ตอนบันทึกฝั่งสำเร็จ
  if (!isRpc && body !== undefined) {
    let rows = null;
    const text = body.toString("utf8");
    if (text) {
      try {
        rows = JSON.parse(text);
      } catch {
        // อ่านเนื้อคำขอไม่ออก = ตรวจนโยบายกับมันไม่ได้ ส่งต่อทั้งที่ไม่รู้ว่าข้างในคืออะไร
        // คือการยกเลิกด่านนี้ทิ้งเงียบ ๆ · แอปส่ง JSON เสมอ มาถึงตรงนี้แปลว่ามีคนอื่นยิง
        return deny(response, 400, "อ่านเนื้อคำขอเป็น JSON ไม่ได้ จึงตรวจนโยบายไม่ได้", {
          path: url.pathname,
          method: request.method,
        });
      }
    }

    rowCount = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
    if (!isProbe && request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE") {
      // รอบซิงก์ของแอป (sealed) ส่ง fs_users ทั้งก้อนทันทีที่สำเนาในเครื่องต่างจากของกลาง แล้ว await
      // เปลือย ๆ ก่อน fs_activities และคำสั่งลบ · ตอบ 403 = ทั้งรอบที่เหลือของแท็บนั้นไม่ทำงาน และแท็บ
      // ส่งซ้ำทุกรอบไปเรื่อย ๆ (16 ต.ค. 2569: 308 ครั้งใน 2 ชม. และบรรทัดปฏิเสธไม่มีชื่อผู้ใช้เลย)
      // ผู้ใช้ที่ไม่ใช่ admin เขียน fs_users ไม่ได้อยู่แล้ว จึง "กรองแล้วตอบสำเร็จ" (กฎ 3.3) แทน
      // พร้อมบันทึกว่าใคร แถวไหน และ "ชื่อฟิลด์" ใดต่างจากของกลาง (ไม่บันทึกค่า) เพื่อหาต้นเหตุฝั่งแอป
      if (resource === "fs_users" && request.method === "POST" && String(session?.role || "") !== "admin") {
        const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
        const stored = await storedUsers();
        const dropped = list.map(row => {
          const name = String(row?.name ?? row?.data?.name ?? "");
          const known = stored ? stored.get(name) : undefined;
          const sent = row?.data && typeof row.data === "object" ? row.data : {};
          const fields = known
            ? [...new Set([...Object.keys(known), ...Object.keys(sent)])].filter(key => JSON.stringify(known[key]) !== JSON.stringify(sent[key]))
            : [];
          return {
            key: name,
            why: !stored ? "อ่าน fs_users เดิมมาเทียบไม่ได้ และบันทึกผู้ใช้ได้เฉพาะ admin"
              : known ? "บันทึกข้อมูลผู้ใช้ได้เฉพาะ admin" : "สร้างผู้ใช้ใหม่ได้เฉพาะ admin",
            fields,
          };
        });
        filteredCount += Math.max(1, dropped.length);
        await auditLine({
          decision: "filtered",
          table: resource,
          method: request.method,
          by: session?.name ?? "",
          byRole: session?.role ?? "",
          reason: "FORMULA_ROLE_WRITE_DENIED",
          dropped,
        });
        response.writeHead(204, baseHeaders({ "cache-control": "no-store" }));
        return response.end();
      }
      const decision = await authorizeFormulaWrite({ resource, method: request.method, rows, session, url });
      if (decision === null) {
        return deny(response, 503, "IAM ไม่พร้อมตรวจสิทธิ์ จึงหยุดคำขอไว้ก่อน", {
          path: url.pathname, method: request.method, by: session?.name ?? "", byRole: session?.role ?? "",
        });
      }
      if (decision.allowed !== true) {
        // บรรทัดปฏิเสธต้องบอกว่าใคร (กฎ 3.6) — เดิมมีแต่ path/method จึงหาแท็บต้นทางไม่ได้
        return deny(response, 403, "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ใน Formula", {
          path: url.pathname,
          method: request.method,
          reason: decision.reason_code || "DENIED",
          by: session?.name ?? "",
          byRole: session?.role ?? "",
        });
      }
    }
    const stored =
      resource === "fs_users" && request.method === "POST" ? await storedUsers() : null;
    const verdict = applyWritePolicy({
      table: resource,
      method: request.method,
      rows,
      session,
      stored,
    });

    if (verdict.reject) {
      return deny(response, 400, verdict.reject, {
        path: url.pathname,
        method: request.method,
        by: session?.name ?? "(ไม่มีเซสชัน)",
      });
    }

    if (verdict.dropped.length) {
      filteredCount += verdict.dropped.length;
      await auditLine({
        decision: "filtered",
        table: resource,
        method: request.method,
        by: session?.name ?? "(ไม่มีเซสชัน)",
        byRole: session?.role ?? "",
        dropped: verdict.dropped,
      });
    }
    roleChanges = verdict.roleChanges;

    if (verdict.skipUpstream) {
      // ตอบเท่าที่ PostgREST ตอบเมื่อคำสั่งลบไม่โดนแถวไหนเลย — ยิงถามของจริงมาแล้ว: 204 ตัวเปล่า
      response.writeHead(204, baseHeaders({ "cache-control": "no-store" }));
      return response.end();
    }
    if (verdict.rows !== null) body = Buffer.from(JSON.stringify(verdict.rows), "utf8");
    if (request.method === "POST" && ["fs_chats", "fs_messages", "fs_approvals"].includes(resource)) {
      const candidates = verdict.rows || [];
      const ids = [...new Set(candidates.map(row => String(row?.job_id || "")))];
      const stored = await storedRecords(ids.filter(id => /^[A-Z]+[0-9]{5}$/.test(id)));
      if (!stored) return deny(response, 503, "ตรวจการบันทึกใบงานไม่ได้ จึงพักข้อมูลแชตไว้ก่อน", { path: url.pathname });
      const checked = filterJobChildren(candidates, stored);
      if (checked.dropped.length) {
        filteredCount += checked.dropped.length;
        response.setHeader("x-fs-job-write-rejected", String(checked.dropped.length));
        await auditLine({ decision: "filtered", table: resource, method: request.method,
          by: session?.name ?? "", byRole: session?.role ?? "", dropped: checked.dropped });
      }
      if (!checked.kept.length) {
        // Preserve legacy 2xx semantics. New clients require returned rows, so an
        // empty representation can never be mistaken for a committed child.
        const representation = String(request.headers.prefer || "").includes("return=representation");
        response.writeHead(representation ? 200 : 204, baseHeaders({ "content-type": "application/json", "cache-control": "no-store" }));
        return response.end(representation ? "[]" : undefined);
      }
      body = Buffer.from(JSON.stringify(checked.kept), "utf8");
    }
  }

  // The sealed client removes the parent first and then sends child DELETEs.
  // Clean those children server-side before the parent request and retain a
  // short reservation so the client's follow-up DELETEs are harmless and
  // cannot be reused as an arbitrary child-delete capability.
  if (ownerDeleteIds) {
    try {
      if (!(await deleteOwnerChildren(ownerDeleteIds))) {
        return deny(response, 503, "ลบข้อมูลประกอบใบงานไม่สำเร็จ จึงยังไม่ลบใบงานหลัก", {
          path: url.pathname, method: request.method, reason: "OWNER_CHILD_DELETE_FAILED",
        });
      }
    } catch {
      return deny(response, 503, "ลบข้อมูลประกอบใบงานไม่ได้ จึงยังไม่ลบใบงานหลัก", {
        path: url.pathname, method: request.method, reason: "OWNER_CHILD_DELETE_UNAVAILABLE",
      });
    }
  }

  const forwardHeaders = { Accept: request.headers.accept || "application/json" };
  if (SB_UPSTREAM_AUTH === "bearer") {
    forwardHeaders.apikey = SB_KEY;
    forwardHeaders.Authorization = `Bearer ${SB_KEY}`;
  }
  for (const name of ["content-type", "prefer", "range", "accept-profile", "content-profile"]) {
    if (request.headers[name]) forwardHeaders[name] = request.headers[name];
  }

  const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/${rest}${url.search}`, {
    method: request.method,
    headers: forwardHeaders,
    body,
    signal: AbortSignal.timeout(60_000),
  });

  forwardedCount += 1;
  if (resource === "fs_activities" && upstream.ok && request.method === "POST") scheduleJobIntegrity();

  /* บันทึกฝั่ง "เขียนสำเร็จ" — เดิมบันทึกเฉพาะที่ถูกปฏิเสธ
   *
   * เหตุผลเดิมที่ไม่บันทึกทุกอย่างยังถูกอยู่: คนที่ค้างหน้า Login ยิงอ่านทุก 3-30 วินาที
   * ถ้าบันทึกหมด ไฟล์จะเต็มไปด้วยเรื่องปกติจนไม่มีใครอ่านมันอีก — จึงบันทึกเฉพาะ "การเขียน"
   * ซึ่งมีน้อยและทุกครั้งแปลว่ามีคนตั้งใจทำอะไรจริง ๆ ส่วน GET/HEAD ยังเงียบเหมือนเดิม
   *
   * ที่ต้องมี: 25 ส.ค. ผู้ใช้สร้างงานจริง 4 ใบแล้วไม่มีบรรทัดประวัติสักบรรทัด
   * ตอนนั้นตอบไม่ได้ด้วยซ้ำว่าแอปส่ง fs_activities ขึ้นมาไหม เพราะฝั่งสำเร็จไม่เคยถูกบันทึก
   * รู้ว่าอะไรถูกปฏิเสธ แต่ไม่รู้ว่าอะไรผ่าน คือการเห็นระบบแค่ครึ่งเดียว
   */
  if (request.method !== "GET" && request.method !== "HEAD") {
    await auditLine({
      decision: upstream.ok ? "write" : "write-failed",
      status: upstream.status,
      table: resource,
      method: request.method,
      rows: rowCount,
      name: session?.name ?? "",
      role: session?.role ?? "",
    });
  }

  // เปลี่ยนบทบาทต้องทำ "หลัง" คำสั่งหลัก เพราะฐานตรึง role กลับให้ทุกครั้งที่แถวถูกแก้
  // ทำก่อนแล้วคำสั่งหลักจะลบผลของมันทิ้งพอดี
  let roleChangeState = "";
  if (roleChanges.length) {
    if (!upstream.ok) {
      // กิ่งนี้เคยเงียบสนิท — admin กดเปลี่ยนบทบาทแล้วไม่มีอะไรเกิดขึ้น และไม่มีบรรทัดบันทึก
      roleChangeState = "skipped";
      await auditLine({
        decision: "role-change-skipped",
        table: "fs_users",
        by: session?.name ?? "",
        changes: roleChanges,
        why: `คำสั่งหลักไม่สำเร็จ (HTTP ${upstream.status}) จึงไม่สั่งเปลี่ยนบทบาทต่อ`,
      });
    } else {
      roleChangeState = "ok";
      for (const change of roleChanges) {
        const applied = await setUserRole(change.name, change.to);
        if (!applied.ok) roleChangeState = "failed";
        await auditLine({
          decision: applied.ok ? "role-changed" : "role-change-failed",
          table: "fs_users",
          by: session?.name ?? "",
          name: change.name,
          from: change.from,
          to: change.to,
          why: applied.ok ? "admin เปลี่ยนบทบาทผ่านประตูเฉพาะ" : applied.error,
        });
      }
    }
  }

  const passThrough = {};
  for (const name of ["content-type", "content-range", "content-location", "prefer-applied"]) {
    const value = upstream.headers.get(name);
    if (value) passThrough[name] = value;
  }
  let payload = Buffer.from(await upstream.arrayBuffer());
  /* ประวัติที่มีอยู่แล้วต้องตอบกลับให้ครบ ไม่ใช่ตอบรายการว่าง
   *
   * fs_activities เป็น append-only: แถว uid ซ้ำกลายเป็น UPDATE ที่ trigger ข้ามเงียบ ๆ
   * PostgREST จึงตอบ 200 แต่ representation ไม่มีแถวนั้น · client รุ่น job-sync ต้องเห็น
   * แถวที่เก็บจริงถึงจะยืนยัน journal ของตัวเองได้ — ไม่เห็นก็ส่งซ้ำทุก 5 วินาทีไม่มีวันจบ
   * และแชตของใบงานนั้นถูกล็อกไว้ด้วย (14 ต.ค. 2569: ผู้ใช้ pd ส่งซ้ำ 165 ครั้งในเช้าเดียว
   * เปิดแชต A03984 ไม่ได้ ทั้งที่ประวัติอยู่ในฐานครบ) · เติมแถวที่เก็บไว้จริงกลับเข้าคำตอบ
   * ไม่แก้แถวใด ไม่เปลี่ยนรหัสสถานะ และบันทึกว่าเกิดขึ้นกับใครกี่แถว
   */
  if (resource === "fs_activities" && request.method === "POST" && upstream.ok
      && String(request.headers.prefer || "").includes("return=representation")) {
    try {
      const sent = JSON.parse(body?.toString("utf8") || "[]");
      const sentUids = (Array.isArray(sent) ? sent : [sent]).map(row => String(row?.uid || "")).filter(Boolean);
      const returned = JSON.parse(payload.toString("utf8") || "[]");
      const returnedUids = new Set((Array.isArray(returned) ? returned : []).map(row => String(row?.uid || "")));
      const missing = [...new Set(sentUids.filter(uid => !returnedUids.has(uid)))];
      if (missing.length && Array.isArray(returned)) {
        const query = new URLSearchParams({ select: "uid,ts,data", uid: `in.(${missing.join(",")})` });
        const lookup = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_activities?${query}`, { headers: { ...upstreamAuthHeaders(), Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        const stored = lookup.ok ? await lookup.json() : null;
        if (Array.isArray(stored) && stored.length) {
          payload = Buffer.from(JSON.stringify([...returned, ...stored]), "utf8");
          delete passThrough["content-range"];
          await auditLine({ decision: "activity-dedup", table: resource, rows: stored.length, by: session?.name ?? "", byRole: session?.role ?? "" });
        }
      }
    } catch { /* คำตอบเดิมของ PostgREST ยังถูกส่งต่อตามปกติ */ }
  }
  // คำสั่งหลักสำเร็จจริง จึงไม่เปลี่ยนรหัสสถานะ (เปลี่ยนแล้วรอบซิงก์พังทั้งรอบ ตามกฎ 3.3)
  // แต่ต้องมีร่องรอยให้เห็นจากฝั่งเบราว์เซอร์ ไม่ใช่ต้องมาเปิดไฟล์บันทึกอ่านเองถึงจะรู้
  if (roleChangeState) passThrough["x-fs-role-change"] = roleChangeState;
  response.writeHead(upstream.status, baseHeaders({ ...passThrough, "cache-control": "no-store" }));
  response.end(payload);
}

// ---------------------------------------------------------------------------
// 5c. ปลายทางเซสชัน /sb/session
//
//   POST   = ล็อกอิน (ส่งรหัสผ่านต่อไปให้ OPC ตัดสิน แล้วจับคู่อีเมลกับ fs_users)
//   GET    = ตอนนี้เป็นใครอยู่ (สคริปต์ฝังใช้ตอนหน้าโหลดใหม่)
//   DELETE = ออกจากระบบ
//
// รหัสผ่านไม่ถูกเก็บ ไม่ถูกบันทึกลงไฟล์ และไม่ถูกส่งกลับไปไหนทั้งสิ้น
// ผ่านที่นี่แล้วจบที่ OPC เท่านั้น
// ---------------------------------------------------------------------------
function opcLogin(login, password, ip) {
  // ใช้ node:http แทน fetch เพราะต้องกำหนดหัวข้อ Host เองให้ตรงกับที่ OPC ใช้แยกโดเมน
  // และต้องส่ง IP จริงของผู้กรอกต่อไป ไม่งั้นตัวนับรหัสผิดของ OPC จะเห็นทุกคนเป็น IP เดียว
  return new Promise(resolve => {
    const target = new URL(OPC_LOGIN_ORIGIN);
    const payload = JSON.stringify({ login, password });
    const request = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: "POST",
        path: "/api/auth/login",
        headers: {
          host: OPC_LOGIN_HOST,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "cf-connecting-ip": ip,
          accept: "application/json",
        },
        timeout: 20_000,
      },
      upstream => {
        const chunks = [];
        upstream.on("data", chunk => chunks.push(chunk));
        upstream.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
          resolve({ status: upstream.statusCode || 502, body });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("OPC ไม่ตอบใน 20 วินาที")));
    request.on("error", error => resolve({ status: 502, body: null, error: String(error?.message ?? error) }));
    request.end(payload);
  });
}

// OPC keeps a legacy login name in `email` and the organization identity in
// `accessEmail`.  Formula must resolve the latter first so IAM and fs_users
// are checked against the same person across both systems.
function canonicalOpcEmail(opcUser, login) {
  return String(opcUser?.accessEmail || opcUser?.email || login).trim();
}

async function formulaUserByEmail(email) {
  const upstream = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_users?select=name,data`, {
    headers:
      SB_UPSTREAM_AUTH === "bearer" ? { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) return { error: `อ่าน fs_users ไม่ได้ (HTTP ${upstream.status})` };
  const rows = await upstream.json();
  const wanted = String(email || "").trim().toLowerCase();
  const match = rows.find(row => String(row?.data?.email || "").trim().toLowerCase() === wanted);
  return { row: match || null, total: rows.length };
}

function accessEmail(request) {
  if (!FORMULA_ACCESS_SSO_ENABLED) return "";
  // ต้องมีทั้งอีเมลที่ Access ส่งให้แอปและ JWT assertion
  // เปิด flag นี้เฉพาะหลังสร้าง Access application แล้วเท่านั้น
  const email = String(request.headers["cf-access-authenticated-user-email"] || "").trim().toLowerCase();
  const assertion = String(request.headers["cf-access-jwt-assertion"] || "").trim();
  if (!email || !assertion || !email.includes("@")) return "";
  return email;
}

async function signInFormulaByAccess(request, reply) {
  const email = accessEmail(request);
  if (!email) return false;

  const identity = await iamIdentityByEmail(email);
  if (!identity) {
    await auditLine({ decision: "denied", status: 403, why: "Cloudflare Access account is not an active IAM user", email });
    reply(403, { message: "บัญชีองค์กรนี้ยังไม่มีผู้ใช้ที่เปิดใช้งานใน IAM" });
    return true;
  }

  const iamDecision = await iamPermission(identity.central_user_id, "FORMULA_VIEW");
  if (iamDecision?.allowed !== true) {
    await auditLine({ decision: "denied", status: 403, why: "IAM denied Formula access for Cloudflare Access account", email, reason: iamDecision?.reason_code || "DENIED" });
    reply(403, { message: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน Formula" });
    return true;
  }

  const lookup = await formulaUserByEmail(email);
  if (lookup.error) {
    reply(502, { message: lookup.error });
    return true;
  }
  if (!lookup.row) {
    await auditLine({ decision: "denied", status: 403, why: "IAM account has no Formula profile", email });
    reply(403, { message: `ยังไม่มีบัญชีอีเมล ${email} ใน Formula Studio` });
    return true;
  }

  const payload = {
    name: lookup.row.data?.name || lookup.row.name,
    role: lookup.row.data?.role || "",
    email,
    centralUserId: identity.central_user_id,
    // The sealed client uses canEdit as its sync-write gate.  Keep the actual
    // sensitive formula-edit decision separate so normal role writes (chat,
    // job creation, close, and approvals) do not become read-only.
    canEdit: formulaSyncCanWrite(lookup.row.data?.role || ""),
    canFormulaEdit: await formulaEditAllowed(identity.central_user_id),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const cookie = sessionCookieHeader(signSession(payload), Math.floor(SESSION_TTL_MS / 1000));
  await auditLine({ decision: "signed-in", authSource: "cloudflare-access", name: payload.name, role: payload.role, email, expiresAt: new Date(payload.exp).toISOString() });
  reply(200, {
    authenticated: true,
    name: payload.name,
    role: payload.role,
    email,
    centralUserId: identity.central_user_id,
    canEdit: payload.canEdit,
    canFormulaEdit: payload.canFormulaEdit,
    authSource: "cloudflare-access",
  }, { "set-cookie": cookie });
  return true;
}

/* /sb/session ในโหมด IAM — รูปคำตอบเหมือนเดิมทุกช่อง สคริปต์เชื่อมล็อกอินจึงไม่ต้องแก้
 *
 * POST : ส่งอีเมล/รหัสผ่านให้ IAM ตรวจ (audience FORMULA) แล้วถือ session ไว้ในคุกกี้
 * GET  : ถาม IAM ใหม่ทุกครั้ง · DELETE : ขอ IAM ยกเลิก session นี้ แล้วล้างคุกกี้
 */
async function handleIamSession(request, response, reply) {
  const signedOut = [iamCarrierHeader("", 0), sessionCookieHeader("", 0)];
  if (request.method === "GET") {
    const session = await iamSessionFromToken(cookieValue(request, IAM_CARRIER_COOKIE));
    if (session === IAM_UNAVAILABLE) {
      auditDenied({ decision: "denied", status: 503, why: "IAM ไม่พร้อมยืนยันเซสชัน", ip: clientIp(request) });
      return reply(503, { authenticated: false, message: "ระบบ IAM ไม่พร้อม ลองใหม่อีกครั้ง" });
    }
    if (!session) return reply(401, { authenticated: false });
    return reply(200, {
      authenticated: true,
      name: session.name,
      role: session.role,
      email: session.email,
      centralUserId: session.centralUserId,
      canEdit: formulaSyncCanWrite(session.role),
      canFormulaEdit: await formulaEditAllowed(session.centralUserId),
      expiresAt: new Date(session.exp).toISOString(),
    });
  }
  if (request.method === "DELETE") {
    const token = cookieValue(request, IAM_CARRIER_COOKIE);
    const leavingResult = await iamSessionFromToken(token);
    const leaving = leavingResult === IAM_UNAVAILABLE ? null : leavingResult;
    const revoked = token ? await iamV2("/consumer/v2/auth/session/revoke", { session_token: token, audience: "FORMULA" }) : { kind: "ok", body: { revoked: true } };
    const confirmed = revoked.kind === "ok" && revoked.body.revoked === true;
    await auditLine({ decision: "signed-out", name: leaving?.name, role: leaving?.role, ip: clientIp(request), iamRevoked: confirmed });
    response.writeHead(200, { ...baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }), "set-cookie": signedOut });
    return response.end(JSON.stringify({ authenticated: false, iamRevoked: confirmed }));
  }
  if (request.method !== "POST") return reply(405, { message: `เมธอด ${request.method} ใช้กับปลายทางนี้ไม่ได้` });

  let body = null;
  try {
    body = JSON.parse((await readBody(request)).toString("utf8"));
  } catch {
    return reply(400, { message: "รูปแบบข้อมูลไม่ถูกต้อง" });
  }
  const login = String(body?.login || "").trim().slice(0, 100);
  const password = String(body?.password || "");
  if (!login || !password) return reply(400, { message: "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ" });
  const ip = clientIp(request);
  const accountKey = `acct:${login.toLowerCase()}`;
  if (loginBlocked(accountKey) || loginBlocked(`ip:${ip}`)) {
    auditDenied({ decision: "denied", status: 429, why: "กรอกรหัสผิดเกินกำหนด", login: login.toLowerCase(), ip });
    return reply(429, { message: "กรอกรหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก 15 นาที" });
  }
  const result = await iamV2("/consumer/v2/auth/session/login", { email: login, password, audience: "FORMULA" });
  if (result.kind === "unknown" || result.kind === "unconfigured") {
    await auditLine({ decision: "denied", status: 503, why: "IAM ไม่พร้อมตรวจรหัสผ่าน", login: login.toLowerCase(), ip });
    return reply(503, { message: "ระบบ IAM ไม่พร้อม ลองใหม่อีกครั้ง" });
  }
  const token = result.kind === "ok" && result.body.audience === "FORMULA" && typeof result.body.access_token === "string" ? result.body.access_token : "";
  if (!token) {
    recordLoginFailure(accountKey);
    recordLoginFailure(`ip:${ip}`);
    auditDenied({ decision: "denied", status: 401, why: "IAM ปฏิเสธชื่อผู้ใช้หรือรหัสผ่าน", login: login.toLowerCase(), ip });
    return reply(401, { message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }
  const session = await iamSessionFromToken(token);
  if (session === IAM_UNAVAILABLE) {
    // รหัสผ่านถูกแต่ยืนยันเซสชันต่อไม่ได้ — ไม่ทิ้ง session ที่ไม่มีใครถือไว้ที่ IAM
    await iamV2("/consumer/v2/auth/session/revoke", { session_token: token, audience: "FORMULA" });
    auditDenied({ decision: "denied", status: 503, why: "IAM ไม่พร้อมยืนยันเซสชันหลังเข้าระบบ", login: login.toLowerCase(), ip });
    return reply(503, { message: "ระบบ IAM ไม่พร้อม ลองใหม่อีกครั้ง" });
  }
  if (!session) {
    // รหัสถูกแต่ยังไม่ได้รับบทบาท/โปรไฟล์ Formula — ไม่ทิ้ง session ที่ใช้ไม่ได้ค้างไว้ที่ IAM
    await iamV2("/consumer/v2/auth/session/revoke", { session_token: token, audience: "FORMULA" });
    auditDenied({ decision: "denied", status: 403, why: "IAM ยืนยันตัวตนแล้ว แต่ไม่มีบทบาทหรือโปรไฟล์ Formula ที่จับคู่ไว้", login: login.toLowerCase(), ip });
    return reply(403, { message: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน Formula" });
  }
  loginFailures.delete(accountKey);
  loginFailures.delete(`ip:${ip}`);
  await auditLine({ decision: "signed-in", name: session.name, role: session.role, email: session.email.toLowerCase(), ip, expiresAt: new Date(session.exp).toISOString(), via: "iam" });
  const cookie = iamCarrierHeader(token, Math.min((session.exp - Date.now()) / 1000, SESSION_TTL_MS / 1000));
  return reply(200, {
    authenticated: true,
    name: session.name,
    role: session.role,
    email: session.email,
    centralUserId: session.centralUserId,
    canEdit: formulaSyncCanWrite(session.role),
    canFormulaEdit: await formulaEditAllowed(session.centralUserId),
  }, { "set-cookie": cookie });
}

/* ประตูสร้าง/อ่านโปรไฟล์ Formula สำหรับ OPC (ขั้น FORMULA_PROFILE ของการเพิ่มผู้ใช้)
 *
 * - ต้องมีลายเซ็นจาก FORMULA_PROVISIONING_SECRET · ไม่ตั้งกุญแจ = ปิด (404)
 * - ไม่เขียนทับแถวเดิมเด็ดขาด: อีเมลหรือชื่อชนกับคนอื่น = 409 profile_conflict
 * - ทำซ้ำได้: แถวที่ OPC สร้างให้คนเดิม (central_user_id ตรง) ตอบ created:false
 * - บทบาทใส่ผ่าน fs_set_user_role ทางเดียว (ฐานถอด role ออกจากแถวใหม่เสมอ)
 */
async function handleProvisioning(request, response, url) {
  const reply = (status, payload) => {
    response.writeHead(status, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
    response.end(JSON.stringify(payload));
  };
  // เจ้าของตัดสิน 1 ต.ค. 2569: หน้าจอเพิ่มผู้ใช้ของ OPC ตั้งบทบาท Formula เดิมได้ทุกบทบาท ในโหมดปัจจุบัน
  // (ที่ fs_users.data.role ยังเป็นสิทธิ์จริง) · กันด้วยลายเซ็นของ OPC และ edge ไม่ปล่อยคำขอจากอินเทอร์เน็ตเข้ามา
  if (!FORMULA_PROVISIONING_SECRET || FORMULA_PROVISIONING_SECRET.length < 32) return reply(404, { error: "not_found" });
  // ป้องกันซ้อนกับ edge: คำขอที่มาทาง Cloudflare ไม่ใช่ OPC ที่เรียกจากภายใน
  if (request.headers["cf-ray"] || request.headers["cf-connecting-ip"] || request.headers["cf-access-jwt-assertion"]) {
    request.resume();
    return reply(404, { error: "not_found" });
  }
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const raw = (await readBody(request)).toString("utf8");
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  // ลายเซ็นครอบไบต์ที่ส่งมาจริง ไม่ใช่ก้อนที่ parse แล้วเขียนกลับ
  if (!provisioningSignatureValid(url.pathname, request.headers["x-fs-provisioning-timestamp"], raw, request.headers["x-fs-provisioning-signature"], FORMULA_PROVISIONING_SECRET)) {
    auditDenied({ decision: "denied", status: 401, why: "ลายเซ็นประตูสร้างโปรไฟล์ไม่ถูกต้อง", path: url.pathname, ip: clientIp(request) });
    return reply(401, { error: "signature_invalid" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "body_invalid" });
  if (!DATA_ENABLED) return reply(503, { error: "data_unavailable" });

  const users = await storedUsers();
  if (!users) return reply(503, { error: "data_unavailable" });
  const byEmail = email => [...users].find(([, data]) => String(data?.email || "").trim().toLowerCase() === email);

  if (url.pathname === "/__formula/provisioning/profile/find") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!email.includes("@")) return reply(400, { error: "email_invalid" });
    const hit = byEmail(email);
    return reply(200, hit ? { found: true, formula_user_id: hit[0] } : { found: false });
  }
  if (url.pathname === "/__formula/provisioning/profile/read") {
    const id = String(body.formula_user_id || "");
    const data = users.get(id);
    return reply(200, data ? { found: true, formula_user_id: id, email: String(data.email || ""), role: String(data.role || "") } : { found: false });
  }
  if (url.pathname === "/__formula/provisioning/profile/role") {
    // เปลี่ยนบทบาทของโปรไฟล์ที่ OPC/IAM จับคู่ไว้แล้ว — ทางเดียวคือ fs_set_user_role
    const id = String(body.formula_user_id || "");
    const role = String(body.role || "");
    const centralUserId = String(body.central_user_id || "").trim();
    if (!id || !KNOWN_ROLES.includes(role) || !/^[0-9a-f-]{36}$/i.test(centralUserId)) return reply(400, { error: "body_invalid" });
    const data = users.get(id);
    if (!data) return reply(404, { error: "profile_not_found" });
    // แถวที่ OPC สร้างมีรหัสกลางติดอยู่ ต้องตรงกัน · แถวเดิมก่อนมีระบบนี้ไม่มี ให้ OPC ยืนยันการจับคู่มาแล้ว
    if (data.central_user_id && data.central_user_id !== centralUserId) return reply(409, { error: "profile_conflict" });
    if (data.role !== role) {
      const set = await setUserRole(id, role);
      if (!set.ok) return reply(503, { error: "role_projection_failed" });
      await auditLine({ decision: "profile-role-set", name: id, role, before: String(data.role || ""), via: "opc-user-access", operation: String(body.idempotency_key || "").slice(0, 200) });
    }
    return reply(200, { formula_user_id: id, role });
  }
  if (url.pathname !== "/__formula/provisioning/profile") return reply(404, { error: "not_found" });

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const centralUserId = String(body.central_user_id || "").trim();
  const role = String(body.role || "");
  if (!name || !email.includes("@") || !/^[0-9a-f-]{36}$/i.test(centralUserId) || !KNOWN_ROLES.includes(role)) return reply(400, { error: "body_invalid" });

  const existing = byEmail(email);
  if (existing) {
    if (existing[1]?.central_user_id !== centralUserId) return reply(409, { error: "profile_conflict" });
    // ทำซ้ำหลังตั้งบทบาทไม่สำเร็จ (หรือแพ้การแข่งกัน) ต้องจบที่บทบาทเดียวกันเสมอ
    if (existing[1]?.role !== role) {
      const again = await setUserRole(existing[0], role);
      if (!again.ok) return reply(503, { error: "role_projection_failed" });
    }
    return reply(200, { formula_user_id: existing[0], created: false });
  }
  if (users.has(name)) return reply(409, { error: "profile_conflict" });
  const insert = await fetch(`${SB_ORIGIN}${SB_REST_BASE}/fs_users`, {
    method: "POST",
    headers: { ...upstreamAuthHeaders(), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ name, data: { name, email, central_user_id: centralUserId, provisionedBy: "opc-user-access" } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!insert || (!insert.ok && insert.status !== 409)) return reply(503, { error: "data_unavailable" });
  if (insert.status === 409) {
    // อีกคำขอสร้างแถวนี้ไปก่อนเสี้ยววินาที — อ่านใหม่แล้วตัดสินแบบเดียวกับข้างบน
    const again = await formulaProfileByName(name).catch(() => null);
    if (again && String(again.data?.email || "").toLowerCase() === email && again.data?.central_user_id === centralUserId) {
      if (again.data?.role !== role) {
        const projected = await setUserRole(name, role);
        if (!projected.ok) return reply(503, { error: "role_projection_failed" });
      }
      return reply(200, { formula_user_id: name, created: false });
    }
    return reply(409, { error: "profile_conflict" });
  }
  const roleSet = await setUserRole(name, role);
  if (!roleSet.ok) return reply(503, { error: "role_projection_failed" });
  await auditLine({ decision: "profile-provisioned", name, role, email, via: "opc-user-access", operation: String(body.idempotency_key || "").slice(0, 200) });
  return reply(200, { formula_user_id: name, created: true });
}

async function handleSession(request, response, url) {
  const headers = baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  const reply = (status, payload, extra = {}) => {
    response.writeHead(status, { ...headers, ...extra });
    response.end(JSON.stringify(payload));
  };
  if (FORMULA_IAM_SESSION_MODE) return handleIamSession(request, response, reply);

  if (request.method === "GET") {
    const session = readSession(request);
    if (!session && await signInFormulaByAccess(request, reply)) return;
    if (!session) return reply(401, { authenticated: false });
    const canFormulaEdit = await formulaEditAllowed(session.centralUserId);
    return reply(200, {
      authenticated: true,
      name: session.name,
      role: session.role,
      email: session.email,
      centralUserId: session.centralUserId,
      canEdit: formulaSyncCanWrite(session.role),
      canFormulaEdit,
      expiresAt: new Date(session.exp).toISOString(),
    });
  }

  if (request.method === "DELETE") {
    // ออกจากระบบก็เป็นเหตุการณ์ของตัวตน ต้องมีร่องรอยเหมือนกัน
    // (ถ้าคุกกี้หมดอายุไปเองจะไม่มีบรรทัดนี้ ซึ่งถูกแล้ว — ไม่มีใครกดอะไร)
    const leaving = readSession(request);
    if (leaving) await auditLine({ decision: "signed-out", name: leaving.name, role: leaving.role, ip: clientIp(request) });
    return reply(200, { authenticated: false }, { "set-cookie": sessionCookieHeader("", 0) });
  }

  if (request.method !== "POST") {
    return reply(405, { message: `เมธอด ${request.method} ใช้กับปลายทางนี้ไม่ได้` });
  }

  if (!SESSION_SECRET) return reply(503, { message: "ยังไม่ได้ตั้งกุญแจเซ็นเซสชันบนเซิร์ฟเวอร์" });
  if (!OPC_LOGIN_ORIGIN) return reply(503, { message: "ยังไม่ได้ตั้งปลายทางล็อกอินของ OPC Workflow" });

  let body = null;
  try {
    body = JSON.parse((await readBody(request)).toString("utf8"));
  } catch {
    return reply(400, { message: "รูปแบบข้อมูลไม่ถูกต้อง" });
  }

  const login = String(body?.login || "").trim().slice(0, 100);
  const password = String(body?.password || "");
  if (!login || !password) return reply(400, { message: "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ" });

  const ip = clientIp(request);
  const accountKey = `acct:${login.toLowerCase()}`;
  if (loginBlocked(accountKey) || loginBlocked(`ip:${ip}`)) {
    auditDenied({ decision: "denied", status: 429, why: "กรอกรหัสผิดเกินกำหนด", login: login.toLowerCase(), ip });
    return reply(429, { message: "กรอกรหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก 15 นาที" });
  }

  const result = await opcLogin(login, password, ip);

  if (result.status === 429) {
    return reply(429, { message: "ระบบ OPC Workflow ขอให้ลองใหม่ภายหลัง" });
  }
  if (result.status !== 200 || result.body?.result !== "ok") {
    recordLoginFailure(accountKey);
    recordLoginFailure(`ip:${ip}`);
    // บันทึกว่าล็อกอินไม่ผ่าน แต่ไม่บันทึกรหัสผ่าน ไม่ว่ากรณีใด
    auditDenied({
      decision: "denied",
      status: 401,
      why: result.error ? `ติดต่อ OPC ไม่ได้: ${result.error}` : "OPC ปฏิเสธชื่อผู้ใช้หรือรหัสผ่าน",
      login: login.toLowerCase(),
      ip,
      opcStatus: result.status,
    });
    if (result.status === 502) {
      return reply(502, { message: "ติดต่อระบบ OPC Workflow ไม่ได้ชั่วคราว ลองใหม่อีกครั้ง" });
    }
    return reply(401, { message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }

  const opcUser = result.body.user || {};
  const email = canonicalOpcEmail(opcUser, login);
  const centralUserId = String(opcUser.centralUserId || "").trim();
  if (!centralUserId && IAM_ENFORCE) {
    await auditLine({ decision: "denied", status: 503, why: "OPC ไม่ส่ง central_user_id จาก IAM", email: email.toLowerCase(), ip });
    return reply(503, { message: "บัญชีนี้ยังเชื่อมกับผู้ใช้กลางของ IAM ไม่สมบูรณ์" });
  }
  const iamDecision = await iamPermission(centralUserId, "FORMULA_VIEW");
  if (iamDecision === null) {
    await auditLine({ decision: "denied", status: 503, why: "IAM ไม่พร้อมตรวจสิทธิ์ Formula", email: email.toLowerCase(), ip });
    return reply(503, { message: "IAM ไม่พร้อมตรวจสิทธิ์ จึงยังไม่เปิด Formula" });
  }
  if (iamDecision.allowed !== true) {
    await auditLine({ decision: "denied", status: 403, why: "IAM ปฏิเสธสิทธิ์ Formula", email: email.toLowerCase(), ip, reason: iamDecision.reason_code || "DENIED" });
    return reply(403, { message: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน Formula" });
  }

  const lookup = await formulaUserByEmail(email);
  if (lookup.error) return reply(502, { message: lookup.error });
  if (!lookup.row) {
    auditDenied({
      decision: "denied",
      status: 403,
      why: "ล็อกอิน OPC ผ่าน แต่ไม่มีอีเมลนี้ใน fs_users ของ Formula Studio",
      email: email.toLowerCase(),
      ip,
    });
    return reply(403, {
      message: `เข้าระบบ OPC ผ่านแล้ว แต่ยังไม่มีบัญชีอีเมล ${email} ใน Formula Studio — ให้ผู้ดูแลเพิ่มอีเมลนี้ให้ผู้ใช้ก่อน`,
    });
  }

  // บทบาทใน Formula Studio ใช้ของ Formula Studio เสมอ ไม่เอาบทบาทจาก OPC มาทับ
  // สองระบบมีชุดบทบาทคนละชุด การแปลงข้ามระบบเป็นการเดา และการเดาเรื่องสิทธิ์คือความผิดพลาด
  const payload = {
    name: lookup.row.data?.name || lookup.row.name,
    role: lookup.row.data?.role || "",
    email,
    centralUserId,
    canEdit: formulaSyncCanWrite(lookup.row.data?.role || ""),
    canFormulaEdit: await formulaEditAllowed(centralUserId),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const cookie = sessionCookieHeader(signSession(payload), Math.floor(SESSION_TTL_MS / 1000));
  loginFailures.delete(accountKey);
  loginFailures.delete(`ip:${ip}`);

  /* บันทึกตอน "สำเร็จ" ด้วย ไม่ใช่บันทึกแต่ตอนล้ม
   *
   * ก่อนหน้านี้ไฟล์นี้มีแต่ auditDenied() ผลคือบันทึกทั้งวันตอบได้ว่าใครเข้า "ไม่ได้"
   * แต่ตอบไม่ได้เลยว่าใครเข้า "ได้" — ซึ่งกลับหัวกับสิ่งที่บันทึกสำหรับตรวจย้อนหลังต้องการ
   * เจ้าของล็อกอินจริงเมื่อบ่ายวันที่ 24 ส.ค. แล้วไม่มีร่องรอยในระบบเลยแม้แต่บรรทัดเดียว
   * (ฝั่งแอปเคยมี logAct('auth','เข้าใช้งาน') แต่มันอยู่ใน loginUserAt() ซึ่งเป็นทางเก่า
   *  ที่ตัวตนย้ายไป OPC แล้วไม่มีใครเดินผ่านอีก)
   *
   * เขียนลงไฟล์บันทึกของ runtime อย่างเดียว ไม่เขียนลง fs_activities —
   * นั่นเป็น "ข้อมูลของแอป" ไม่ใช่ "บันทึกของ runtime" การไปแทรกแถวที่แอปไม่รู้จัก
   * ลงตารางที่แอปอ่านมาแสดง คือการแต่งประวัติของอีกระบบหนึ่ง
   *
   * ไม่บันทึกรหัสผ่าน ไม่ว่ากรณีใด
   */
  await auditLine({
    decision: "signed-in",
    name: payload.name,
    role: payload.role,
    email: email.toLowerCase(),
    ip,
    expiresAt: new Date(payload.exp).toISOString(),
  });

  return reply(200, {
    authenticated: true,
    name: payload.name,
    role: payload.role,
    email,
    centralUserId,
    canEdit: payload.canEdit,
    canFormulaEdit: payload.canFormulaEdit,
  }, { "set-cookie": cookie });
}

// ---------------------------------------------------------------------------
// 6. เสิร์ฟไฟล์เสริมพร้อมเลขรุ่นจากค่าแฮชของเนื้อไฟล์
//    ใส่ immutable เฉพาะตอน ?v= ตรงกับแฮชปัจจุบัน — หน้าเก่าจะถามใหม่เสมอ
//    หน้าใหม่จ่ายรอบเดียว (บทเรียนของ OPC: ก่อนมีเรื่องนี้ โหลดซ้ำหน้าละ 3.8 วินาที)
// ---------------------------------------------------------------------------
function serveAsset(request, response, asset, requestedVersion) {
  const fresh = requestedVersion === asset.version;
  response.writeHead(
    200,
    baseHeaders({
      "content-type": asset.type,
      "cache-control": fresh ? "public, max-age=31536000, immutable" : "no-cache",
    }),
  );
  if (request.method === "HEAD") return response.end();
  response.end(asset.source);
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", "http://formula.local");

  const run = async () => {
    // Before every handler, including sessions, diagnostics and recovery routes.
    if (url.pathname !== "/__formula/health" && !DATA_ENABLED) {
      request.resume();
      response.writeHead(503, baseHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
      return response.end(JSON.stringify({ error: BACKEND_CONFIG_VALID ? "standby" : "backend_configuration_invalid" }));
    }
    if (url.pathname === "/__formula/rollback-chat-recovery") {
      if (!["GET", "HEAD"].includes(request.method)) return deny(response, 405, "หน้ากู้คืนรองรับ GET และ HEAD เท่านั้น", { path: url.pathname });
      if (!rollbackChatRecoveryRoute || !chatJournalRoute) return deny(response, 503, "หน้ากู้คืนยังไม่พร้อม", { path: url.pathname });
      response.writeHead(200, baseHeaders({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      }));
      return response.end(request.method === "HEAD" ? undefined : `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Formula — กู้คืนแชต</title><body style="font:16px/1.6 system-ui,sans-serif;color:#202124;background:#fff;max-width:960px;margin:24px auto;padding:0 16px;overflow-wrap:anywhere"><h1>กู้คืนข้อมูลแชตในเครื่องนี้</h1><p>ดาวน์โหลดสำเนาข้อมูลค้างของบัญชีที่เข้าสู่ระบบ โดยตรวจสอบตัวตนกับเซิร์ฟเวอร์ก่อนทุกครั้ง ข้อมูลเก่าที่ระบุเจ้าของไม่ได้ให้ Admin ตรวจสอบ</p><p>หน้านี้ไม่ส่งข้อมูลแชตไปยังระบบกลาง และไม่แก้ไขหรือลบข้อมูลเดิมในเครื่อง</p>${scriptTag(chatJournalRoute)}${scriptTag(rollbackChatRecoveryRoute)}</body></html>`);
    }
    if (url.pathname === "/__formula/job-integrity") return handleJobIntegrity(request, response);
    if (url.pathname === "/__formula/job-versions") return handleJobVersions(request, response, url);
    if (url.pathname === "/__formula/chat-recovery") {
      if (!chatRecoveryRoute || !chatJournalRoute) return deny(response,503,"หน้ากู้คืนยังไม่พร้อม",{path:url.pathname});
      if (!["GET","HEAD"].includes(request.method)) return deny(response,405,"อ่านได้เท่านั้น",{path:url.pathname});
      response.writeHead(200,baseHeaders({"content-type":"text/html; charset=utf-8","cache-control":"no-store"}));
      return response.end(request.method === "HEAD" ? undefined : `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Formula — กู้คืนแชต</title><body><h1>ข้อมูลแชตรอกู้คืนในเครื่องนี้</h1><p>ตรวจสอบสิทธิ์ก่อนดาวน์โหลด ข้อมูลจะไม่ถูกส่งหรือแก้ไขในระบบกลาง</p>${scriptTag(chatJournalRoute)}${scriptTag(chatRecoveryRoute)}</body></html>`);
    }
    if (url.pathname === "/__formula/visible-record-ids") return handleScopedRead(request, response, url, { idsOnly: true });
    if (url.pathname === "/__formula/scoped-chat-history") return handleScopedRead(request, response, url, { scopedHistory: true });
    if (url.pathname === "/__formula/visible-chat-snapshot") return handleScopedRead(request, response, url, { snapshot: true });
    if (url.pathname === "/__formula/client-diagnostic") return handleClientDiagnostic(request, response);
    if (url.pathname === "/__formula/health") {
      response.writeHead(200, baseHeaders({ "content-type": "application/json; charset=utf-8" }));
      return response.end(
        JSON.stringify({
          // สคริปต์เชื่อมล็อกอินขาดไม่ได้แล้ว ตั้งแต่ตัวตนย้ายไปอยู่กับ OPC
          //
          // ถ้ามันหายไป หน้าเว็บยังเสิร์ฟได้ตามปกติ แต่ประตูข้อมูลปฏิเสธคำขอที่ไม่มีเซสชัน
          // แอปจึงค้างที่ "กำลังเชื่อมต่อเซิร์ฟเวอร์…" ตลอดกาล ไม่มีช่องให้กรอกอะไรเลย
          // — พังสนิทในสายตาผู้ใช้ แต่เดิมตรงนี้ยังตอบ ok เพราะดูแค่การเปลี่ยนปลายทางข้อมูล
          //
          // ยังอ่านไฟล์แบบผ่อน (readOptional) ไม่ใช่อ่านเข้ม เพราะการตายตั้งแต่เปิดโปรแกรม
          // แปลว่าเว็บล่มทั้งเว็บ ซึ่งแย่กว่าการบอกว่าตัวเองไม่พร้อมแล้วให้ด่านจับ
          configuredBackend: ["local", "supabase"].includes(CONFIGURED_BACKEND) ? CONFIGURED_BACKEND : "unknown",
          backendConfiguration: BACKEND_CONFIG_VALID ? "valid" : "invalid",
          trafficMode: ["serving", "standby"].includes(TRAFFIC_MODE) ? TRAFFIC_MODE : "invalid",
          servingEligible: DATA_ENABLED,
          status: !BACKEND_CONFIG_VALID ? "degraded" : TRAFFIC_MODE === "standby" ? "standby" :
            gatewayPatchState === "rewritten" && Boolean(sessionBridgeRoute) && Boolean(jobSyncRoute) && Boolean(rollbackChatRecoveryRoute) && Boolean(adminActivityLogRoute) && Boolean(chatRecoveryRoute) && Boolean(chatJournalRoute) && jobSyncCompatible && adminActivityLogCompatible && DATA_ENABLED && intakeReady
              ? "ok"
              : "degraded",
          sessionBridge: sessionBridgeRoute ? "loaded" : "missing",
          adminActivityLog: adminActivityLogRoute ? "loaded" : "missing",
          adminActivityLogCompatible,
          chatJournal: chatJournalRoute ? "loaded" : "missing",
          chatRecovery: chatRecoveryRoute ? "loaded" : "missing",
          jobSync: jobSyncRoute ? "loaded" : "missing",
          jobSyncCompatible,
          rollbackChatRecovery: rollbackChatRecoveryRoute ? "loaded" : "missing",
          jobIntake: !DATA_ENABLED ? (BACKEND_CONFIG_VALID ? "standby" : "disabled") : jobIntake ? (intakeReady ? "ready" : "unavailable") : "disabled",
          jobIntakeSourceSha,
          jobIntakeCapacity: intakeCapacity,
          jobIntegrity: { intervalMs: JOB_INTEGRITY_INTERVAL_MS, status: integrityReport.status, checkedAt: integrityReport.checkedAt },
          color: COLOR,
          release: releaseId,
          buildStamp: releaseMeta.buildStamp,
          gateway: gatewayPatchState,
          gatewayKeyKind: SB_KEY_KIND,
          upstream: !BACKEND_CONFIG_VALID && SB_IS_SUPABASE ? "supabase-blocked" : ["local", "supabase"].includes(CONFIGURED_BACKEND) ? CONFIGURED_BACKEND : "unknown",
          authMode: FORMULA_IAM_SESSION_MODE ? "iam-session" : FORMULA_ACCESS_SSO_ENABLED ? "cloudflare-access-or-opc-session" : "opc-session",
          iamSessionMode: FORMULA_IAM_SESSION_MODE,
          provisioningGateway: FORMULA_PROVISIONING_SECRET.length >= 32,
          accessSsoEnabled: FORMULA_ACCESS_SSO_ENABLED,
          iamEnforced: IAM_ENFORCE,
          opcLoginConfigured: Boolean(OPC_LOGIN_ORIGIN),
          sessionSecretConfigured: Boolean(SESSION_SECRET),
          proxySourceSha,
          assets: Object.fromEntries([...assets].map(([route, a]) => [route, a.version])),
          forwarded: forwardedCount,
          denied: deniedCount,
          // แถวที่ถูกนโยบายรายฟิลด์กรองออก — ต่างจาก denied ตรงที่คำขอยัง "สำเร็จ"
          // ตัวเลขนี้ควรนิ่งอยู่ที่ 0 ตอนใช้งานปกติ ขยับเมื่อไหร่แปลว่ามีคนพยายามทำ
          // สิ่งที่ทำไม่ได้ หรือ rpc ออกเลขงานกำลังมีปัญหา — อ่านรายละเอียดที่ gateway-<วัน>.ndjson
          filtered: filteredCount,
          aiDependency: false,
        }),
      );
    }

    if (url.pathname === "/sb/session") return handleSession(request, response, url);
    if (url.pathname.startsWith("/__formula/provisioning/")) return handleProvisioning(request, response, url);
    if (url.pathname.startsWith("/sb/rest/v1/")) return handleGateway(request, response, url);
    if (url.pathname.startsWith("/sb/")) {
      return deny(response, 404, `ปลายทาง ${url.pathname} ไม่มีในประตูข้อมูล`, {
        path: url.pathname,
      });
    }

    const asset = assets.get(url.pathname);
    if (asset) return serveAsset(request, response, asset, url.searchParams.get("v"));

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(
        200,
        baseHeaders({
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": CSP,
          "content-length": servedHtmlBuffer.length,
        }),
      );
      if (request.method === "HEAD") return response.end();
      return response.end(servedHtmlBuffer);
    }

    response.writeHead(404, baseHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("ไม่พบหน้านี้\n");
  };

  run().catch(error => {
    console.error("[proxy] จัดการคำขอไม่สำเร็จ:", error?.message ?? error);
    if (response.headersSent) return response.destroy();
    response.writeHead(502, baseHeaders({ "content-type": "application/json; charset=utf-8" }));
    response.end(JSON.stringify({ message: "runtime ติดต่อปลายทางไม่ได้ ลองใหม่อีกครั้ง" }));
  });
});

server.headersTimeout = 65_000;
server.requestTimeout = 90_000;
if (jobIntake) {
  scheduleJobIntegrity();
  setInterval(() => { void runJobIntegrity(); void runJobRepair(); }, JOB_INTEGRITY_INTERVAL_MS).unref();
}
server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[proxy] สี=${COLOR} รุ่น=${releaseId} (${releaseMeta.buildStamp}) พอร์ต=${PORT} ประตูข้อมูล=${gatewayPatchState} คีย์=${SB_KEY_KIND}`,
  );
});
