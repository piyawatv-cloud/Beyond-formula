# Cost Calculator — UAT and release worksheet

Status: PREPARED, NOT EXECUTED. No business acceptance is inferred from synthetic tests. P24–P26 remain human/operator gates.

Before UAT: approve the version/access contract; implement trusted persistence and project-scoped reads/writes; close legacy Formula disclosure routes; verify physical RM/PK mapping in a non-production environment; provide versioned STD/loss/pricing/rounding values. Use sanitized projects and test recipients. No actual external messages during automated tests.

| Case | Business owner | Expected observation | Actual / accepted by / date |
| --- | --- | --- | --- |
| Similar RM names, different specs/Tiers | RD + Procurement RM | Correct item selected from one comparative list; price/MOQ inseparable | Not executed |
| Missing material | RD + Procurement RM | Sourcing request; pending RD spec and commercial confirmation; original RM unchanged | Not executed |
| RM-only with PK absent/offline | RD | Save/edit/compare RM without PK; partial amount clearly not total | Not executed |
| PK negotiation and selected version | PU-PK + RD | Multiple revisions preserved; explicit adoption; changed spec/quantity invalidates reuse | Not executed |
| Loss and operation | RD + Production + Finance | Unit/batch/run/setup and ownership reconcile; no double loss/STD | Not executed |
| MOQ exposure | Procurement + CEO | Used cost, estimated cash and residual exposure separate; no assumed resale | Not executed |
| Permission matrix | RD/PU-PK/Sales/OPC/Finance/CEO | Real request payloads/exports/chat/history contain only permitted fields | Not executed |
| Partial chat + retry | RD + Sales | Correct project/revision/link, safe aliases, pending/sent truthful, no duplicate | Not executed |
| CEO approval and changed terms | CEO + Procurement | Exact eligible revision only; approved snapshot unchanged; new revision requires approval | Not executed |
| Old client/data compatibility | Owner + QA | Existing keys/types load; redacted client writes never erase full source data | Not executed |

Release evidence required: real Issue/PR, immutable commit, independent CODEOWNER/security review, checks, completed UAT, approved migration/cache transition, operator deployment record and rollback rehearsal. Author cannot final-approve.

Rollback: local changes can be reverted by feature commit. For a future live rollout, disable calculator gateway and use a reviewed compatible prior artifact; retain snapshots/outbox/audit records. Never restore broad data grants merely to make an old client work. No runtime rollback script is certified by this worksheet.

Stop/revert criteria: unauthorized raw payload, incorrect units/pricing/selected snapshot, corrupted revisions, duplicate sends, or incompatible record writes. Post-live checks must include user workflow and permission evidence in addition to service health. Deployer/time/release/health/rollback target: pending authorized Runtime Operator.
