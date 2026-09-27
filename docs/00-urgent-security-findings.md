# 00 — URGENT: Security Findings ในระบบที่ใช้งานอยู่

> ระบบ Time Report เดิม (`https://www.pas-acc.com/report/`) ยังใช้งานจริงทุกวัน ช่องโหว่ด้านล่างมีผลกับ **ข้อมูลพนักงานและลูกค้าจริงตอนนี้**
> แนะนำให้แก้ไขเร่งด่วน **ก่อน** เริ่มพัฒนาระบบใหม่ เพราะระบบใหม่จะใช้เวลาหลายเดือน
> เอกสารนี้ไม่ระบุค่า Credential ใด ๆ — ระบุเพียงตำแหน่งไฟล์

## Critical

### C1. Endpoint รัน SQL อะไรก็ได้ โดยไม่ต้อง Login
- ไฟล์: `report/query_db.php`, `report/update_db.php` (และสำเนาใน `report-TEST/`)
- รับ `$_REQUEST["q"]` แล้วส่งเข้า `mysqli_query` / `prepare()->execute()` ตรง ๆ ไม่มีการตรวจ Session
- หน้าบันทึกเวลา (`list_member_new.php`), จัดการพนักงาน (`list_manage.php`), จัดการลูกค้า (`job_manage.php`) **สร้าง SQL ใน Browser** แล้วส่งมาที่ Endpoint นี้ผ่าน GET
- ผลกระทบ: ผู้ใดก็ตามบน Internet สามารถอ่าน/แก้ไข/ลบข้อมูลทั้งฐาน `pasacccom_report` ได้ (DB user มีสิทธิ์ DROP/ALTER)
- จาก Log ส.ค.–ก.ย. 2026: เรียกใช้ ~3,450 ครั้ง ทั้งหมดมาจากหน้าเว็บของระบบเอง (ยังไม่พบการเรียกจากภายนอก — แต่ Log เก็บได้เพียง 2 เดือน)

### C2. SQL Injection ที่หน้า Login
- ไฟล์: `report/nav_bar.php` — `username_member = '" . $u_name . "'` ไม่ Escape
- ผลกระทบ: Bypass การ Login ได้

### C3. Endpoint ที่คืนข้อมูลพนักงานรวม Password Hash โดยไม่ต้อง Login
- ไฟล์: `report/j_query.php?yx=...` → `SELECT * FROM member_table` (รวมคอลัมน์ `password_member`)
- `j_query.php?com_=...` คืนอัตราค่าแรงตามระดับพนักงาน (`lvl_rate`) และชั่วโมงต่อลูกค้า
- `company_query.php`, `activity_query.php` คืนข้อมูลลูกค้า (Tax ID, ที่อยู่) โดยไม่ต้อง Login

### C4. Password เก็บเป็น MD5 ไม่มี Salt
- `member_table.password_member` (124/151 บัญชีเป็น MD5), 32 บัญชีใช้ Hash ซ้ำกัน (รหัสผ่านเดียวกัน) → Crack ได้ทันทีเมื่อ Hash รั่ว (ดู C3)
- `login_acc.php` (หน้าเก่า) เทียบรหัสผ่านแบบ Plain text

### C5. ไฟล์ต้องสงสัยว่าเป็น Webshell
- ใน `.trash` ของ Home (`backup/home.tar.gz`): ไฟล์ PHP ชื่อสุ่มในโฟลเดอร์ `wp/` พร้อม `.htaccess` กระจายในหลายโฟลเดอร์ (`img/`, `lib/`, `plugins/`, `wp-includes/`, `pas_upload/`) — ลักษณะตรงกับ Webshell ที่ถูกฝาก
- `public_ftp/incoming/` มี `wp-blog-header.php`, `wp-cron.php` ทั้งที่เว็บไม่ได้ใช้ WordPress
- ไม่พบการเรียกไฟล์เหล่านี้ใน Log ส.ค.–ก.ย. 2026 แต่ไม่ทราบว่าถูกฝากเข้ามาเมื่อใดและผ่านช่องทางใด (ช่องโหว่ C1/C2 เป็นช่องทางที่เป็นไปได้)

## High

| # | ปัญหา | ตำแหน่ง |
|---|---|---|
| H1 | `holiday_action.php` เพิ่ม/ลบ/แก้วันหยุดได้โดยไม่ต้อง Login (ส่งผลต่อการคำนวณชั่วโมงที่ต้องกรอก) | `report/holiday_action.php` |
| H2 | `list_export.php` Export ชั่วโมงทำงานของพนักงานทุกคนเป็น Excel โดยไม่ต้อง Login | `report/list_export.php` |
| H3 | `report-TEST/` เชื่อมต่อ **Production DB** (`pasacccom_report`) ด้วย User เดียวกัน — การทดสอบใด ๆ แก้ข้อมูลจริง | `report-TEST/Connections/conn.php` |
| H4 | Credential ฝังใน Source code และ Comment (DB password ปรากฏใน Comment ของ `company_query.php`, LINE Notify token ใน `line_notice.php`, `monday/*.php`, `line-noti/*.php`) | หลายไฟล์ |
| H5 | ตาราง `mail` เก็บรหัสผ่านอีเมล 21 รายการเป็น Plain text | `pasacccom_report.mail` |
| H6 | ไม่มี CSRF protection, ไม่มี Session regeneration หลัง Login, ไม่มี Rate limit / Lockout | ทั้งระบบ |
| H7 | Stored XSS: ชื่อ/หมายเหตุ ถูก echo ออก HTML โดยไม่ Escape | `nav_bar.php`, `list_member_new.php` ฯลฯ |
| H8 | ไฟล์ `.rar` สำรอง Source code อยู่ใน Web root ดาวน์โหลดได้ | `report/*.rar` |

## ข้อเสนอการแก้ไขเฉพาะหน้า (Containment — ทำได้ภายในวัน โดยไม่ต้องรอระบบใหม่)

> ทุกข้อเป็นการเปลี่ยนแปลงบน Production — **ต้องได้รับอนุมัติและทำ Backup ก่อน** ผมยังไม่ได้แก้ไขอะไรบน Server

1. **สำรองข้อมูล** DB + ไฟล์ และทดสอบ Restore บนเครื่องอื่น
2. **ปิด `report-TEST/`** (หรือเปลี่ยนให้ใช้ DB แยก)
3. **จำกัดการเข้าถึง `/report/` ทั้งโฟลเดอร์** ด้วย HTTP Basic Auth หรือ IP allowlist ของสำนักงานใน `.htaccess` — ลดความเสี่ยง C1–C3, H1–H2 ได้ทันทีโดยไม่ต้องแก้ Code
4. **เพิ่ม Session check** ใน `query_db.php`, `update_db.php`, `j_query.php`, `holiday_action.php`, `list_export.php`, `company_query.php`, `activity_query.php`
5. **เปลี่ยนรหัสผ่าน** DB users ทั้งหมด (`pasacccom_root`, `pasacccom`, `pasacccom_pasacccom`) และ Revoke LINE Notify tokens (บริการ LINE Notify ปิดไปแล้วตั้งแต่ 31 มี.ค. 2025 อยู่แล้ว) — ย้ายค่าออกจาก Source code
6. **ลบ** `.rar` ใน Web root, ไฟล์ WordPress ใน `public_ftp/incoming/`, และ Empty trash หลังเก็บสำเนาไว้ทำ Forensic
7. **ลบตาราง `mail`** หรือเปลี่ยนรหัสผ่านอีเมลที่อยู่ในนั้นทั้งหมด (ต้องยืนยันว่ายังใช้งานหรือไม่)
8. บังคับให้พนักงาน **เปลี่ยนรหัสผ่าน** หลังปิดช่องโหว่ C1–C3
9. ขอให้ผู้ให้บริการ Hosting ตรวจ Malware scan ทั้ง Account และตรวจ Log ย้อนหลังที่เก็บไว้นานกว่า 2 เดือน

ข้อ 3 + 4 เป็นมาตรการที่คุ้มที่สุด ผมสามารถเตรียม Patch ให้ตรวจก่อนนำขึ้นได้หากต้องการ
