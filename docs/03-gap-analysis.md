# 03 — Gap Analysis & Feature Inventory

Keep = ใช้พฤติกรรมเดิม · Improve = ปรับปรุง · Replace = พัฒนาใหม่ทดแทน · Deprecate = เลิกใช้ (เมื่ออนุมัติ) · New = ความสามารถใหม่
**New ทุกข้อต้องได้รับการยืนยัน Requirement ก่อน Implement** (ดู 06)

## A. Time Report

| # | Feature | As-Is | การจัดประเภท | To-Be [ข้อเสนอ] |
|---|---|---|---|---|
| T1 | ตารางรายเดือน (ลูกค้า×งาน × วัน) | มี | **Keep** | รูปแบบที่ผู้ใช้คุ้นเคย; เพิ่ม Keyboard navigation, บันทึกแบบ inline ไม่ต้อง Reload |
| T2 | หน่วย 0.5 ชม., สูงสุด 9 ชม./รายการ | Browser เท่านั้น | **Improve** | บังคับที่ Backend; ค่าจาก Policy config ไม่ Hard-code |
| T3 | เป้าหมาย 540 นาที/วัน + สีสถานะรายวัน | มี | **Keep** | ค่าเป้าหมายเก็บใน Config (Work calendar) |
| T4 | ใส่ 0 = ลบ | Hard delete | **Improve** | ปุ่มลบชัดเจน + Soft delete + Audit |
| T5 | ป้องกันรายการซ้ำ | ไม่มี | **Improve** | Unique `(employee, date, customer, activity)` + Idempotency key |
| T6 | ผลรวมรายวันเกิน 9 ชม. | เตือนด้วยสี | **Keep** (เตือน) | บล็อกหรือเตือน? → รอนโยบาย (06-Q2) |
| T7 | บันทึกวันหยุด/เสาร์-อาทิตย์ | ได้ | **Keep** | — |
| T8 | บันทึกย้อนหลัง/ล่วงหน้าไม่จำกัด | ไม่จำกัด | **Improve** | จำกัดตาม Period lock + สิทธิ์ขอแก้ย้อนหลัง (06-Q3) |
| T9 | Submission / Approval | ไม่มี | **New** | Draft → Submitted → Approved/Rejected ผ่าน Workflow engine — **เฉพาะเมื่อยืนยัน** (06-Q1) |
| T10 | Period lock (ปิดงวด) | ไม่มี | **New** | ล็อกหลังวันที่กำหนด/หลัง Approve (06-Q3) |
| T11 | แถวประชุมประจำเดือนแบบพิเศษ | Hard-code id 32 / ลูกค้า 90 | **Improve** | ใช้ "Internal customer" + Activity ปกติ แทน Special case |
| T12 | วันลาเป็น Time entry | มี | **Keep** (Phase 1) | ระบบลา+อนุมัติ+ยอดคงเหลือ = HR module อนาคต |
| T13 | วันหยุดบริษัท | มี, ไม่ตรวจสิทธิ์ | **Improve** | Work calendar + สิทธิ์ + รองรับครึ่งวัน (Schema เดิมรองรับแล้ว) |
| T14 | เวลาเริ่ม-สิ้นสุด | ไม่มี | ไม่ทำ | ระบบเดิมใช้ระยะเวลาเท่านั้น — ไม่เพิ่มจนกว่าจะมี Requirement |
| T15 | Customer × Activity (เปิด/ปิด) | มี | **Keep → Improve** | เป็น "Engagement" (Customer + Service/Activity + ผู้ดูแล + ช่วงเวลา) |
| T16 | ผู้ดูแลลูกค้า (`company_admin`) | มี | **Keep** | ใช้เป็นเกณฑ์ ABAC สำหรับ Manager/Approver ได้ |
| T17 | Master data ลูกค้า / Activity / พนักงาน | Raw SQL จาก Browser | **Replace** | Admin UI + API ที่ตรวจสิทธิ์; เปลี่ยนรหัสลูกค้าไม่ต้องแก้ PK (ใช้ Surrogate key) |
| T18 | รายงานพนักงาน × วัน (`list_report`) | มี | **Keep** | + Filter ตามทีม/ขอบเขตสิทธิ์ |
| T19 | รายงานต้นทุนตามลูกค้า (`report_job`) | สูตรขัดกัน | **Improve** | ใช้สูตรเดียวที่ยืนยันแล้ว (06-Q5); จำกัดสิทธิ์เห็นอัตรา |
| T20 | รายงานการลา | มี | **Keep** | — |
| T21 | Export Excel | เดือนปัจจุบัน, ไม่ตรวจสิทธิ์ | **Improve** | รูปแบบคอลัมน์เดิม + เลือกช่วงวันที่ + สิทธิ์ + Audit การ Export |
| T22 | Export PDF | ไม่มี | **New** | เฉพาะเมื่อมี Requirement |
| T23 | แจ้งเตือนกรอกไม่ครบรายสัปดาห์ | n8n → API | **Improve** | Scheduler ภายใน + Notification Center + ช่องทางภายนอก (ไม่ให้ Time Report พึ่ง n8n) |
| T24 | Manager dashboard / ส่งล่าช้า | ไม่มี | **New** | ตาม Master Prompt §6.4 |
| T25 | Audit history | ไม่มี | **New** (บังคับ) | ตาม Security Requirements §8 |
| T26 | Todo list (`todolist_table`) | ถูกทิ้ง | **Deprecate** | ไม่ย้าย (เก็บ Archive) |

## B. Identity & Security

| # | As-Is | ประเภท | To-Be |
|---|---|---|---|
| S1 | Username/MD5, SQLi, ไม่มี MFA | **Replace** | OIDC SSO + MFA (IdP ต้องยืนยัน — 06-Q7) |
| S2 | Role 5 แบบ (USER/ADMIN/MANAGER/OWNER/IT) สิทธิ์เกือบเท่ากัน | **Improve** | RBAC ใหม่ (Employee / Team Lead / Manager / Partner-Owner / HR-Admin / System Admin) + ABAC ตามทีม/ลูกค้าที่ดูแล — Mapping ต้องยืนยัน (06-Q6) |
| S3 | พนักงานลาออกยัง Login ได้ | **Replace** | Deprovision ผ่าน IdP + ตรวจสถานะพนักงาน |
| S4 | ไม่มี Audit | **New** | Audit trail กลาง |
| S5 | Credential ใน Code | **Replace** | Secret Manager |

## C. Homepage / Portal

| # | As-Is | ประเภท | To-Be |
|---|---|---|---|
| P1 | `link/index.php` ลิงก์รวม (Time Report, monday boards, The Inventory, MS Forms, IT ภายใน) | **Replace** | Application Launcher ตามสิทธิ์; ลิงก์ภายนอกเป็น "External link" ชัดเจน; Module ที่ยังไม่เปิดเป็น Planned |
| P2 | หน้า `report/index.php` การ์ดเดียว | **Replace** | Employee Dashboard |
| P3 | รายงานประชุม + กดรับทราบ (`meet`, `meet_agree`) | **Keep → ย้าย** | "ประกาศ/เอกสารที่ต้องรับทราบ" ใน Homepage (Announcement + Acknowledgement) — ข้อมูลย้อนหลัง 10 ปีย้ายได้ |
| P4 | Notification | ไม่มี | **New** | Notification Center |
| P5 | ข้อมูลพนักงาน/แผนก/ตำแหน่ง | มีแค่ชื่อ, ระดับ, ทีมย่อย | **Improve** | แผนก/ตำแหน่งต้องมีแหล่งข้อมูล (06-Q8) |

## D. ระบบอื่นบน Hosting เดิม (นอกขอบเขต Phase 1)

| ระบบ | ประเภท | หมายเหตุ |
|---|---|---|
| `report-TEST/` | **Deprecate** ทันที | ใช้ Production DB |
| `line-noti/`, `line_notice.php`, `gentext_line_notice.php` | **Deprecate** | LINE Notify ปิดบริการแล้ว |
| `monday/` webhooks | **Deprecate** (ช่องทาง LINE Notify ใช้ไม่ได้) | ตรวจว่า monday.com ยังส่ง Webhook อยู่หรือไม่; อนาคตย้ายไป Internal Requests |
| `document/` | Future — Document Center | สำรวจแยก |
| `theinventory/` | Future — IT Asset | สำรวจแยก |
| `pas-frontweb/` | Public site — แยกจาก Internal | ไม่เกี่ยวกับ Phase 1 |
| ตาราง `pec_*`, `mail`, `depart_table`, `group_table`, `month_table`, `job_list_table`, `job_member_table` | **Deprecate** | ไม่ย้าย; `mail` ควรลบหลังยืนยัน |

## E. Non-functional Gap

| หัวข้อ | As-Is | Target |
|---|---|---|
| Availability | Shared hosting เดียว, ไม่มี HA | Cloud Run หลาย Instance + Cloud SQL (HA ตามงบ — ดู 05 §8) |
| Backup | DirectAdmin backup, ไม่พบทดสอบ Restore | Automated backup + PITR + ทดสอบ Restore |
| Observability | Apache logs 2 เดือน | OpenTelemetry, Structured logs, Alerting |
| Delivery | Upload ไฟล์ | Git + CI/CD + Staging |
| Testing | ไม่มี | Unit / Integration / E2E |
