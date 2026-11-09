# Cost calculator by project

พื้นที่ทำงานใหม่ตามคำสั่งผู้ใช้ 2026-09-05 สำหรับ OEM supplement; อ่าน AGENTS.md → SPEC.md → TASK.md ก่อนเริ่มงาน

## เริ่มงานต่อ

- SPEC.md: workflow และขอบเขตล่าสุดที่ผู้ใช้ยืนยัน
- TASK.md: งานต่อไปและเกณฑ์ตรวจ ไม่ใช่รายการที่ทำเสร็จแล้ว
- REGISTRY.md: ownership และจุดเชื่อมระบบ
- local-only/CONTEXT_HANDOFF.md: บริบทการสนทนาและแหล่งอ้างอิง (local-only)
- local-only/legacy-workspace/: สำเนา workspace เดิมครบ รวมโค้ด รายงาน audit เอกสาร และ artifacts; เป็นหลักฐานย้อนหลัง ไม่ใช่ข้อกำหนดปัจจุบันหรือระบบที่ deploy แล้ว

เอกสารปัจจุบันมีลำดับเหนือเอกสาร legacy หากขัดกัน โดยเฉพาะ CEO approval, one selected Tier, Procurement confirmation และ Operation DL+OH.

การส่งมอบครั้งนี้เป็นการจัดพื้นที่/เอกสารเท่านั้น ไม่แก้ application, Sheets, sync, database หรือ deployment. ไม่ได้ย้าย Codex thread/sidebar โดยอัตโนมัติ ผู้ใช้จะย้าย section เอง.

ห้าม commit/push local-only แม้ใช้ force add. Gitignore ไม่ใช่ระบบควบคุมการเข้าถึง; ต้องเก็บในเครื่องที่ได้รับอนุญาต. ไม่คัดลอกข้อมูลอ่อนไหวจากหลักฐานไป PR/log.

