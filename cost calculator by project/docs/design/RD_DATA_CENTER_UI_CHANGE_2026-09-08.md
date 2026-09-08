# RD Data Center — navigation and filter-view change

Task: cost-calculator-implementation-2026-09-05; issue/PR: none. Owner explicitly requested RD Data Center first. Scope is reversible document navigation, saved filter views and explanatory notes only. No application script, data schema, formula, price, confirmation, raw data, sharing or production runtime deployment change.

## Concrete change

- 00_README A3:B3, A6:B6, A10:B11: clarify roles, current calculator workflow and reference-price limits. Preserve source reference and existing data/inventory rules.
- Previously empty A14:B25: add 8 role-based links and 4 short usage explanations. Link to existing tabs; no new master/sheet.
- 01_Ingredients_Master header notes for Inventory Status, Mapped Price and Price Status; no header renaming.
- 08_Price_Catalog header notes for raw Tier and Max price; no header renaming.
- Add four filter views: all named RD records; READY reference-price records; non-READY named records; price/MOQ evidence records. Existing basic filter, physical row order and values remain unchanged. A READY filter is explicitly not quotation eligibility.
- Do not combine the tables through a guessed join. A unified spec/Tier/MOQ/LT view still needs verified identity/projection mapping.

## Backup and rollback

Original affected cells, notes and formatting captured before writing in ignored local-only/RD_UI_BEFORE_2026-09-08.json; exact batch in local-only/RD_UI_REQUESTS_2026-09-08.json. URLs remain local-only. Restore only changed README cells/formatting and header notes; delete only the four filterView IDs created by this batch. Preserve any subsequent user edits; compare current values with this batch before rollback. No rollback of business rows is required.

## Verification plan

Bounded readback compares requested text/links/notes and original business headers. Inspect README visually and verify filter views are accessible. The API request changes only the declared fields; full business-data equality is not claimed because no complete business-data export is read. No application tests necessary for document-only changes.

Status: PREPARED, not applied at this commit. Critical runtime change: no. security/permission/database/dependency impact: none. open_risks: navigation is only the first usability improvement; unified selection/mapping and fresh-data transport are not implemented here. User UAT remains outstanding.

## Applied and verified

Status: APPLIED_UI_VERIFIED / HUMAN_GATE (user workflow acceptance). Source workbook updated through Sheets API under the owner's explicit RD Data Center edit request. Preparatory Git commit: ea87181.

- First batch validation rejected unsupported TEXT_NOT_EQ in a saved filter. No partial write was reported. Replaced it with hiddenValues ['READY'] plus nonblank RD-Code; the complete corrected batch succeeded.
- All four filter views were returned with the expected ranges and criteria.
- Readback: 37/37 requested text/note checks matched; eight navigation links present; original headers in 01/08/10 unchanged.
- Visual check: README navigation is readable within the existing two-column layout. Browser opened the reference-price filter successfully and displayed 23 rows. This is a filtered reference-price count, not 23 quotation-ready offers.
- Follow-up: updated README A1 title to “RD Data Center — ค้นวัสดุและตรวจข้อมูล RM”; first two links now open the exact saved filter views directly. Readback confirmed title and both links. Exact follow-up batch recorded in ignored local-only/RD_UI_FOLLOWUP_2026-09-08.json. Original A1 is already in the before snapshot for rollback.
- No header renaming, physical row sorting, formula/data/confirmation edits, new master sheets, role changes, PU-PK edits, Apps Script execution or application deployment.

Remaining scope: unified spec/Tier/MOQ/LT selection requires verified source identity/projection mapping; direct refresh versus versioned-file transport remains undecided. These navigation changes do not implement the connection or prove faster RD UAT performance.

files_changed: this report (tracked); before/request/follow-up evidence files (ignored local-only). tests_run: bounded API readback, browser visual/filter check, git diff --check. security/permission/database/dependency impact: none. rollback: restore only these document cells/notes and remove the four created filter views after checking for subsequent user changes. pr_reference: none.
