#!/usr/bin/env node
/* Validate only sanitized backup metadata for archived-job recovery. */
import { readFileSync } from "node:fs";

const [backupDir, expectedPlan, expectedCommit] = process.argv.slice(2);
const fail = () => {
  console.error("recovery backup status=blocked");
  process.exit(1);
};

if (!backupDir || !expectedPlan || !expectedCommit) fail();

let metadata;
try {
  metadata = JSON.parse(readFileSync(`${backupDir}/backup-meta.json`, "utf8"));
} catch {
  fail();
}

if (metadata.approvedPlan !== expectedPlan || metadata.immutableCommit !== expectedCommit) fail();

const createdAt = Date.parse(metadata.createdAt || "");
if (!Number.isFinite(createdAt)) fail();

const ageSeconds = (Date.now() - createdAt) / 1000;
if (ageSeconds < 0 || ageSeconds > 15 * 60) fail();

console.log("recovery backup status=verified");
