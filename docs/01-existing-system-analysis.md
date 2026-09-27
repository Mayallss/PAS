# 01 — Existing System Analysis

## 1. ภาพรวม Hosting

| หัวข้อ | สิ่งที่พบ [ยืนยันแล้ว] |
|---|---|
| Hosting | Shared hosting, DirectAdmin (สร้าง Account ก.ค. 2019), Domain `pas-acc.com` |
| Web server | Apache + PHP (ใช้ `mysqli`, บางไฟล์เก่ายังใช้ `mysql_*` ที่เลิกใช้ใน PHP 7) |
| Subdomains | `report`, `test`, `theinventory` |
| TLS | บังคับ HTTPS ผ่าน `.htaccess` |
| Backup | DirectAdmin backup (DB dumps + home) — ไม่พบ Automated off-site backup / PITR |
| Cron | ไม่มี (`crontab.conf` ว่าง) — Notification ใช้ n8n Cloud เรียก API จากภายนอก |
| Logging | Apache access/error logs หมุนเวียน ~2 เดือน, ไม่มี Application log / Audit log |
| Deployment | Upload ไฟล์ตรง (มี `.rar` สำรองไว้ใน Web root), ไม่มี Version control / CI |

### แอปพลิเคชันบน Web root (`public_html/`)

| Path | หน้าที่ | ขอบเขต Phase 1 |
|---|---|---|
| `/` → `/pas-frontweb/` | เว็บไซต์บริษัท (Public, TH/EN) | นอกขอบเขต (Public Portal แยกภายหลัง) |
| `/link/` | Link Portal ภายใน: ลิงก์ไป Time Report, monday.com boards, The Inventory, Microsoft Forms/Workflow (`wkf.ms`), ระบบ IT ภายใน (`192.168.10.254`) | **ต้นแบบของ Homepage / Application Launcher** |
| `/report/` | **Time Report** + รายงานการประชุมประจำเดือน | **Phase 1B** |
| `/report-TEST/` | สำเนา Time Report สำหรับทดสอบ (ใช้ Production DB!) | Deprecate |
| `/document/` | ระบบติดตามเอกสาร/ส่งเอกสาร (DB `pasacccom_document`) | Future: Document Center |
| `/theinventory/` | ระบบคลังสินค้า/ทรัพย์สิน (DB `pasacccom_theinventory`) | Future: IT Asset |
| `/monday/` | Webhook รับ Event จาก monday.com → LINE Notify (คำขอ IT, คำขอนำเอกสารออก) | Future: Internal Requests (LINE Notify ใช้ไม่ได้แล้ว) |
| `/line-noti/` | แจ้งเตือน Time Report วันศุกร์ 15:00 ผ่าน LINE Notify | Replaced by n8n |
| `/pas-report-api.php` | Read-only JSON API สำหรับ n8n: คนที่กรอก Time Report ไม่ครบ + คนที่ยังไม่รับทราบรายงานประชุม | Keep แนวคิด → ย้ายเข้า Notification Service |

## 2. Technical Architecture ของ Time Report

```
Browser (jQuery + Bootstrap 4 + DataTables + CKEditor)
   │  ├─ PHP pages render HTML (server-side, SQL string concatenation)
   │  └─ XHR GET  query_db.php?q=<RAW SQL built in JavaScript>   ← write path
   │     XHR GET  j_query.php?x|y|z|de|com_...=<JSON>            ← read path (prepared stmt)
   ▼
PHP 7.x (no framework, Dreamweaver-generated auth helpers)
   ▼
MySQL/MariaDB  pasacccom_report  (MyISAM + InnoDB, utf8, no foreign keys)
```

| หัวข้อ | สิ่งที่พบ |
|---|---|
| Frontend | jQuery, Bootstrap 4, bootstrap-select, DataTables, jQuery UI datepicker, CKEditor, bootbox — commit `node_modules` ขึ้น Server |
| Backend | PHP procedural ไม่มี Framework, ไม่มี Router, ไม่มี Layer แยก Business logic |
| Business logic | กระจายอยู่ทั้งใน PHP (render) และ **JavaScript (สร้าง SQL)** |
| API | ไม่มี API ที่ออกแบบ — มี `j_query.php` (switch ตาม query param) + `query_db.php` (raw SQL) |
| Authentication | Username/Password ในตาราง `member_table`, MD5, PHP session (`$_SESSION['uuid']`, `MM_UserGroup`) |
| Authorization | ตรวจเฉพาะระดับหน้า (Dreamweaver `isAuthorized`) — ไม่ตรวจระดับ Resource/ข้อมูล, 15 ไฟล์ไม่ตรวจเลย |
| Export | PhpSpreadsheet (`list_export.php`) — ไม่พบ PDF export ใน Time Report |
| Notifications | เดิม LINE Notify (ปิดบริการแล้ว) → ปัจจุบัน n8n Cloud เรียก `pas-report-api.php` |
| Integrations | monday.com webhooks, n8n Cloud, Microsoft Forms/Workflow (ผ่านลิงก์เท่านั้น) |
| File storage | ไม่มีใน Time Report |
| Audit | ไม่มี (มีเพียง `date_create` ของรายการ, `company_who_edit` ของลูกค้า) |
| Tests | ไม่มี |

## 3. Database Schema Analysis (`pasacccom_report`)

### 3.1 ตารางหลักของ Time Report

| ตาราง | ความหมายทางธุรกิจ | Rows | หมายเหตุ |
|---|---|---:|---|
| `member_table` | พนักงาน + บัญชีผู้ใช้ | 151 (active `work=1`: 36) | `authen` = Role, `status` = ระดับ (FK → `member_level`), `team_member` → `subTeam_table` |
| `member_level` | ระดับพนักงาน + อัตราค่าบริการ | 6 | J, SS, S, M, SM, D — `lvl_rate` อยู่ในช่วง 1,000–20,000 |
| `company_table` | **ลูกค้า** (Customer) | 698 (active 619) | PK เป็น `varchar(7)` รหัสลูกค้า เช่น `A123`, มี Tax ID, `company_admin` = พนักงานผู้ดูแลลูกค้า |
| `job_table` | **ประเภทงาน / Activity** | 73 | `job_ac_group`: 1=JOB, 2=PAS, 3=Meet, 4=Leave |
| `activity_list_table` | ประเภทงานที่เปิดให้ลงเวลาได้ต่อลูกค้า (Customer × Activity) | 1,705 (active 1,643) | ทำหน้าที่เหมือน "Engagement" |
| `activity_table` | **Time Entry** | 96,704 | `list_period` = นาที (float), `list_date`, `list_note`, `list_member_id`, `job_company_id`, `job_name` |
| `holidays_table` | วันหยุดบริษัท | 102 (ธ.ค. 2019 – ธ.ค. 2026) | `hl_time` = นาทีที่หยุด (ทุกแถว = 540) |
| `subTeam_table`, `team_table` | ทีม / ทีมย่อย | 11 / 7 | ใช้แค่หน้า Member admin — ไม่ใช้ใน Report |
| `meet`, `meet_agree` | รายงานการประชุมประจำเดือน + การกดรับทราบ | 116 / 3,067 | ปี 2016–2026 |

### 3.2 ตารางที่ไม่ถูกใช้แล้ว / ซ้ำซ้อน

| ตาราง | สถานะ |
|---|---|
| `todolist_table` (112), `activity_table.todolist_id/priority_activity/status_activity` | ข้อมูล พ.ย. 2024 – ก.พ. 2025 เท่านั้น ไม่มี Code อ้างอิง → ฟีเจอร์ที่ถูกทิ้ง |
| `job_list_table`, `job_member_table` | โครงสร้างงานรุ่นเก่า มีอ้างอิงเฉพาะใน Comment |
| `depart_table`, `group_table`, `month_table` | ไม่มี Code อ้างอิง |
| `pec_mssgs`, `pec_users` | ปฏิทิน PHP Event Calendar รุ่นเก่า |
| `mail` | รหัสผ่านอีเมล Plain text — ไม่มี Code อ้างอิง (ดู 00-H5) |
| `activity_table.job_detail` | ค่าเป็น `-` ทุกแถว |

### 3.3 ปัญหาเชิงโครงสร้าง
- ไม่มี Foreign key, ไม่มี Unique constraint ที่ `(member, date, customer, activity)`
- `activity_table` เป็น MyISAM (ไม่มี Transaction, ไม่ Crash-safe)
- ชนิดข้อมูลไม่สอดคล้อง: `job_company_id varchar(7)` vs `com_activity_id varchar(7)`; `agree_month`/`agree_member` เป็น varchar แต่เก็บ ID
- เวลาเก็บเป็น `float` นาที
- Soft-delete ด้วย flag `work`, `company_active`, `activity_active` แต่ Time entry ลบแบบ Hard delete
- การเปลี่ยนรหัสลูกค้าทำโดย UPDATE PK + UPDATE ตารางลูก 2 ตารางแยกกันจาก Browser (ไม่มี Transaction)

## 4. Data Quality Profile (`activity_table`) [ยืนยันแล้ว — สถิติรวม]

| ตรวจ | ผล |
|---|---|
| ช่วงวันที่ | 2019-11-26 → 2026-10-09 (16 แถวเป็นวันในอนาคต) |
| ปริมาณต่อปี | ~13,000–16,000 แถว/ปี |
| ค่า `list_period` | ต่ำสุด −90, สูงสุด 540; 134 แถว = 0; 1 แถวติดลบ; 7 แถวไม่ใช่ทวีคูณ 30 นาที |
| ค่าที่พบบ่อย | 540 (27%), 60, 120, 180, 240, 300, 30, 90 |
| รายการซ้ำ `(member, date, customer, activity)` | 765 กลุ่ม, เกิน 820 แถว |
| ผลรวมต่อคน-ต่อวัน (47,816 วัน) | = 540: **99.1%**, > 540: 175, < 540: 249, > 720: 116 |
| อ้างอิงกำพร้า (Orphan) | member ไม่มีจริง 858 แถว, customer ไม่มีจริง 28, activity ไม่มีจริง 25 |
| คู่ Customer×Activity ที่ถูกปิดแล้ว | 247 แถว (ถูกซ่อนจากตาราง และ **ไม่นับ** ในผลรวมรายวันของหน้าจอ แต่ **นับ** ใน API แจ้งเตือน) |
| บันทึกย้อนหลัง > 31 วัน | 1,506 แถว |
| บันทึกในวันเสาร์-อาทิตย์ | มีใน 93 วันที่ต่างกัน |
| สัดส่วนตามกลุ่มงาน | PAS 60,005 · JOB 32,658 · Leave 2,692 · Meet 1,324 |
| `list_note` | 96.7% มีหมายเหตุ |

ข้อมูลอื่น: `job_table` บางรายการฝังชื่อบุคคล/ลูกค้าไว้ในชื่อประเภทงาน (เช่น งานบัญชีเฉพาะราย) → ควรแยกเป็น Customer/Project ในระบบใหม่

## 5. การใช้งานจริง (Access log ส.ค. – ก.ย. 2026)

| Endpoint | Requests | ความหมาย |
|---|---:|---|
| `POST/GET list_member_new.php` | ~5,250 | หน้าบันทึกเวลา (หน้าหลัก) |
| `GET query_db.php?q=INSERT/UPDATE/delete` | 2,821 / 288 / 341 | การเขียนข้อมูลเวลา |
| `GET j_query.php` | 2,370 | Dropdown ลูกค้า/งาน |
| `POST nav_bar.php` | 775 | Login / เปลี่ยนรหัสผ่าน |
| `GET meet_list.php` | 321 | อ่านรายงานประชุม |
| `pas-report-api.php` | 16 | n8n แจ้งเตือน (เริ่ม ก.ย. 2026) |

- ผู้ใช้ Active 90 วันล่าสุด: **41 คน**
- Subdomain `report.pas-acc.com` ได้รับแต่ Bot scan หาไฟล์ PHP/WordPress (ไม่ใช่ผู้ใช้จริง)

## 6. User Role & Permission Matrix (As-Is) [ยืนยันแล้ว]

`member_table.authen`: `0`=USER (126), `1`=ADMIN (6), `2`=MANAGER (7), `3`=OWNER (1), `4`=IT (11)

| ความสามารถ | USER 0 | ADMIN 1 | MANAGER 2 | OWNER 3 | IT 4 | ไม่ Login |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| บันทึก/แก้/ลบเวลาของตนเอง (`list_member_new.php`) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ ผ่าน `query_db.php` |
| เปลี่ยนรหัสผ่านตนเอง | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| อ่านรายงานประชุม + กดรับทราบ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ อ่านได้ (`meet_list.php`) |
| รายงานเวลาทุกคนรายเดือน (`list_report.php`) | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| รายงานต้นทุนตามลูกค้า (`report_job.php`) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ ผ่าน `j_query.php?com_` |
| รายงานการลา (`report_leave.php`) | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| จัดการพนักงาน/Role/รหัสผ่าน (`list_manage.php`) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ ผ่าน `update_db.php` |
| จัดการลูกค้า + Activity ต่อลูกค้า (`job_manage.php`) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| จัดการรายงานประชุม (`meet_manage.php`) | ❌ | ✅ | ✅ | ✅ | ✅ | — |
| รายงานกิจกรรมประชุม (`report_activity.php`) | ❌ | ❌ | ✅ | ✅ | ✅ | — |
| จัดการวันหยุด (`holiday.php`) | ❌ (ซ่อนเมนู) | ✅ | ✅ | ✅ | ✅ | ⚠️ ไม่ตรวจสิทธิ์ |
| Export Excel (`list_export.php`) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ ไม่ตรวจสิทธิ์ |

ข้อสังเกต:
- Role 1–4 ได้สิทธิ์ **เท่ากันเกือบทั้งหมด** — ไม่มีการแยกขอบเขตข้อมูลตามทีม: MANAGER เห็นข้อมูลทุกคน
- IT (11 บัญชี) มีสิทธิ์เห็นอัตราค่าแรงและต้นทุนลูกค้า — ขัดหลัก Least privilege
- ไม่มีการแยก "ผู้อนุมัติ" เพราะระบบไม่มี Approval
