// Formula Studio runtime edge
// ---------------------------------------------------------------------------
// งานเดียว: ตัดสินว่าคำขอนี้จะไปสีไหน แล้วส่งต่อ
//
// สิ่งที่ไฟล์นี้ "ไม่" ทำเลย คือแตะเนื้อหา ไม่แทรกอะไร ไม่แก้อะไร
// เพราะถ้าเอาสองงานนี้มารวมกัน เวลาเว็บเพี้ยนจะแยกไม่ออกว่าเพราะเลือกสีผิด
// หรือเพราะแทรกของผิด — ระบบ OPC แยกสองอย่างนี้ด้วยเหตุผลเดียวกัน
//
// เรื่องเวลาเป็นเรื่องเป็นเรื่องตาย: Cloudflare ตัดที่ 100 วินาที ถ้าเราปล่อยให้เกิน
// ผู้ใช้จะเห็นหน้า 524 ของ Cloudflare ซึ่งเราควบคุมอะไรไม่ได้เลย เราจึงตัดเองที่ 90
// และตัดเมื่อ "เงียบ" เกิน 30 วินาที (ไม่ใช่ตัดตามเวลารวม) เพื่อให้อัปโหลดช้า ๆ ยังรอด

import { createServer, request as httpRequest } from "node:http";
import { mkdir, readFile, rename, stat, writeFile, appendFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT || 3025);
const STATE_DIR = process.env.FORMULA_STATE_DIR || "/state";
const LOG_DIR = process.env.FORMULA_LOG_DIR || "/logs";
const BACKENDS = {
  blue: process.env.FORMULA_BLUE_ORIGIN || "http://formula-runtime-blue:3000",
  green: process.env.FORMULA_GREEN_ORIGIN || "http://formula-runtime-green:3000",
};
// Independent route gate also protects against a stale proxy that still reports ok.
const TRAFFIC_MODES = {
  blue: process.env.FORMULA_BLUE_TRAFFIC_MODE || "serving",
  green: process.env.FORMULA_GREEN_TRAFFIC_MODE || "serving",
};
const routeEligible = color => TRAFFIC_MODES[color] === "serving" && health[color].servingEligible;
const HEALTH_INTERVAL_MS = Number(process.env.FORMULA_HEALTH_INTERVAL_MS || 2000);
const FAILURE_THRESHOLD = Number(process.env.FORMULA_FAILURE_THRESHOLD || 3);
const REQUEST_TIMEOUT_MS = 90_000;
const UPSTREAM_IDLE_TIMEOUT_MS = 30_000;
const TRANSITION_LOCK_STALE_MS = 120_000;

const ACTIVE_FILE = `${STATE_DIR}/active`;
const SWITCH_LOG = `${STATE_DIR}/switches.ndjson`;
const LOCK_DIR = `${STATE_DIR}/transition.lock`;

let unavailablePage = "<h1>ระบบกำลังกลับมา</h1><p>ลองใหม่อีกครั้งในสักครู่</p>";
try {
  unavailablePage = readFileSync(
    process.env.FORMULA_UNAVAILABLE_PAGE || "/edge/formula-unavailable.html",
    "utf8",
  );
} catch (error) {
  console.error("[edge] ไม่มีหน้าแจ้งเตือนสำรอง ใช้ข้อความสั้นแทน:", error?.code ?? error);
}

// ---------------------------------------------------------------------------
// สถานะสีที่ใช้อยู่
//
// อ่านจากไฟล์คำเดียว เขียนด้วยวิธี "เขียนไฟล์ชั่วคราวแล้ว rename" เสมอ
// เพราะ rename เป็นการกระทำเดียวที่แบ่งครึ่งไม่ได้ — ไม่มีวินาทีไหนที่ไฟล์ว่าง
// ---------------------------------------------------------------------------
let activeColor = "blue";
let lastKnownGood = "blue";

async function readActive() {
  try {
    const value = (await readFile(ACTIVE_FILE, "utf8")).trim();
    if (value === "blue" || value === "green") {
      activeColor = value;
      lastKnownGood = value;
      return value;
    }
    console.error(`[edge] ไฟล์ active มีค่าที่ไม่รู้จัก: "${value}" — ใช้ค่าเดิม ${lastKnownGood}`);
  } catch (error) {
    console.error(`[edge] อ่านไฟล์ active ไม่ได้ (${error?.code ?? error}) — ใช้ค่าเดิม ${lastKnownGood}`);
  }
  activeColor = lastKnownGood;
  return activeColor;
}

async function writeActive(color, reason) {
  const temp = `${ACTIVE_FILE}.tmp`;
  await writeFile(temp, `${color}\n`);
  await rename(temp, ACTIVE_FILE);
  activeColor = color;
  lastKnownGood = color;
  const record = { at: new Date().toISOString(), color, reason };
  await appendFile(SWITCH_LOG, `${JSON.stringify(record)}\n`).catch(() => {});
  console.log(`[edge] สลับไปสี ${color} เหตุผล=${reason}`);
}

// ---------------------------------------------------------------------------
// ล็อกช่วงเปลี่ยนผ่าน — ใช้ mkdir เพราะมันล้มเหลวทันทีถ้ามีคนถืออยู่แล้ว
// สคริปต์ deploy ถือล็อกตัวเดียวกันนี้ ทำให้ "failover อัตโนมัติ" กับ "การสลับสีตอน deploy"
// ไม่มีทางเกิดพร้อมกัน — ของอันหนึ่งจะรอ ไม่ใช่ชนกัน
// ---------------------------------------------------------------------------
async function lockHeld() {
  try {
    const heartbeat = await stat(`${LOCK_DIR}/heartbeat`);
    const age = Date.now() - heartbeat.mtimeMs;
    if (age > TRANSITION_LOCK_STALE_MS) {
      console.error(`[edge] CRITICAL ล็อกเปลี่ยนผ่านค้างมา ${Math.round(age / 1000)} วินาที — ถือว่าไม่มีเจ้าของแล้ว`);
      await rename(LOCK_DIR, `${LOCK_DIR}.stale-${Date.now()}`).catch(() => {});
      return false;
    }
    return true;
  } catch {
    try {
      await stat(LOCK_DIR);
      return true; // มีโฟลเดอร์ล็อกแต่ยังไม่มี heartbeat = เพิ่งถูกสร้าง
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// ตรวจสุขภาพทั้งสองสี
//
// "ป่วย" ในที่นี้รวมถึงกรณีที่ proxy ตอบ 200 แต่บอกตัวเองว่า degraded ด้วย
// เพราะสีที่เปลี่ยนปลายทาง Supabase ไม่สำเร็จ คือสีที่หน้าเว็บเปิดได้แต่ใช้งานจริงไม่ได้
// ---------------------------------------------------------------------------
const health = {
  blue: { healthy: false, servingEligible: false, configuredBackend: "unknown", failures: 0, detail: "ยังไม่ได้ตรวจ" },
  green: { healthy: false, servingEligible: false, configuredBackend: "unknown", failures: 0, detail: "ยังไม่ได้ตรวจ" },
};

async function probe(color) {
  try {
    const response = await fetch(`${BACKENDS[color]}/__formula/health`, {
      signal: AbortSignal.timeout(HEALTH_INTERVAL_MS * 2),
    });
    if (!response.ok) return { healthy: false, detail: `HTTP ${response.status}` };
    const payload = await response.json();
    const configuredBackend = ["local", "supabase"].includes(payload.configuredBackend) ? payload.configuredBackend : "unknown";
    // Legacy local proxies have no eligibility field. Explicit false/invalid values close the gate.
    const servingEligible = TRAFFIC_MODES[color] === "serving"
      && (payload.servingEligible === true || (payload.servingEligible === undefined && payload.configuredBackend === undefined));
    if (!servingEligible) return { healthy: false, servingEligible: false, configuredBackend, detail: "traffic-ineligible" };
    if (payload.status !== "ok") {
      return { healthy: false, servingEligible, configuredBackend, detail: `proxy บอกว่า ${payload.status} (ประตูข้อมูล=${payload.gateway})` };
    }
    return { healthy: true, servingEligible, configuredBackend, detail: `รุ่น ${payload.release}` };
  } catch (error) {
    return { healthy: false, detail: String(error?.message ?? error).slice(0, 120) };
  }
}

async function healthTick() {
  await readActive();
  for (const color of ["blue", "green"]) {
    const result = await probe(color);
    const state = health[color];
    state.detail = result.detail;
    state.servingEligible = result.servingEligible === true;
    state.configuredBackend = result.configuredBackend || "unknown";
    if (result.healthy) {
      state.healthy = true;
      state.failures = 0;
    } else {
      state.healthy = false;
      state.failures += 1;
    }
  }

  const active = health[activeColor];
  const passiveColor = activeColor === "blue" ? "green" : "blue";
  if (active.failures >= FAILURE_THRESHOLD && health[passiveColor].healthy && routeEligible(passiveColor)) {
    if (await lockHeld()) {
      console.error(`[edge] สี ${activeColor} ป่วย แต่มีการเปลี่ยนผ่านค้างอยู่ — รอก่อน ไม่แย่งสลับ`);
      return;
    }
    await writeActive(passiveColor, `automatic-failover:${activeColor}-unhealthy (${active.detail})`);
    health[activeColor].failures = 0;
  }
}

// ---------------------------------------------------------------------------
// ส่งต่อคำขอ
// ---------------------------------------------------------------------------
function sendUnavailable(request, response, why) {
  if (response.headersSent) return response.destroy();
  const wantsHtml = String(request.headers.accept || "").includes("text/html");
  response.writeHead(503, {
    "content-type": wantsHtml ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": "5",
    "x-formula-runtime-edge": "blue-green-v1",
    "x-formula-edge-why": encodeURIComponent(why).slice(0, 180),
  });
  response.end(wantsHtml ? unavailablePage : JSON.stringify({ message: "ระบบกำลังกลับมา ลองใหม่อีกครั้ง", why }));
}

let abandonedCount = 0;

function forward(request, response, color, allowRetry) {
  if (!routeEligible(color)) return sendUnavailable(request, response, "traffic-ineligible");
  const target = new URL(BACKENDS[color]);
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: request.headers.host },
    },
    upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        "x-formula-runtime-color": color,
        "x-formula-runtime-edge": "blue-green-v1",
      });
      upstreamResponse.pipe(response);
    },
  );

  upstream.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => {
    upstream.destroy(new Error(`ปลายทางเงียบเกิน ${UPSTREAM_IDLE_TIMEOUT_MS / 1000} วินาที`));
  });

  upstream.on("error", error => {
    const retryable = ["GET", "HEAD", "OPTIONS"].includes(request.method || "");
    const other = color === "blue" ? "green" : "blue";
    if (allowRetry && retryable && !response.headersSent && health[other].healthy && routeEligible(other)) {
      console.error(`[edge] สี ${color} ต่อไม่ติด (${error?.message}) — ลองสี ${other} หนึ่งครั้ง`);
      return forward(request, response, other, false);
    }
    sendUnavailable(request, response, `${color}: ${error?.message ?? error}`);
  });

  // ผู้ใช้ปิดหน้าไปแล้ว = งานที่ยังวิ่งอยู่ไม่มีใครรอผลอีกแล้ว ต้องตัดทิ้งทันที
  // ถ้าไม่ตัด งานที่ถูกทิ้งจะกินแรงเครื่องต่อไป ขณะที่คำขอใหม่เข้าคิวรออยู่ข้างหลัง
  // — นั่นคือวิธีที่นาทีเดียวที่ช้า ป้อนตัวเองจนกลายเป็นเหตุล่ม
  response.on("close", () => {
    if (!response.writableFinished) {
      abandonedCount += 1;
      upstream.destroy();
    }
  });

  request.pipe(upstream);
}

// >>> กันประตูสร้างโปรไฟล์ — เริ่มบล็อกที่ tests/edge-provisioning-block.test.mjs ยกออกไปรัน
/** ประตูสร้างโปรไฟล์ของ OPC ใช้ได้จากเครือข่ายภายในเท่านั้น — คำขอที่ผ่าน Cloudflare (มีหัว cf-*) ไม่ถึง proxy */
function provisioningFromInternet(request) {
  // ตัดสินด้วย path ที่ทำให้เป็นแบบเดียวกับที่ proxy เห็น (new URL) — /./ /x/../ %2e ต้องไม่เล็ดลอด
  let path = "";
  try { path = new URL(String(request.url || "/"), "http://edge.local").pathname; } catch { return true; }
  if (!path.toLowerCase().startsWith("/__formula/provisioning")) return false;
  return Boolean(request.headers["cf-ray"] || request.headers["cf-connecting-ip"] || request.headers["cf-access-jwt-assertion"]);
}
// <<< กันประตูสร้างโปรไฟล์ — จบบล็อก

const server = createServer((request, response) => {
  if (provisioningFromInternet(request)) {
    request.resume();
    response.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return response.end(JSON.stringify({ error: "not_found" }));
  }
  if (request.url === "/__formula_edge/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return response.end(
      JSON.stringify({
        status: health[activeColor]?.healthy ? "ok" : "degraded",
        active: activeColor,
        backends: health,
        abandoned: abandonedCount,
        aiDependency: false,
      }),
    );
  }

  const passiveColor = activeColor === "blue" ? "green" : "blue";
  let color = null;
  if (health[activeColor]?.healthy && routeEligible(activeColor)) color = activeColor;
  else if (health[passiveColor]?.healthy && routeEligible(passiveColor)) color = passiveColor;

  if (!color) {
    return sendUnavailable(request, response, `ทั้งสองสีไม่พร้อม (blue: ${health.blue.detail} · green: ${health.green.detail})`);
  }

  forward(request, response, color, true);
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = 65_000;

server.on("upgrade", (request, socket) => {
  // แอปนี้ไม่ได้ใช้ WebSocket เลย (ตรวจแล้วในซอร์สของ Formula Studio)
  // ถ้าวันหนึ่งมีขึ้นมา ต้องมาเขียนท่อตรงนี้ ไม่ใช่ปล่อยให้ค้าง
  socket.end("HTTP/1.1 501 Not Implemented\r\n\r\n");
});

await mkdir(STATE_DIR, { recursive: true }).catch(() => {});
await mkdir(LOG_DIR, { recursive: true }).catch(() => {});
await readActive();
await healthTick();
setInterval(() => {
  healthTick().catch(error => console.error("[edge] ตรวจสุขภาพล้มเหลว:", error?.message ?? error));
}, HEALTH_INTERVAL_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[edge] พอร์ต=${PORT} สีที่ใช้อยู่=${activeColor} blue=${BACKENDS.blue} green=${BACKENDS.green}`);
});
