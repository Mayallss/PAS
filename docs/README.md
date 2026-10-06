# PAS Enterprise Internal Management Platform — Documentation

สถานะ: **Milestone 1 — Legacy System Discovery (ร่างแรก, 2026-09-27)**
ยังไม่เริ่ม Implement ระบบใหม่ ตามกฎข้อ 1–2 ของ Master Prompt (สำรวจก่อน, ไม่คาดเดา Business Rules)

## แหล่งข้อมูลที่ใช้สำรวจ

| แหล่ง | ตำแหน่ง | หมายเหตุ |
|---|---|---|
| Source code ระบบเดิม (PHP) | `../domains/pas-acc.com/public_html/report/` | Time Report ตัวจริงที่ใช้งาน |
| สำเนาทดสอบ | `../domains/pas-acc.com/public_html/report-TEST/` | **ชี้ไป Production DB เดียวกัน** |
| Link Portal เดิม | `../domains/pas-acc.com/public_html/link/` | ต้นแบบของ Homepage |
| n8n read-only API | `../domains/pas-acc.com/public_html/pas-report-api.php` | สร้างล่าสุด (ก.ย. 2026) |
| Database dump (MySQL) | `../backup/pasacccom_report.sql` | Snapshot ข้อมูลจริง |
| Access logs ส.ค.–ก.ย. 2026 | `../domains/pas-acc.com/logs/` | ใช้วิเคราะห์การใช้งานจริง |

การสำรวจเป็นแบบ **อ่านอย่างเดียว (offline)** จากไฟล์ Backup ไม่มีการเชื่อมต่อหรือทดสอบกับ Production
ข้อมูลส่วนบุคคลถูกวิเคราะห์เฉพาะในรูปสถิติรวม ไม่มีการคัดลอกชื่อ/รหัสผ่าน/ข้อมูลลูกค้าลงในเอกสาร

## เอกสาร

| # | เอกสาร | เนื้อหา |
|---|---|---|
| 00 | [URGENT — Security Findings](00-urgent-security-findings.md) | ช่องโหว่ร้ายแรงในระบบที่ใช้งานอยู่ตอนนี้ **อ่านก่อน** |
| 01 | [Existing System Analysis](01-existing-system-analysis.md) | Technical architecture, schema, data quality, usage, role matrix |
| 02 | [Functional Specification (As-Is)](02-functional-specification.md) | พฤติกรรมที่ยืนยันจาก Code/Data จริง + Workflow diagram |
| 03 | [Gap Analysis & Feature Inventory](03-gap-analysis.md) | Keep / Improve / Replace / Deprecate / New |
| 04 | [Migration Strategy](04-migration-strategy.md) | Data mapping, data-quality rules, cutover, rollback |
| 05 | [Proposed Architecture](05-proposed-architecture.md) | Target architecture, stack decision, module structure, security |
| 06 | [Open Questions / Decisions](06-open-questions.md) | สิ่งที่ต้องได้รับการยืนยันจากฝ่ายบริหารก่อน Milestone 2 |
| 07 | [IT Asset & Employee Onboarding](07-it-asset-onboarding-design.md) | ทะเบียนอุปกรณ์ + ประวัติ/หลักฐาน, รับ-ออกพนักงาน (ร่างออกแบบ) |
| 08 | [Document Workflow + เอกสาร IT](08-document-workflow-design.md) | แกนเอกสาร/อนุมัติกลาง, ใบขอซื้อ, ตู้รหัสผ่าน, ตรวจ ISO — พร้อมที่มาของทุกกฎ (ร่าง) |

## ป้ายกำกับที่ใช้ในเอกสาร

- **[ยืนยันแล้ว]** — พบจริงใน Source code หรือข้อมูล พร้อมอ้างอิงไฟล์
- **[สังเกตจากข้อมูล]** — รูปแบบที่เห็นในข้อมูล แต่ไม่ได้บังคับใน Code (ต้องยืนยันนโยบาย)
- **[ข้อเสนอ]** — ข้อเสนอสำหรับระบบใหม่ ยังไม่ได้รับอนุมัติ
