# PK workflow trial — synthetic prototype

Status: PASS for the local workflow model only. 14 automated tests passed. This is not a PU-PK integration test, source-formula verification, UAT, or production release. The existing audit remains FAIL.

User authorized trying: negotiate in PU-PK → confirm selected result → calculator adopts a version, while formula/RM work independently. The local prototype consumes invented upstream amounts; it does not calculate PK pricing or reproduce the PU-PK engine.

## Executed walkthrough

All identifiers and figures below are synthetic. Quantity: 1,000 selling units. RM adjusted lot amount: THB 2,000; Operation adjusted lot amount: THB 1,000. These are supplied test outputs, not approved rates or policy defaults.

| Step | PK state | Adopted PK | Calculator result |
|---|---|---|---|
| 1 | No result | None | Known portion THB 3,000; incomplete, not a total unit price |
| 2 | V1 negotiation draft | None | Known portion remains THB 3,000; pending confirmation |
| 3 | V1 confirmed and explicitly adopted | V1: THB 3,000 | Demo adjusted lot total THB 6,000 / THB 6 per selling unit |
| 4 | Negotiate V2 at THB 2,800 | Still V1 | Existing scenario remains THB 6,000; new negotiation does not replace it |
| 5 | V2 confirmed and explicitly adopted | V2: THB 2,800 | New scenario revision totals THB 5,800 / THB 5.80 per selling unit; frozen V1 result remains THB 6,000 |

The frozen result simulates snapshot persistence; no CEO approval was performed and no quotation was sent.

## Automated evidence

Command from project directory:

```sh
python3 -m unittest discover -s local-only/pk-workflow-trial -p test_trial.py -v
```

14 passing tests cover:

1. RM can advance with missing PK; missing amount is not zero.
2. An unconfirmed draft cannot be adopted as confirmed.
3. Synthetic confirmation requires the PU-PK actor and evidence.
4. Confirmation records actor/date and adoption produces the hand-calculated total.
5. New negotiation leaves the adopted version intact.
6. Explicit new-version adoption preserves the frozen old result.
7. Duplicate delivery does not create another revision.
8. Changed content under the same immutable version ID is rejected.
9. Changed spec, quantity or pack rejects late results; RM remains editable.
10. Results belonging to another project are rejected.
11. RM-only changes reuse the unchanged PK result.
12. Expiry/withdrawal blocks new use without rewriting the frozen result.
13. Missing adjusted price never falls back to the raw amount in the summary.
14. Disconnection retains prior evidence and permits RM work without claiming current readiness.

The first RM-progress test was observed failing against the initial empty implementation; the completed model passes the suite. Logs, model, tests and executed trace are local-only under local-only/pk-workflow-trial. Parent index.html and supabase/schema.sql hashes matched before/after. Git ignore was verified for the trial model/tests/trace.

## Limits and next integration evidence

- Proposed internal test types are not the live Sheet schema or a validated adapter.
- No live formulas, commercial records, source state transitions, permissions, scheduling, actual chat sends or email sends were exercised.
- Actor strings are synthetic inputs, not real authentication. The summary allowlist does not establish production access-control security.
- The model covers one PK result, not every packaging component, currency conversion, MOQ/loss/markup computation, multi-user race, all cost gates or real CEO approval.
- `complete` in the model means its three adjusted amounts and PK eligibility are present. It does not mean the real quotation is ready.
- Before live integration: inspect approved/sanitized PU-PK code/formulas and status semantics, map request/quote/snapshot IDs to Formula project/requirement version, and test the adapter in an authorized non-production environment. No source state is accepted as approved merely because its header says Status or ApprovedToSend.

## Delivery record

- task_id: cost-calculator-workspace-handoff-2026-09-05 (existing local label)
- issue_id / pr_reference: none
- files_changed: SPEC.md, REGISTRY.md, TASK.md, this report; new local-only/pk-workflow-trial artifacts
- tests_run: 14 local prototype contract tests; parent source hash comparison; Git ignore checks
- test_result: PASS_LOCAL_PROTOTYPE_ONLY; LIVE_INTEGRATION_NOT_TESTED
- security/database/permission/dependency impact: no runtime changes, network writes or new dependencies
- rollback: remove only new trial artifacts/report and reverse this turn's document edits
- open_risks: original audit FAIL; actual PK formulas/status semantics and integration unverified
