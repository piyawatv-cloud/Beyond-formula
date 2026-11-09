import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const helper = join(root, "scripts/wait-formula-proxy-ready.sh");

async function fixture(response) {
  const dir = await mkdtemp(join(tmpdir(), "formula-proxy-ready-"));
  const bin = join(dir, "bin");
  const calls = join(dir, "calls");
  await mkdir(bin);
  await writeFile(calls, "0");
  await writeFile(join(bin, "curl"), `#!/bin/sh
n=$(cat "${calls}")
n=$((n + 1))
printf '%s' "$n" > "${calls}"
${response}
`);
  await chmod(join(bin, "curl"), 0o755);
  return { dir, bin, calls };
}

function run(fx) {
  return spawnSync("sh", [helper, "green", "3027"], {
    env: { ...process.env, PATH: `${fx.bin}:/usr/bin:/bin`, FORMULA_PROXY_READY_INTERVAL_SECONDS: "0", FORMULA_PROXY_READY_ATTEMPTS: "3" },
    encoding: "utf8",
  });
}

test("proxy readiness waits until HTTP health is ok", async () => {
  const fx = await fixture("[ \"$n\" -lt 2 ] && printf '{\\\"status\\\":\\\"starting\\\"}' || printf '{\\\"status\\\":\\\"ok\\\"}'");
  try {
    const result = run(fx);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await readFile(fx.calls, "utf8")).trim(), "2");
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("proxy readiness fails closed when health never becomes ok", async () => {
  const fx = await fixture("printf '{\\\"status\\\":\\\"starting\\\"}'");
  try {
    const result = run(fx);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /HTTP health=ok/);
    assert.equal((await readFile(fx.calls, "utf8")).trim(), "3");
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("prepare calls readiness before the existing full color verification", async () => {
  const source = await readFile(join(root, "scripts/blue-green-formula.sh"), "utf8");
  const prepare = source.indexOf("  prepare)");
  const readiness = source.indexOf("wait-formula-proxy-ready.sh", prepare);
  const verification = source.indexOf("verify_color \"$2\"", prepare);
  assert.ok(prepare >= 0 && readiness > prepare && verification > readiness);
});

test("prepare integrates the readiness retry before serving the green color", async () => {
  const dir = await mkdtemp(join(tmpdir(), "formula-prepare-ready-"));
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  const events = join(dir, "events");
  const stack = join(dir, "stack.env");
  const secret = join(dir, "formula.env");
  await mkdir(bin, { recursive: true });
  await mkdir(join(state, "runtime-state", "formula"), { recursive: true });
  await writeFile(join(state, "runtime-state", "formula", "active"), "blue\n");
  await writeFile(events, "");
  const stamp = JSON.parse(await readFile(join(root, "releases", (await readFile(join(root, "releases", "CURRENT"), "utf8")).trim(), "meta.json"), "utf8")).buildStamp;
  const stackSource = await readFile(join(root, "runtime", "stack.env"), "utf8");
  await writeFile(stack, `${stackSource}\nFORMULA_STATE_ROOT=${state}\n`);
  await writeFile(secret, "FORMULA_PROBE_TOKEN=probe\nSB_ANON_KEY=\n");
  await writeFile(join(bin, "security"), "#!/bin/sh\nexit 1\n");
  await writeFile(join(bin, "docker"), `#!/bin/sh
printf 'docker %s\\n' "$*" >> "${events}"
case "$*" in
  *"Health.Status"*) printf 'healthy' ;;
esac
exit 0
`);
  await writeFile(join(bin, "curl"), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "${events}"
case "$*" in
  *"__formula/health"*)
    n=$(grep -c 'health-call' "${events}" 2>/dev/null || true)
    n=$((n + 1))
    if [ "$n" -le 2 ]; then status=starting; else status=ok; fi
    printf 'health-call %s %s\\n' "$n" "$status" >> "${events}"
    printf '{"status":"%s","gateway":"rewritten","color":"green","opcLoginConfigured":true,"sessionSecretConfigured":true}' "$status"
    ;;
  *"-sSI"*) printf 'HTTP/1.1 200 OK\\ncontent-security-policy: default-src '\''self'\''\\n' ;;
  *"-w %{http_code}"*)
    case "$*" in
      *fs_records*) printf '401' ;;
      *apikey:*fs_meta*) printf '200' ;;
      *fs_meta*) printf '401' ;;
      */sb/session*) printf '401' ;;
      *) printf '200' ;;
    esac
    ;;
  *) printf '<html><body><div name="fs-shell">%s</div></body></html>' "${stamp}" ;;
esac
`);
  await chmod(join(bin, "security"), 0o755);
  await chmod(join(bin, "docker"), 0o755);
  await chmod(join(bin, "curl"), 0o755);
  try {
    const result = spawnSync("sh", [join(root, "scripts", "blue-green-formula.sh"), "prepare", "green"], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        FORMULA_STACK_ENV: stack,
        FORMULA_ENV_FILE: secret,
        FORMULA_DATA_ENV_FILE: join(dir, "missing-data.env"),
        FORMULA_PROXY_READY_ATTEMPTS: "3",
        FORMULA_PROXY_READY_INTERVAL_SECONDS: "0",
      },
      encoding: "utf8",
    });
    const log = await readFile(events, "utf8");
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}\n${log}`);
    assert.match(log, /health-call 1 starting/);
    assert.match(log, /health-call 2 starting/);
    assert.match(log, /health-call 3 ok/);
    assert.match(log, /health-call 4 ok/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
