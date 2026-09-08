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
