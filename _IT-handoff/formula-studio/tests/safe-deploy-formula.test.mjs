/*
 * ประตู backup ก่อน deploy — รัน safe-deploy-formula.sh จริงใน repository ปลอม
 *
 * ห้ามเรียก deploy จริงจากเทสต์นี้: helper ทุกตัวอยู่ใน temp directory และ docker/curl
 * ถูกแทนด้วยคำสั่งปลอมใน PATH.  backup ปลอมรักษาสัญญาเดียวกับ backup-formula.sh:
 * งาน manual ที่ชน lock อาจ skip ได้ แต่ predeploy ต้อง exit non-zero เสมอ.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

async function executable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

test("backup lock before deploy stops before prepare or switch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "formula-safe-deploy-test-"));
  const scripts = join(repo, "scripts");
  const bin = join(repo, "bin");
  const actions = join(repo, "actions.log");
  const lock = join(repo, "backup.lock");

  try {
    await Promise.all([
      mkdir(scripts, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(join(repo, "runtime"), { recursive: true }),
      mkdir(join(repo, "tests"), { recursive: true }),
    ]);
    await copyFile(join(sourceRoot, "scripts/safe-deploy-formula.sh"), join(scripts, "safe-deploy-formula.sh"));
    await chmod(join(scripts, "safe-deploy-formula.sh"), 0o755);

    await writeFile(join(repo, "runtime/stack.env"), "FORMULA_BLUE_PORT=18081\nFORMULA_GREEN_PORT=18082\n");
    await writeFile(join(repo, "tests/noop.test.mjs"), "import test from 'node:test';\ntest('synthetic release preflight', () => {});\n");
    await writeFile(lock, "a competing backup holds this lock\n");
    await writeFile(actions, "");

    await executable(join(scripts, "backup-formula.sh"), `#!/bin/sh
set -eu
kind="\${1:-manual}"
printf 'backup:%s\\n' "$kind" >> "$DEPLOY_TEST_ACTIONS"
if [ -f "$DEPLOY_TEST_LOCK" ] && [ "$kind" = predeploy ]; then
  printf 'backup kind=predeploy status=fail why=lock held\\n' >&2
  exit 3
fi
# Same contract as the real helper: legacy/manual collision is a skip, which
# demonstrates why safe-deploy must explicitly ask for the stricter kind.
exit 0
`);
    await executable(join(scripts, "verify-data-policy.sh"), `#!/bin/sh
printf 'policy\\n' >> "$DEPLOY_TEST_ACTIONS"
`);
    await executable(join(scripts, "verify-formula-parity.sh"), `#!/bin/sh
printf 'parity\\n' >> "$DEPLOY_TEST_ACTIONS"
`);
    await executable(join(scripts, "blue-green-formula.sh"), `#!/bin/sh
printf '%s\\n' "$1" >> "$DEPLOY_TEST_ACTIONS"
case "$1" in
  active) printf blue ;;
  prepare|switch) exit 0 ;;
  *) exit 2 ;;
esac
`);
    await executable(join(bin, "docker"), `#!/bin/sh
# IAM is intentionally disabled in this synthetic release; the assertion here
# concerns backup ordering, not a live IAM endpoint.
[ "$1" = exec ] && printf false
`);
    await executable(join(bin, "curl"), "#!/bin/sh\nprintf 200\n");

    // safe-deploy records the checked-out revision; give the isolated fixture a
    // real local commit so stderr contains only evidence relevant to this gate.
    for (const args of [
      ["init", "--quiet", repo],
      ["-C", repo, "config", "user.email", "release-test@example.invalid"],
      ["-C", repo, "config", "user.name", "Release test"],
      ["-C", repo, "add", "."],
      ["-C", repo, "commit", "--quiet", "-m", "synthetic release fixture"],
    ]) {
      const git = spawnSync("git", args, { encoding: "utf8" });
      assert.equal(git.status, 0, `cannot construct isolated git fixture: git ${args.join(" ")}\n${git.stderr}`);
    }

    const result = spawnSync("sh", [join(scripts, "safe-deploy-formula.sh")], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_TEST_ACTIONS: actions,
        DEPLOY_TEST_LOCK: lock,
        FORMULA_STATE_ROOT_OVERRIDE: join(repo, "state"),
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    const recorded = await readFile(actions, "utf8");

    assert.notEqual(
      result.status,
      0,
      `backup lock must abort deployment before the color workflow; got exit 0.\n${output}\nactions:\n${recorded}`,
    );
    const actionsTaken = recorded.trim().split("\n").filter(Boolean);
    // active/IAM and the pre-existing data-policy check are deliberately before
    // the backup gate.  From the failed backup onward, no color or post-release
    // command may be reached.
    assert.equal(actionsTaken.at(-1), "backup:predeploy", `wrong backup contract:\n${recorded}`);
    assert.equal(actionsTaken.filter(action => action.startsWith("backup:")).length, 1, `backup ran more than once:\n${recorded}`);
    assert.doesNotMatch(recorded, /^(prepare|switch|parity)$/m, `post-backup release work started:\n${recorded}`);
    assert.equal(actionsTaken.filter(action => action === "policy").length, 1, `post-release policy check ran after lock failure:\n${recorded}`);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("the real predeploy backup helper fails when another backup holds its lock", async () => {
  const state = await mkdtemp(join(tmpdir(), "formula-predeploy-backup-lock-"));
  const envFile = join(state, "formula.env");
  const lock = join(state, "runtime-state", "backup.lock");

  try {
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, "kind"), "daily\n");
    // The real helper reads these before its lock gate. They are inert test
    // values because a held lock returns before any data client is started.
    await writeFile(envFile, [
      "SB_ORIGIN=http://127.0.0.1:9",
      "SB_ORIGIN_HOST=127.0.0.1",
      "SB_REST_BASE=http://127.0.0.1:9/rest/v1",
      "SB_UPSTREAM_AUTH=none",
      "SB_ANON_KEY=test-anon",
      "SB_SERVICE_KEY=test-service",
    ].join("\n") + "\n");

    const result = spawnSync("sh", [join(sourceRoot, "scripts/backup-formula.sh"), "predeploy"], {
      encoding: "utf8",
      env: {
        ...process.env,
        FORMULA_STATE_DIR: state,
        FORMULA_ENV_FILE: envFile,
        FORMULA_DATA_ENV_FILE: join(state, "missing-data.env"),
      },
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 3, output);
    assert.match(output, /backup kind=predeploy status=fail/);
    assert.match(output, /ล็อกถูกถือโดย:daily/);
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});
