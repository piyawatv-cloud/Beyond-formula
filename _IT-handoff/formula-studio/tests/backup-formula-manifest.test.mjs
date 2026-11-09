/*
 * A verified backup must describe its final directory.  Run the real backup
 * helper with only its data-pull helpers replaced: no database, Docker, or
 * network endpoint is available to this fixture.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

async function writeExecutable(path, body) {
  await writeFile(path, body);
  await chmod(path, 0o755);
}

async function fileStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = await fileStats(path);
      files += child.files;
      bytes += child.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(path)).size;
    }
  }
  return { files, bytes };
}

test("backup manifest covers immutable metadata and log totals describe final directory", async () => {
  const state = await mkdtemp(join(tmpdir(), "formula-backup-manifest-"));
  const bin = join(state, "bin");
  const envFile = join(state, "formula.env");
  const stackFile = join(state, "stack.env");

  try {
    await mkdir(bin, { recursive: true });
    await mkdir(join(state, "job-intake", "fixture"), { recursive: true });
    await writeFile(envFile, [
      "SB_ORIGIN=http://127.0.0.1:9",
      "SB_ORIGIN_HOST=127.0.0.1",
      "SB_REST_BASE=http://127.0.0.1:9/rest/v1",
      "SB_UPSTREAM_AUTH=none",
      "SB_ANON_KEY=fixture-anon",
      "SB_SERVICE_KEY=fixture-service",
    ].join("\n") + "\n");
    await writeFile(stackFile, "FORMULA_PREFIX=fixture\n");
    await writeExecutable(join(bin, "node"), `#!/bin/sh
set -eu
case "$1" in
  */pull-supabase-tables.mjs)
    mkdir -p "$2"
    printf 'synthetic table row\\n' > "$2/fs_records.ndjson"
    ;;
  */backup-job-intake.mjs)
    [ "$2" = backup ]
    mkdir -p "$4"
    printf 'synthetic sealed receipt\\n' > "$4/receipt.json"
    ;;
  *)
    printf 'unexpected node command: %s\\n' "$1" >&2
    exit 64
    ;;
esac
`);

    const result = spawnSync("sh", [join(root, "scripts/backup-formula.sh"), "manual"], {
      encoding: "utf8",
      env: {
        // Strict allowlist: this test must never inherit a production database
        // URL, state root, Docker configuration, or credentials from its runner.
        HOME: state,
        FORMULA_STATE_DIR: state,
        FORMULA_STATE_ROOT: state,
        FORMULA_ENV_FILE: envFile,
        FORMULA_DATA_ENV_FILE: join(state, "missing-data.env"),
        FORMULA_STACK_ENV: stackFile,
        SB_PG_URL: "",
        PATH: `${bin}:/usr/bin:/bin`,
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);

    const summary = output.match(/backup kind=manual status=ok files=(\d+) bytes=(\d+) dest=(\S+)/);
    assert.ok(summary, `missing final backup summary:\n${output}`);
    const [, loggedFiles, loggedBytes, dest] = summary;
    const manifest = await readFile(join(dest, "SHA256SUMS"), "utf8");
    const meta = JSON.parse(await readFile(join(dest, "backup-meta.json"), "utf8"));
    const final = await fileStats(dest);
    const checked = spawnSync("/usr/bin/shasum", ["-a", "256", "-c", "SHA256SUMS"], {
      cwd: dest,
      encoding: "utf8",
      env: { HOME: state, PATH: "/usr/bin:/bin" },
    });
    const complete = {
      manifestIncludesMeta: /\s\.\/backup-meta\.json$/m.test(manifest),
      checksumExit: checked.status,
      metadataKeys: Object.keys(meta).sort(),
      reportedFiles: Number(loggedFiles),
      finalFiles: final.files,
      reportedBytes: Number(loggedBytes),
      finalBytes: final.bytes,
    };

    assert.ok(
      complete.manifestIncludesMeta
        && complete.checksumExit === 0
        && JSON.stringify(complete.metadataKeys) === JSON.stringify(["approvedPlan", "createdAt", "format", "immutableCommit", "kind", "method", "movedDuringPull", "stamp"])
        && complete.reportedFiles === complete.finalFiles
        && complete.reportedBytes === complete.finalBytes,
      `backup proof must describe its final directory: ${JSON.stringify(complete)}`,
    );
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});
