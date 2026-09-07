# Calculator design contract

> Historical contract: server-gateway and memory-only descriptions below are superseded by IMPLEMENTATION_REPORT_2026-09-08.md. Current proposed selection UX: [RD material selection design](docs/design/RD_MATERIAL_SELECTION_DESIGN.md) and [interactive synthetic prototype](docs/design/RD_MATERIAL_SELECTION_PROTOTYPE.html). Proposal only; application behavior has not changed.

Local implementation; live gateway disabled. Reuse Formula Studio `sec-card`, form controls, table and navigation. No new frontend dependency or build step.

Primary job: RD chooses the correct governed RM among similar names, compares spec/Tier/MOQ/LT, edits a formula revision, and continues while PK is pending. Project identity belongs to Formula. PK selection/negotiation belongs to PU-PK.

The page shows project/revision, permitted category summaries, explicit missing-data status, quantity/pack inputs, RM lines, searchable comparative catalog, sourcing request, PK candidate adoption and project-chat summary receipt. Safe aliases belong to the revision. Blank loss/amount stays blank; no financial default is inserted.

All strings are escaped. Data is memory-only. Search preserves unsaved inputs; structural actions require those inputs to be saved, then discard obsolete line-index buffers. Concurrent responses must match session, project, scenario and revision. Role/session changes clear the panel. Backend must authorize and project data before transmission; these UI controls are not that security boundary.

Responsive layout: three summary/input columns become one below 800px; RM comparison remains horizontally scrollable. Keyboard-accessible labels and polite operation status are retained. Native Formula styles take precedence over a new design language.

States to verify: unavailable gateway, loading, empty catalog, similar-spec matches, pending PK, stale response, failure retaining draft, unconfirmed price, permitted RD view, restricted Sales view, pending receipt. Synthetic browser fixture exercises the actual renderer, not a parallel mock screen.

Workflow fit: conditional GAS integration; no additional AppSheet or Google Chat surface in this scope. Why: Formula already owns the user's project chat and formula UI; PU-PK already owns negotiation. Boundary: Formula UI/project/chat, governed working Data Center, PU-PK pricing, trusted transactional authorization and projections, GAS transformation/orchestration. A new AppSheet/Chat interface would duplicate the requested entry point. AI is not part of deterministic costing or approval authority.
