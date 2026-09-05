# Cost calculator by project

พื้นที่ทำงานใหม่ตามคำสั่งผู้ใช้ 2026-09-05 สำหรับ OEM supplement; อ่าน AGENTS.md → SPEC.md → TASK.md ก่อนเริ่มงาน

## เริ่มงานต่อ

- SPEC.md: workflow และขอบเขตล่าสุดที่ผู้ใช้ยืนยัน
- TASK.md และ docs/IMPLEMENTATION_EXECUTION.md: สถานะปัจจุบัน ผลทดสอบ และงานที่ยังค้าง
- REGISTRY.md: ownership และจุดเชื่อมระบบ
- local-only/CONTEXT_HANDOFF.md: บริบทการสนทนาและแหล่งอ้างอิง (local-only)
- local-only/legacy-workspace/: สำเนา workspace เดิมครบ รวมโค้ด รายงาน audit เอกสาร และ artifacts; เป็นหลักฐานย้อนหลัง ไม่ใช่ข้อกำหนดปัจจุบันหรือระบบที่ deploy แล้ว

เอกสารปัจจุบันมีลำดับเหนือเอกสาร legacy หากขัดกัน โดยเฉพาะ CEO approval, one selected Tier, Procurement confirmation และ Operation DL+OH.

สถานะล่าสุด: ผู้ใช้ยกเลิก Notion และอนุญาต local implementation ครบแผน 27 งาน. Worktree นี้มีโค้ด calculator ใน index.html ของ parent และโมดูล/tests ในโครงการนี้แล้ว; gateway ยังปิดจน trusted backend และ integration ผ่านการตรวจ. ดูผลจริงใน TASK.md; ยังไม่ครบ UAT/release/deployment. หลักฐาน local-only เดิมคงอยู่ใน original workspace ไม่ได้คัดลอกเข้า worktree นี้.

ห้าม commit/push local-only แม้ใช้ force add. Gitignore ไม่ใช่ระบบควบคุมการเข้าถึง; ต้องเก็บในเครื่องที่ได้รับอนุญาต. ไม่คัดลอกข้อมูลอ่อนไหวจากหลักฐานไป PR/log.
