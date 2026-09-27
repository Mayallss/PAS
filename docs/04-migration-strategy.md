# 04 — Migration Strategy

## 1. หลักการ
1. **ไม่แตะ Production** จนกว่าจะมี Backup ที่ทดสอบ Restore แล้ว
2. Migration เป็น Script ที่รันซ้ำได้ (Idempotent) จาก **Snapshot** ของ MySQL → PostgreSQL (Staging)
3. เก็บ `legacy_id` ทุกตาราง เพื่อ Trace ย้อนกลับและเปรียบเทียบรายงาน
4. ทุกกฎแปลง/ทำความสะอาดข้อมูลต้องได้รับอนุมัติ (06-Q9) และบันทึกไว้ใน Migration report
5. ข้อมูลที่ไม่ย้าย → เก็บเป็น Archive (dump แบบเข้ารหัส) ไม่ลบทิ้ง

## 2. แนวทาง Cutover — แนะนำ **Big-bang ต้นเดือน** (ไม่รันคู่ขนาน)

เหตุผล: ผู้ใช้ ~41 คน, ระบบเดียว, ข้อมูลเขียนอย่างเดียวจากหน้าจอเดียว → การ Sync สองทางมีความเสี่ยงสูงกว่าประโยชน์

```
T-4 สัปดาห์  Dry-run migration บน Staging ด้วย Snapshot ล่าสุด + Reconciliation report
T-2 สัปดาห์  UAT: ผู้ใช้ตัวแทนเทียบรายงานเดือนก่อนหน้า ระบบเก่า vs ใหม่
T-1 วัน      ประกาศ Freeze; ตั้งระบบเก่าเป็น Read-only (revoke INSERT/UPDATE/DELETE ของ DB user)
T-0          Final snapshot → Migration → Reconciliation อัตโนมัติ → Go/No-go
T+0          เปิดระบบใหม่; ระบบเก่า Read-only (เพื่ออ้างอิง) อย่างน้อย 3 เดือน
```

ถ้าต้องรันคู่ขนาน (ตัดสินใจภายหลัง): ระบบใหม่เป็น Source of truth ทางเดียว, ระบบเก่า Read-only — **ห้ามเขียนสองฝั่ง**

## 3. Data Mapping

| Legacy | New (PostgreSQL) | กฎแปลง |
|---|---|---|
| `member_table` | `employee` + `user_account` + `employee_level_history` | `authen` → Role (ตาม 06-Q6); `work` → `employment_status`; `status` → level; `team_member` → `team_membership`; **ไม่ย้ายรหัสผ่าน** (ใช้ SSO) |
| `member_level` | `employee_level` + `cost_rate` (มีช่วงวันที่มีผล) | อัตราปัจจุบันเป็น Rate ตั้งแต่วันเริ่มต้น (ไม่มีประวัติในระบบเดิม) |
| `team_table`, `subTeam_table` | `org_unit` (hierarchy) | |
| `company_table` | `customer` | `company_id` เดิม → `customer_code` (unique, แก้ได้), PK ใหม่เป็น UUID; `trim()` รหัส (พบรหัสมีช่องว่างท้าย 10 รายการ); `company_admin` → `customer.account_owner_id` |
| `job_table` | `work_category` | `job_ac_group` → `category_type` (CLIENT_WORK / INTERNAL / MEETING / LEAVE) |
| `activity_list_table` | `engagement` (customer × work_category) | ลบคู่ซ้ำ (2 คู่); `activity_active` → `status` |
| `activity_table` | `time_entry` | `list_period` → `duration_minutes INT`; `list_note` → `description`; `date_create` → `created_at`; สถานะ = `MIGRATED` (ไม่ผ่าน Approval) |
| `holidays_table` | `work_calendar_holiday` | |
| `meet`, `meet_agree` | `announcement`, `announcement_acknowledgement` | CAST varchar → FK |
| `todolist_table`, `pec_*`, `mail`, `job_list_table`, `job_member_table`, `depart_table`, `group_table`, `month_table` | ไม่ย้าย | Archive; `mail` ต้องตัดสินใจลบ (00-H5) |

## 4. Data Quality Rules (ต้องอนุมัติ)

| ปัญหา | จำนวน | ข้อเสนอ |
|---|---:|---|
| รายการซ้ำ `(member,date,customer,activity)` | 765 กลุ่ม / 820 แถว | **รวม (Sum) นาที** เป็นแถวเดียว + ต่อหมายเหตุ — ตรงกับผลรวมที่หน้าจอเดิมแสดง; เก็บ legacy_ids ทั้งหมด |
| `list_period = 0` | 134 | ไม่ย้าย (เทียบเท่าการลบในระบบเดิม) — บันทึกใน Report |
| `list_period < 0` | 1 | ส่งให้เจ้าของข้อมูลตรวจ |
| ไม่ใช่ทวีคูณ 30 นาที | 7 | ย้ายตามจริง (ไม่ปัดเศษ) |
| Member ไม่มีในระบบ | 858 แถว | สร้าง Employee placeholder "อดีตพนักงาน #id" สถานะ Inactive — **ห้ามทิ้ง** เพราะกระทบรายงานต้นทุนย้อนหลัง |
| Customer ไม่มีในระบบ | 28 | Placeholder customer "Unknown #code" |
| Activity ไม่มีในระบบ | 25 | Placeholder work category |
| คู่ Customer×Activity ที่ถูกปิด | 247 | ย้ายเข้า Engagement สถานะ Closed — รายงานใหม่ต้อง **ตัดสินใจ** ว่าจะนับหรือไม่ (ระบบเดิมนับไม่เหมือนกันในแต่ละหน้า) |
| วัน-คน รวม > 720 นาที | 116 | ย้ายตามจริง + ติดธงให้ HR ตรวจ |
| วันที่ในอนาคต | 16 | ย้ายตามจริง |
| ชื่อ Activity ที่ฝังชื่อบุคคล/ลูกค้า | บางรายการ | ย้ายตามเดิม; ปรับโครงสร้างหลัง Go-live |

## 5. Reconciliation (ต้องผ่านทุกข้อจึง Go-live)
1. Record counts ต่อตาราง: legacy − excluded (ตามกฎ §4) = new
2. Checksum: `SUM(duration)` ต่อ (พนักงาน, เดือน), ต่อ (ลูกค้า, เดือน) ตรงกัน 100%
3. รายงาน 3 เดือนล่าสุด: `list_report` และ `report_job` (ชั่วโมง) ของระบบเก่า = ระบบใหม่
4. สุ่มตัวอย่าง 50 วัน-คน ให้พนักงานยืนยันในหน้าจอใหม่ช่วง UAT
5. Mapping ครบ: ไม่มี FK ที่ชี้ไปยังข้อมูลไม่มีอยู่

## 6. Rollback Plan
- ระบบเก่ายังอยู่ครบ (เพียงถูกตั้ง Read-only) → Rollback = คืนสิทธิ์เขียนให้ DB user + เปลี่ยนลิงก์กลับ
- ข้อมูลที่บันทึกในระบบใหม่ระหว่างช่วงก่อน Rollback: Export เป็น CSV และนำเข้าระบบเก่าด้วย Script ที่ทดสอบไว้แล้ว
- Rollback window: 2 สัปดาห์แรกหลัง Go-live

## 7. Pre-requisites
- [ ] Containment ใน 00 เสร็จ
- [ ] Backup DB + ไฟล์ ทดสอบ Restore สำเร็จ
- [ ] อนุมัติกฎ §4
- [ ] ยืนยัน Role mapping (06-Q6)
