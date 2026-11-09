/*
 * Offsite backup is operationally optional.  With FORMULA_OFFSITE_ENABLED=0,
 * the verified local PostgreSQL backup and restore proof must still run while
 * no Drive helper or offsite alert is invoked.
 *
 * This fixture executes copies of the production shell entrypoints.  It only
 * replaces their direct data/notification dependencies with local stubs; no
 * Docker daemon, PostgreSQL endpoint, Drive mount, or Telegram endpoint is
 * available to the child processes.
 */
import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

async function executable(path, body) {
  await writeFile(path, body);
  await chmod(path, 0o755);
}

function strictEnv({ home, state, drive }) {
  // Do not inherit credentials or real paths from the interactive production
  // session.  Every stateful location is inside this fixture.
  return {
    HOME: home,
    PATH: "/usr/bin:/bin",
    FORMULA_STATE_DIR: state,
    FORMULA_STATE_ROOT: state,
    FORMULA_STATE_ROOT_OVERRIDE: state,
    FORMULA_DRIVE_ROOT: drive,
    FORMULA_BACKUP_DESTINATION: "drive",
    FORMULA_OFFSITE_ENABLED: "0",
    FORMULA_ALERT_NO_DESKTOP: "1",
    TZ: "UTC",
  };
}

function run(script, env, args = []) {
  const child = spawnSync("/bin/sh", [script, ...args], { env, encoding: "utf8", timeout: 15_000 });
  return { code: child.status, output: `${child.stdout}${child.stderr}` };
}

async function fixture(label) {
  const temp = await mkdtemp(join(tmpdir(), `formula-offsite-disabled-${label}-`));
  const runtime = join(temp, "runtime");
  const scripts = join(runtime, "scripts");
  const state = join(temp, "state");
  const home = join(temp, "home");
  const drive = join(temp, "drive-must-not-be-touched");
  await cp(join(root, "scripts"), scripts, { recursive: true });
  await mkdir(home, { recursive: true });
  return { temp, runtime, scripts, state, home, drive, env: strictEnv({ home, state, drive }) };
}

test("daily backup: disabled offsite preserves local backup + restore proof and never invokes Drive copy", async () => {
  const fx = await fixture("daily");
  try {
    const copyCalled = join(fx.temp, "copy-called");
    const backupCalled = join(fx.temp, "backup-called");
    const restoreCalled = join(fx.temp, "restore-called");
    const backupSet = join(fx.state, "backups", "daily", "fixture-set");

    await executable(join(fx.scripts, "healthcheck-data.sh"), "#!/bin/sh\nexit 0\n");
    await executable(join(fx.scripts, "backup-formula.sh"), `#!/bin/sh
set -eu
mkdir -p "${backupSet}" "$FORMULA_STATE_DIR/runtime-state"
printf backup > "${backupCalled}"
printf '%s\\n' "${backupSet}" > "$FORMULA_STATE_DIR/runtime-state/last-backup-daily"
`);
    await executable(join(fx.scripts, "verify-restore-formula.sh"), `#!/bin/sh
set -eu
[ "$1" = "${backupSet}" ]
printf restore > "${restoreCalled}"
printf 'restore proof passed\\n'
`);
    await executable(join(fx.scripts, "copy-backup-offsite.sh"), `#!/bin/sh
printf copy > "${copyCalled}"
printf 'copy helper invoked\\n'
exit 1
`);

    const result = run(join(fx.scripts, "daily-backup-formula.sh"), fx.env);
    assert.equal(result.code, 0, result.output);
    await readFile(backupCalled, "utf8");
    await readFile(restoreCalled, "utf8");
    await assert.rejects(readFile(copyCalled, "utf8"), /ENOENT/, "offsite-disabled must not invoke the Drive copy helper");
    const log = await readFile(join(fx.state, "monitoring", "backup.log"), "utf8");
    assert.match(log, /daily-backup status=ok kind=daily .*restore-proof=ok/);
    assert.match(log, /offsite=paused/, "operator log must state that offsite transfer was intentionally paused");
    await assert.rejects(readFile(fx.drive, "utf8"), /ENOENT/, "daily backup must not create or access the configured Drive root");
  } finally {
    await rm(fx.temp, { recursive: true, force: true });
  }
});

test("offsite status: paused mode never reads the configured Drive root", async () => {
  const fx = await fixture("status");
  try {
    const result = run(join(fx.scripts, "check-offsite-status.sh"), fx.env, ["/dev/null"]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /^offsite=paused /);
    await assert.rejects(readFile(fx.drive, "utf8"), /ENOENT/, "paused status must not access the Drive root");
  } finally {
    await rm(fx.temp, { recursive: true, force: true });
  }
});

test("invalid offsite mode fails closed instead of silently pausing transfer", async () => {
  const fx = await fixture("invalid");
  try {
    const env = { ...fx.env, FORMULA_OFFSITE_ENABLED: "not-a-mode" };
    const result = run(join(fx.scripts, "check-offsite-status.sh"), env, ["/dev/null"]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /^offsite=unknown why=FORMULA_OFFSITE_ENABLED/);
  } finally {
    await rm(fx.temp, { recursive: true, force: true });
  }
});

test("monitor: disabled offsite is explicit and never calls Drive status or offsite alert", async () => {
  const fx = await fixture("monitor");
  try {
    const checkCalled = join(fx.temp, "check-offsite-called");
    const alertCalled = join(fx.temp, "offsite-alert-called");

    // Keep the normal local restore-proof path successful, then stop at the
    // Docker gate.  The offsite branch is intentionally before that gate.
    await executable(join(fx.scripts, "check-backup-status.sh"), "#!/bin/sh\necho 'backup-proof=ok at=2026-10-10T00:00:00Z กู้คืนผ่าน'\nexit 0\n");
    await executable(join(fx.scripts, "check-offsite-status.sh"), `#!/bin/sh
printf invoked > "${checkCalled}"
echo 'offsite=stub why=must-not-run-when-disabled'
exit 1
`);
    await executable(join(fx.scripts, "alert-backup-proof.sh"), `#!/bin/sh
if [ "\${4:-proof}" = offsite ]; then
  printf invoked > "${alertCalled}"
fi
echo 'backup-alert=idle'
exit 0
`);

    const result = run(join(fx.scripts, "monitor-formula.sh"), fx.env);
    assert.equal(result.code, 1, result.output); // fake environment deliberately has no Docker daemon
    assert.match(result.output, /offsite=paused/, "monitor must publish an explicit paused state");
    assert.doesNotMatch(result.output, /offsite=stub/, "Drive status checker must not run when disabled");
    await assert.rejects(readFile(checkCalled, "utf8"), /ENOENT/, "disabled monitor must not invoke Drive status helper");
    await assert.rejects(readFile(alertCalled, "utf8"), /ENOENT/, "disabled monitor must not send/schedule an offsite alert");
    await assert.rejects(readFile(fx.drive, "utf8"), /ENOENT/, "disabled monitor must not create or touch the Drive root");
  } finally {
    await rm(fx.temp, { recursive: true, force: true });
  }
});

test("monitor: paused offsite never claims local restore proof passed when proof fails", async () => {
  const fx = await fixture("paused-local-failure");
  try {
    const alertCalled = join(fx.temp, "backup-alert-called");
    await executable(join(fx.scripts, "check-backup-status.sh"), "#!/bin/sh\necho 'backup-proof=fail at=2026-10-10T00:00:00Z why=restore failed'\nexit 1\n");
    await executable(join(fx.scripts, "alert-backup-proof.sh"), `#!/bin/sh
printf invoked > "${alertCalled}"
echo backup-alert=idle
exit 0
`);
    const result = run(join(fx.scripts, "monitor-formula.sh"), fx.env);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /backup-proof=fail/);
    assert.match(result.output, /offsite=paused/);
    assert.doesNotMatch(result.output, /พิสูจน์กู้คืนบน iMac ยังผ่าน/);
    await readFile(alertCalled, "utf8");
  } finally {
    await rm(fx.temp, { recursive: true, force: true });
  }
});
