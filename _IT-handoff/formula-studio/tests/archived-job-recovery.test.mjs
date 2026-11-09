/* Synthetic PostgreSQL only. Never point this test at Formula production. */
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const scratch = `/tmp/formula-archived-recovery-synthetic-${process.pid}`;
const socket = join(scratch, "socket");
const username = "postgres";
const port = "65439";
let started = false;

const execute = (bin, args, input, options = {}) => spawnSync(bin, args, {
  input,
  encoding: "utf8",
  maxBuffer: 4e6,
  cwd: options.cwd,
  env: { ...process.env, LC_ALL: "C", LANG: "C", ...(options.env || {}) },
});
const run = (bin, args, input) => {
  const result = execute(bin, args, input);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const sqlArgs = (user = username) => ["-X", "-h", socket, "-p", port, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"];
const sql = text => run("psql", sqlArgs(), text);
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const textLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
const runAt = (cwd, bin, args, input = "") => {
  const result = execute(bin, args, input, { cwd });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

function syntheticChainRepo() {
  const repo = mkdtempSync("/tmp/formula-recovery-chain-");
  const files = [
    "runtime/archived-job-recovery.sql",
    "scripts/recover-archived-jobs.sh",
    "scripts/backup-formula.sh",
    "scripts/verify-restore-formula.sh",
    "scripts/validate-recovery-backup.mjs",
  ];
  for (const file of files) {
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  runAt(repo, "git", ["init", "-q"]);
  runAt(repo, "git", ["config", "user.email", "synthetic@example.invalid"]);
  runAt(repo, "git", ["config", "user.name", "Synthetic Recovery"]);
  runAt(repo, "git", ["add", ...files]);
  runAt(repo, "git", ["commit", "-qm", "synthetic immutable recovery artifact"]);
  return { repo, files, commit: runAt(repo, "git", ["rev-parse", "HEAD"]) };
}

const parent = id => ({
  id,
  createdBy: "Synthetic operator fixture",
  createdAt: 1,
  customer: "Synthetic customer",
  brand: "Synthetic brand",
  rows: [{ name: "Synthetic ingredient", w: 1 }],
});
const archivedChat = id => ({
  jobId: id,
  createdBy: "Synthetic archive fixture",
  createdAt: 2,
  parts: [{ user: "Archived synthetic operator" }],
});
const currentChat = id => ({
  jobId: id,
  createdBy: "Current synthetic user",
  createdAt: 99,
  parts: [{ user: "Current synthetic operator" }],
  currentOnly: true,
});
const archivedMessage = (id, index) => ({
  uid: `${id}-synthetic-${String(index).padStart(2, "0")}`,
  ts: index,
  type: "msg",
  user: "Archived synthetic operator",
  text: `Archived message ${index}`,
});
const currentMessage = (id, index) => ({
  uid: `${id}-current-${String(index).padStart(2, "0")}`,
  ts: index,
  type: "msg",
  user: "Current synthetic operator",
  text: `Current message ${index}`,
});

function archiveRow(source, rowKey, row, archivedAt = "2026-10-12T00:00:00Z") {
  return `insert into fs_archive(source,row_key,data,archived_at) values (${textLiteral(source)},${textLiteral(rowKey)},${literal(row)},'${archivedAt}'::timestamptz);`;
}

function archiveFixture({ a03119Messages = 18, currentA02588Children = true } = {}) {
  const statements = [];

  // A03119 has no current parent/chat/messages, but has retained operational
  // history that must survive the bounded transaction.
  sql(`insert into fs_activities(uid,ts,data) values
    ('A03119-activity-1',101,${literal({ job: "A03119", event: "retained-activity-1" })}),
    ('A03119-activity-2',102,${literal({ job: "A03119", event: "retained-activity-2" })});
    insert into fs_approvals(job_id,part,data,updated_at)
    values ('A03119','sales',${literal({ status: "retained" })},'2026-10-11T10:00:00Z');`);

  statements.push(archiveRow("fs_records", "A03119", {
    id: "A03119", data: parent("A03119"), updated_at: "2026-10-10T15:52:22Z",
  }));
  statements.push(archiveRow("fs_chats", "A03119", {
    job_id: "A03119", data: archivedChat("A03119"), updated_at: "2026-10-10T15:52:23Z",
  }));
  for (let index = 1; index <= a03119Messages; index += 1) {
    const item = archivedMessage("A03119", index);
    // Production fs_keep_deleted chooses job_id before uid, so every message
    // row for this job intentionally has row_key=A03119.
    statements.push(archiveRow("fs_messages", "A03119", {
      uid: item.uid, job_id: "A03119", ts: item.ts, data: item,
      updated_at: "2026-10-10T15:52:23Z",
    }));
  }

  // A02588 has an existing current child set whose values intentionally differ
  // from the archive. Recovery is parent-only and must not compare them.
  sql(`insert into fs_records(id,data,updated_at) values ('A02588',${literal(parent("A02588"))},'2026-10-11T09:00:00Z');
    insert into fs_activities(uid,ts,data) values
      ('A02588-activity-1',201,${literal({ job: "A02588", event: "retained-activity-1" })}),
      ('A02588-activity-2',202,${literal({ job: "A02588", event: "retained-activity-2" })});
    insert into fs_approvals(job_id,part,data,updated_at)
      values ('A02588','pd',${literal({ status: "retained" })},'2026-10-11T11:00:00Z');`);
  if (currentA02588Children) {
    sql(`insert into fs_chats(job_id,data,updated_at) values ('A02588',${literal(currentChat("A02588"))},'2026-10-11T09:01:00Z');`);
    for (let index = 1; index <= 12; index += 1) {
      const item = currentMessage("A02588", index);
      sql(`insert into fs_messages(uid,job_id,ts,data,updated_at) values (${textLiteral(item.uid)},'A02588',${item.ts},${literal(item)},'2026-10-11T09:01:00Z');`);
    }
  }
  sql("delete from fs_records where id='A02588';");

  // The parent archive for A02588 came from the normal delete trigger. Its
  // archive children use the same production-shaped message row_key.
  statements.push(archiveRow("fs_chats", "A02588", {
    job_id: "A02588", data: archivedChat("A02588"), updated_at: "2026-10-10T15:52:23Z",
  }));
  for (let index = 1; index <= 12; index += 1) {
    const item = archivedMessage("A02588", index);
    statements.push(archiveRow("fs_messages", "A02588", {
      uid: item.uid, job_id: "A02588", ts: item.ts, data: item,
      updated_at: "2026-10-10T15:52:23Z",
    }));
  }
  sql(statements.join("\n"));
}

function restore() {
  return JSON.parse(sql("set formula.archived_job_recovery='fs_archive:v2'; select public.fs_restore_archived_jobs();"));
}

before(() => {
  mkdirSync(socket, { recursive: true });
  run("initdb", ["-D", join(scratch, "data"), "-A", "trust", "-U", username, "--no-locale"]);
  const start = execute("pg_ctl", ["-D", join(scratch, "data"), "-l", join(scratch, "postgres.log"), "-o", `-F -p ${port} -k ${socket} -c listen_addresses=''`, "-w", "start"]);
  assert.equal(start.status, 0, `${start.stderr}\n${readFileSync(join(scratch, "postgres.log"), "utf8")}`);
  started = true;
  sql("create role anon; create role authenticated; create role operator_like superuser login;");
  for (const file of [
    "docs/upstream-schema.sql",
    "runtime/data-grants.sql",
    "runtime/data-policy.sql",
    "runtime/job-sync.sql",
    "runtime/archived-job-recovery.sql",
  ]) sql(readFileSync(join(root, file), "utf8"));
});

after(() => {
  if (started) run("pg_ctl", ["-D", join(scratch, "data"), "-m", "fast", "-w", "stop"]);
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => sql("truncate fs_records, fs_chats, fs_messages, fs_approvals, fs_archive, fs_activities;"));

test("production-shaped report uses one SHA-256 recipe and no payload", () => {
  archiveFixture({ currentA02588Children: false });
  const plan = JSON.parse(sql("select public.fs_archived_job_recovery_plan();"));
  assert.equal(plan.role, "postgres");
  assert.equal(plan.archiveRowKeyShape, "fs_messages.row_key=job_id; match embedded uid+job_id+ts+data");
  assert.equal(plan.integrity.algorithm, "SHA-256");
  const reportText = sql("select public.fs_archived_job_recovery_report();");
  const report = JSON.parse(reportText);
  assert.equal(report.recipe.algorithm, "SHA-256");
  assert.deepEqual(report.recipe.fields.message, ["uid", "job_id", "ts", "data", "updated_at"]);
  assert.deepEqual(report.recipe.fields.archive, ["id", "source", "row_key", "archived_at", "data"]);
  assert.deepEqual(report.recipe.setOrdering.message, ["uid", "ts"]);
  assert.match(report.targets.A03119.archiveMessageSetSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.targets.A02588.scope.includes("not compared"), true);
  assert.equal(reportText.includes("Archived message"), false);
  assert.equal(sql("select has_function_privilege('anon','public.fs_restore_archived_jobs()','execute');"), "f");
  assert.equal(sql("select has_function_privilege('authenticated','public.fs_archived_job_recovery_report()','execute');"), "f");
});

test("reapplying the migration preserves the operator fence and browser grants", () => {
  sql(readFileSync(join(root, "runtime/archived-job-recovery.sql"), "utf8"));
  assert.equal(sql("select has_function_privilege('public','public.fs_restore_archived_jobs()','execute');"), "f");
  assert.equal(sql("select has_function_privilege('anon','public.fs_archived_job_recovery_report()','execute');"), "f");
  assert.equal(sql("select prosecdef from pg_proc where oid='public.fs_restore_archived_jobs()'::regprocedure;"), "t");
  assert.equal(sql("select proconfig from pg_proc where oid='public.fs_record_recreation_fence()'::regprocedure;"), '{"search_path=pg_catalog, public, pg_temp"}');
  assert.equal(sql("select tgtype from pg_trigger where tgname='fs_records_recreation_fence' and tgrelid='public.fs_records'::regclass and not tgisinternal;"), "5");
  assert.equal(readFileSync(join(root, "runtime/archived-job-recovery.sql"), "utf8").includes("session_user = 'postgres'"), true);
});

test("one bounded transaction restores A03119 and only the A02588 parent", () => {
  archiveFixture();
  const beforeA02588 = sql("select public.fs_recovery_current_snapshot('A02588');");
  const beforeA03119History = sql("select jsonb_build_object('activities',(select jsonb_agg(data order by uid) from fs_activities where data->>'job'='A03119'),'approvals',(select jsonb_agg(data order by part) from fs_approvals where job_id='A03119')); ");
  const result = restore();
  assert.equal(result.status, "recovered_in_transaction");
  assert.equal(result.targets.A02588.currentSnapshotUnchanged, true);
  assert.equal(result.archivePreserved, true);
  assert.match(result.archiveSignatureSetSha256Before, /^[0-9a-f]{64}$/);
  assert.equal(result.archiveSignatureSetSha256Before, result.archiveSignatureSetSha256After);
  assert.equal(sql("select count(*) from fs_records where id in ('A03119','A02588');"), "2");
  assert.equal(sql("select count(*) from fs_chats where job_id='A03119';"), "1");
  assert.equal(sql("select count(*) from fs_messages where job_id='A03119';"), "18");
  assert.equal(sql("select count(*) from fs_chats where job_id='A02588';"), "1");
  assert.equal(sql("select count(*) from fs_messages where job_id='A02588';"), "12");
  assert.equal(sql("select count(*) from fs_chats c left join fs_records r on r.id=c.job_id where c.job_id in ('A03119','A02588') and r.id is null;"), "0");
  assert.equal(sql("select count(*) from fs_messages m left join fs_records r on r.id=m.job_id where m.job_id in ('A03119','A02588') and r.id is null;"), "0");
  assert.equal(sql("select jsonb_agg(uid order by uid,ts) from fs_messages where job_id='A03119';"), sql("select public.fs_recovery_archive_message_uid_set('A03119');"));
  assert.equal(sql("select public.fs_recovery_current_snapshot('A02588');"), beforeA02588);
  assert.equal(sql("select jsonb_build_object('activities',(select jsonb_agg(data order by uid) from fs_activities where data->>'job'='A03119'),'approvals',(select jsonb_agg(data order by part) from fs_approvals where job_id='A03119')); "), beforeA03119History);
  assert.equal(sql("select count(*) from fs_archive where source='fs_messages' and row_key='A03119';"), "18");
});

test("duplicate embedded uid is ambiguous and rolls back before writes", () => {
  archiveFixture();
  sql(`insert into fs_archive(source,row_key,data,archived_at)
    select source,row_key,data,archived_at from fs_archive
    where source='fs_messages' and row_key='A03119' limit 1;`);
  const result = execute("psql", sqlArgs(), "set formula.archived_job_recovery='fs_archive:v2'; select public.fs_restore_archived_jobs();");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ARCHIVE_MESSAGE_(UID_AMBIGUOUS|COUNT_MISMATCH)/);
  assert.equal(sql("select count(*) from fs_records where id in ('A03119','A02588');"), "0");
});

test("duplicate parent or invalid parent payload is rejected before any write", () => {
  archiveFixture();
  sql(`insert into fs_archive(source,row_key,data,archived_at)
    select source,row_key,data,archived_at from fs_archive
    where source='fs_records' and row_key='A03119';`);
  const duplicate = execute("psql", sqlArgs(), "select public.fs_archived_job_recovery_report();");
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /ARCHIVE_PARENT_COUNT_INVALID/);
  sql("delete from fs_archive where id=(select max(id) from fs_archive where source='fs_records' and row_key='A03119');");
  sql("update fs_archive set data=jsonb_set(data,'{data,rows}','null'::jsonb) where source='fs_records' and row_key='A03119';");
  const invalid = execute("psql", sqlArgs(), "select public.fs_archived_job_recovery_report();");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /ARCHIVE_PARENT_DATA_INVALID/);
  assert.equal(sql("select count(*) from fs_records where id in ('A03119','A02588');"), "0");
});

test("missing or invalid archive timestamps fail closed without now fallback", () => {
  archiveFixture();
  sql("update fs_archive set data=data-'updated_at' where source='fs_records' and row_key='A03119';");
  const missing = execute("psql", sqlArgs(), "select public.fs_archived_job_recovery_report();");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ARCHIVE_TIMESTAMP_INVALID/);
  assert.equal(sql("select count(*) from fs_records where id in ('A03119','A02588');"), "0");
  const source = readFileSync(join(root, "runtime/archived-job-recovery.sql"), "utf8");
  assert.doesNotMatch(source, /updated_at[^;]{0,300}coalesce[^;]{0,100}now\(\)/is);
});

test("non-postgres session cannot bypass the fence by setting the recovery GUC", () => {
  archiveFixture({ currentA02588Children: false });
  const call = execute("psql", sqlArgs("operator_like"), "select public.fs_restore_archived_jobs();");
  assert.notEqual(call.status, 0);
  assert.match(call.stderr, /permission denied|does not exist|RECOVERY_OPERATOR_ROLE_REQUIRED/i);
  const insert = execute("psql", sqlArgs("operator_like"), `set formula.archived_job_recovery='fs_archive:v2'; insert into fs_records(id,data) values ('A03119',${literal(parent("A03119"))});`);
  assert.notEqual(insert.status, 0);
  assert.match(insert.stderr, /JOB_ID_DELETED/);
  assert.equal(sql("select count(*) from fs_records where id='A03119';"), "0");
});

test("advisory lock timeout rolls back without partial recovery", async () => {
  archiveFixture();
  const hold = spawn("psql", sqlArgs());
  let holdError = "";
  hold.stderr.on("data", chunk => { holdError += chunk.toString(); });
  hold.stdout.resume();
  const finished = new Promise(resolve => hold.on("close", resolve));
  hold.stdin.end("begin; select pg_advisory_xact_lock(hashtextextended('archived-job-recovery:A03119,A02588',0)); select pg_sleep(4); rollback;");
  await new Promise(resolve => setTimeout(resolve, 300));
  const blocked = execute("psql", sqlArgs(), "set formula.archived_job_recovery='fs_archive:v2'; select public.fs_restore_archived_jobs();");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /lock timeout|canceling statement/i);
  await finished;
  assert.equal(holdError, "");
  assert.equal(sql("select count(*) from fs_records where id in ('A03119','A02588');"), "0");
});

test("wrapper fails closed unless release evidence and immutable commit gates are explicit", () => {
  const wrapper = join(root, "scripts/recover-archived-jobs.sh");
  const noArgs = execute("sh", [wrapper], "");
  assert.notEqual(noArgs.status, 0);
  assert.match(noArgs.stderr, /mode is required/i);
  const badCommit = execute("sh", [wrapper, "--dry-run", "--immutable-commit", "deadbeef", "--release-evidence", "/tmp/missing-release", "--lock-evidence", "/tmp/missing-lock"], "");
  assert.notEqual(badCommit.status, 0);
  assert.match(badCommit.stderr, /immutable commit/i);
  const source = readFileSync(wrapper, "utf8");
  assert.match(source, /backup/i);
  assert.match(source, /SHA256SUMS/);
  assert.match(source, /verify-restore-formula/);
});

test("wrapper verifies every executable helper byte and rejects dirty substitution", () => {
  const { repo, commit } = syntheticChainRepo();
  const releaseEvidence = join(repo, "release-evidence.txt");
  const lockEvidence = join(repo, "lock-evidence.txt");
  const fakeBin = join(repo, "fake-bin");
  mkdirSync(fakeBin);
  const fakePsql = join(fakeBin, "psql");
  writeFileSync(fakePsql, "#!/bin/sh\nprintf '%s\\n' '{\"synthetic\":true}'\n");
  chmodSync(fakePsql, 0o755);
  writeFileSync(releaseEvidence, `immutable_commit=${commit}\n`);
  writeFileSync(lockEvidence, "lock=clear\n");
  const wrapper = join(repo, "scripts/recover-archived-jobs.sh");
  const args = ["--dry-run", "--immutable-commit", commit, "--release-evidence", releaseEvidence, "--lock-evidence", lockEvidence];
  const valid = execute("sh", [wrapper, ...args], "", { cwd: repo, env: { PATH: `${fakeBin}:${process.env.PATH}`, PSQL_SERVICE: "synthetic" } });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /recovery status=dry-run/);

  writeFileSync(join(repo, "scripts/verify-restore-formula.sh"), `${readFileSync(join(repo, "scripts/verify-restore-formula.sh"), "utf8")}\n# dirty helper\n`);
  const dirty = execute("sh", [wrapper, ...args], "", { cwd: repo, env: { PATH: `${fakeBin}:${process.env.PATH}`, PSQL_SERVICE: "synthetic" } });
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /working tree is dirty|bytes differ/i);
  rmSync(repo, { recursive: true, force: true });
});

test("backup evidence helper rejects stale or unbound recovery backups", () => {
  const helper = join(root, "scripts/validate-recovery-backup.mjs");
  const backup = mkdtempSync("/tmp/formula-recovery-backup-meta-");
  const plan = "A03119,A02588";
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const writeMeta = createdAt => writeFileSync(join(backup, "backup-meta.json"), JSON.stringify({
    format: 2, createdAt, approvedPlan: plan, immutableCommit: commit,
  }));
  writeMeta(new Date().toISOString());
  assert.equal(execute("node", [helper, backup, plan, commit], "").status, 0);
  writeMeta(new Date(Date.now() - 16 * 60 * 1000).toISOString());
  assert.notEqual(execute("node", [helper, backup, plan, commit], "").status, 0);
  writeMeta(new Date().toISOString());
  assert.notEqual(execute("node", [helper, backup, plan, "fedcba9876543210fedcba9876543210fedcba98"], "").status, 0);
  rmSync(backup, { recursive: true, force: true });
});

test("a second execution cannot overwrite recovered records", () => {
  archiveFixture();
  assert.equal(restore().status, "recovered_in_transaction");
  const retry = execute("psql", sqlArgs(), "set formula.archived_job_recovery='fs_archive:v2'; select public.fs_restore_archived_jobs();");
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /A03119_CURRENT_PARENT_OR_CHILD_EXISTS|JOB_ID_DELETED|duplicate key|JOB_ID/i);
  assert.equal(sql("select count(*) from fs_records where id in ('A03119','A02588');"), "2");
  assert.equal(sql("select count(*) from fs_messages where job_id='A03119';"), "18");
});
