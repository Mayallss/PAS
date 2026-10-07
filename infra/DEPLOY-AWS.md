# Deploy PAS Platform ขึ้น AWS (Free plan + เครดิต)

สถาปัตยกรรม (ap-southeast-1 / สิงคโปร์):

```
Internet ──► ALB (HTTP / HTTPS ถ้ามีโดเมน)
               ├─► ECS Fargate task "app"  [ web (Next.js :3000) ──localhost──► api (NestJS :4000) ]
               │        ├─► RDS PostgreSQL 16 (private subnet, SSL บังคับ)
               │        ├─► S3 (ไฟล์หลักฐาน IT asset, write-once)
               │        ├─► Secrets Manager (DATABASE_URL, secrets, monday/Google)
               │        └─► CloudWatch Logs
               └─► ECS task "site" (เว็บบริษัท, ปิดไว้เป็นค่าเริ่มต้น)
Cognito User Pool ── OIDC login (เปิดเมื่อมีโดเมน https)
CloudWatch Alarms + AWS Budgets ──► อีเมลแจ้งเตือน
```

ออกแบบให้ประหยัดเครดิต: **ไม่มี NAT Gateway** (ประหยัด ~$32/เดือน), Fargate **Spot**, API กับ web อยู่ task เดียวกัน,
RDS `db.t4g.micro` single-AZ, log เก็บ 7 วัน, Container Insights ปิด

## ค่าใช้จ่ายโดยประมาณ (หักจากเครดิต)

| รายการ | ~USD/เดือน |
|---|---|
| ALB (ชั่วโมง + LCU) | 18–20 |
| RDS db.t4g.micro + 20 GB gp3 | 18–21 |
| Fargate Spot 0.5 vCPU / 1 GB (portal) | 7–9 (on-demand ~22) |
| Public IPv4 (ALB 2 + task 1) | ~11 |
| Secrets Manager 2 secrets | 0.8 |
| CloudWatch / ECR / S3 / Cognito Lite | < 2 |
| **รวม** | **≈ 55–65** (+~$4–9 ถ้าเปิด `enable_site`) |

ตัวเลขเป็นค่าประมาณ ดูของจริงได้ที่ Billing → Bills/Credits และใน AWS Budgets ที่ Terraform สร้างให้
เครดิต $200 ใช้ได้ราว 3 เดือนหากเปิดตลอด และใช้ `pause.ps1` หยุดตอนไม่ใช้งานเพื่อยืดเวลา

> **Free plan:** บัญชีปิดอัตโนมัติเมื่อครบ 6 เดือนหรือเครดิตหมด ถ้าจะใช้งานจริงต่อ ให้ **Upgrade เป็น Paid plan**
> ในหน้า Billing (เครดิตที่เหลือยังใช้ได้) ถ้าเจอ error ว่าบริการใดใช้ไม่ได้บน Free plan ให้ upgrade เช่นกัน

## 0) รับเครดิตเพิ่ม $100 (ทำก่อน deploy)

Console → Home → วิดเจ็ต **Explore AWS / Earn credits** ทำ 5 กิจกรรม × $20:

1. **Set up a cost budget (AWS Budgets)**
2. **Launch an EC2 instance** → t3.micro แล้ว *Terminate* ทันทีหลังเครดิตเข้า
3. **Create an RDS database** → ทำตาม wizard แล้ว *Delete* (ไม่ต้องเก็บ snapshot) — ฐานข้อมูลจริง Terraform จะสร้างให้
4. **Build a web app with AWS Lambda** → function URL ตามตัวอย่าง แล้วลบได้
5. **Use a foundation model in Amazon Bedrock playground**

ทำผ่านวิดเจ็ตนั้นโดยตรงเพื่อให้ระบบนับกิจกรรม ดูความคืบหน้าได้ที่ Billing → Credits

## 1) ติดตั้งเครื่องมือ (Windows)

```powershell
winget install Amazon.AWSCLI
winget install Hashicorp.Terraform
winget install Docker.DockerDesktop     # เปิด Docker Desktop ค้างไว้ตอน deploy
```

สร้าง IAM user สำหรับ deploy (อย่าใช้ root): IAM → Users → Create user → attach `AdministratorAccess`
→ Security credentials → Create access key (CLI) แล้ว:

```powershell
aws configure    # ใส่ Access key, Secret, region = ap-southeast-1, output = json
aws sts get-caller-identity
```

## 2) ตั้งค่า

```powershell
cd C:\Users\asus\Desktop\New\pas-platform
copy infra\terraform\terraform.tfvars.example infra\terraform\terraform.tfvars
notepad infra\terraform\terraform.tfvars      # ใส่ alert_email
```

## 3) Deploy

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\infra\scripts\deploy.ps1
```

สคริปต์จะ: สร้าง ECR → build image `api`/`web` (linux/amd64) → push → `terraform apply` ทั้งหมด
ครั้งแรกใช้ ~15–20 นาที (RDS นานสุด) ตอนจบจะแสดง `portal_url` (http://pas-alb-….elb.amazonaws.com)

**ยืนยันอีเมล** "AWS Notification – Subscription Confirmation" ที่ส่งไป `alert_email` เพื่อรับ alarm

API ทำ `prisma migrate deploy` อัตโนมัติทุกครั้งที่ task สตาร์ท

## 4) ผู้ดูแลระบบคนแรก

ใน production ไม่มี dev login ต้องสร้าง admin คนแรกแล้วตั้งรหัสผ่านผ่านลิงก์ครั้งเดียว:

```powershell
.\infra\scripts\run-job.ps1 -Job bootstrap-admin -Email you@pas-acc.com -Name "ชื่อ นามสกุล" -Username you
```

เปิดลิงก์ `SET-PASSWORD LINK` ที่แสดง (ใช้ได้ 72 ชม.) ตั้งรหัสผ่าน แล้วเข้าระบบด้วย username/password
จากนั้น admin ออกลิงก์ให้พนักงานคนอื่นได้จากหน้า Admin → พนักงาน

ข้อมูลทดสอบ (สำหรับ environment ทดลองเท่านั้น): `.\infra\scripts\run-job.ps1 -Job seed-demo`

## 5) โดเมน + HTTPS + Cognito login (แนะนำก่อนใช้งานจริง)

ระหว่างที่ไม่มีโดเมน ระบบเป็น **HTTP** (cookie ไม่ secure) เหมาะสำหรับทดสอบเท่านั้น

1. แก้ `terraform.tfvars`:
   ```hcl
   domain_name         = "portal.pas-acc.com"
   oidc_allowed_domain = "pas-acc.com"
   ```
2. ขอใบรับรองก่อน แล้วดู record ที่ต้องเพิ่ม:
   ```powershell
   cd infra\terraform
   terraform apply -target=aws_acm_certificate.main
   terraform output acm_validation_records
   ```
3. ที่ผู้ให้บริการ DNS: เพิ่ม CNAME ตาม `acm_validation_records` และ CNAME `portal` → `alb_dns_name`
4. `.\infra\scripts\deploy.ps1 -InfraOnly` (รอ ACM validate ไม่เกินไม่กี่นาทีหลัง DNS อัปเดต)

เมื่อมีโดเมน Terraform จะผูก **Cognito** เป็น OIDC ให้อัตโนมัติ (`OIDC_ISSUER`, client id/secret)
เพิ่มผู้ใช้ได้ที่ Cognito → User pools → `pas-users` → Create user (อีเมลต้องตรงกับอีเมลพนักงานในระบบ)
ปุ่ม SSO ในหน้า login จะพาไปหน้า login ของ Cognito (รองรับ MFA แบบ authenticator app)
username/password ของระบบเองยังใช้ได้ (`PASSWORD_LOGIN=true`)

เว็บบริษัท (`apps/site`): ตั้ง `enable_site = true` และ `site_domain_name = "pas-acc.com"` แล้ว deploy ใหม่
(ไม่มีโดเมน: เปิดที่ `http://<alb>:8080`)

## 6) monday.com / Google Calendar

Secrets Manager → `pas/integrations` → Retrieve secret value → Edit → ใส่ `MONDAY_API_TOKEN`,
`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (key บรรทัดเดียว ใช้ `\n`) → Save แล้วสั่ง restart:

```powershell
aws ecs update-service --cluster pas --service pas-app --force-new-deployment
```

Terraform จะไม่เขียนทับค่าใน secret นี้

## 7) อัปเดตเวอร์ชัน / งานประจำ

| ต้องการ | คำสั่ง |
|---|---|
| deploy โค้ดใหม่ | `.\infra\scripts\deploy.ps1` |
| ดู log สด | `aws logs tail /ecs/pas/api --follow` (หรือ `/ecs/pas/web`) |
| เข้า shell ใน container | `aws ecs execute-command --cluster pas --task <id> --container api --interactive --command sh` |
| หยุดชั่วคราวเพื่อประหยัด | `.\infra\scripts\pause.ps1 -Stop` / `-Start` |
| ลบทุกอย่าง | `cd infra\terraform; terraform destroy` |

`pause.ps1 -Stop` หยุด ECS + RDS (ยังเสีย ALB/IP ~$1/วัน) RDS จะเปิดเองอัตโนมัติหลัง 7 วัน
และ `terraform apply` ครั้งถัดไปจะตั้งจำนวน task กลับตาม `app_desired_count`

ก่อน `terraform destroy`: ถ้ามีไฟล์ใน S3 bucket ต้องลบก่อน (bucket ตั้ง `force_destroy = false` กันลบข้อมูลโดยไม่ตั้งใจ)
เมื่อมีข้อมูลจริงแล้ว ตั้ง `db_deletion_protection = true`

## 8) CI/CD ผ่าน GitHub Actions

หลังตั้งค่าครั้งเดียว ทุกครั้งที่ push เข้า `main` ระบบจะ:
**typecheck + test → build image (api, web) → push ECR → deploy ECS → รอจนเสถียร** (ถ้า API สตาร์ทไม่ขึ้น
ECS จะ rollback เวอร์ชันเดิมให้อัตโนมัติ) ไม่ต้องเก็บ AWS access key ไว้ใน GitHub เพราะใช้ OIDC

| ส่วน | ใครทำ |
|---|---|
| โค้ดแอป (apps/, packages/, Dockerfile) | GitHub Actions — `.github/workflows/deploy.yml` |
| โครงสร้าง (infra/terraform) | คุณรัน `deploy.ps1 -InfraOnly` เอง; PR ที่แก้ infra จะถูกเช็ก fmt/validate/test โดย `infra.yml` |

role ของ GitHub push image และ deploy ได้อย่างเดียว แก้/ลบ infra ไม่ได้

### ตั้งค่าครั้งเดียว

1. ใน `terraform.tfvars` ใส่ `github_repo = "Mayallss/PAS"` แล้วรัน `.\infra\scripts\deploy.ps1`
   (ครั้งแรกต้องรันแบบเต็มจากเครื่องหนึ่งครั้ง เพื่อสร้าง ECS service และ image ชุดแรก ครั้งต่อไปใช้ `-InfraOnly`)
2. คัดลอกค่า: `cd infra\terraform; terraform output github_deploy_role_arn`
3. GitHub → repo **PAS** → Settings → Secrets and variables → Actions → แท็บ **Variables** → New repository variable:
   - `AWS_DEPLOY_ROLE_ARN` = ค่าจากข้อ 2
   - `AWS_REGION` = `ap-southeast-1`
   - (ถ้าเปิดเว็บบริษัท) `ENABLE_SITE` = `true`
4. (แนะนำ) Settings → Environments → **production** → Required reviewers → ใส่ตัวเอง
   ทุก deploy จะรอให้กด Approve ก่อน (environment นี้ถูกสร้างอัตโนมัติหลัง workflow รันครั้งแรก)
5. push ขึ้น `main` หรือ Actions → **Deploy to AWS** → Run workflow

ถ้าบัญชี AWS มี GitHub OIDC provider อยู่แล้ว (เคยตั้งให้ repo อื่น) ให้ใส่ `create_github_oidc_provider = false`

### หมายเหตุ

- `deploy.yml` รัน typecheck + test เองโดยไม่มีขั้น `npm audit` เพราะ `ci.yml` เดิม fail ที่ audit อยู่
  (dependency `jest` 29 และแพ็กเกจ `git` ใน root `package.json` ที่น่าจะติดตั้งมาโดยไม่ตั้งใจ) ควรแก้แยก
- Terraform ไม่ย้อน image ที่ GitHub deploy ไป (service ตั้ง `ignore_changes = [task_definition]`);
  ถ้าแก้ env/secret ผ่าน Terraform ค่าใหม่จะมีผลใน deploy ครั้งถัดไป หรือสั่ง Run workflow เพื่อ deploy ทันที
- `deploy.ps1` (ไม่ใส่ `-InfraOnly`) ยังใช้ deploy จากเครื่องได้เหมือนเดิม

## หมายเหตุด้านความปลอดภัย

- `terraform.tfstate` เก็บรหัสผ่าน DB **ห้าม commit** (อยู่ใน `.gitignore` แล้ว) เก็บสำรองไว้ในที่ปลอดภัย
- API ไม่เปิดออกนอก task: ALB ส่งเข้า web เท่านั้น, web proxy `/api` ไป `127.0.0.1:4000`
- RDS ไม่มี public IP, รับเฉพาะจาก security group ของ ECS, บังคับ SSL
- S3 block public access, บังคับ TLS, เปิด versioning, task role เขียน/อ่านได้เฉพาะ `evidence/*`
- CI (`npm audit --audit-level=high`) ตอนนี้ fail อยู่แล้วจาก dependency เดิม ควรไล่แก้แยกต่างหาก
