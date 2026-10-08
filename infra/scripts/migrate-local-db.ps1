<#
.SYNOPSIS
  Copy the WHOLE local database (docker compose "postgres") and the evidence files to AWS.
  Everything currently in the AWS database is replaced. Accounts keep their usernames and passwords.

.EXAMPLE
  # from the repo root; Docker Desktop running and `npm run db:up` done
  .\infra\scripts\migrate-local-db.ps1
  .\infra\scripts\migrate-local-db.ps1 -SkipFiles      # database only
#>
[CmdletBinding()]
param(
  [switch]$SkipFiles,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TfDir = Join-Path $RepoRoot 'infra\terraform'

function Native([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv[0]) $($argv[1]) failed ($LASTEXITCODE)" }
}

# ---------- AWS side (from terraform outputs) ----------
Push-Location $TfDir
try {
  $cluster = terraform output -raw ecs_cluster
  $service = terraform output -raw ecs_app_service
  $dbtool = terraform output -raw dbtool_task_definition
  $bucket = terraform output -raw uploads_bucket
  $subnets = (terraform output -json task_subnets | ConvertFrom-Json) -join ','
  $sg = terraform output -raw task_security_group
  $region = (terraform output -json ecr_repositories | ConvertFrom-Json).api.Split('.')[3]
}
finally { Pop-Location }
if (-not $dbtool) { throw 'ไม่พบ dbtool_task_definition — รัน .\infra\scripts\deploy.ps1 -InfraOnly ก่อน' }

Push-Location $RepoRoot
try {
  # ---------- 1) local database ----------
  Write-Host '1) ตรวจฐานข้อมูลบนเครื่อง (docker compose postgres)' -ForegroundColor Cyan
  docker compose exec -T postgres pg_isready -U pas -d pas | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Postgres บนเครื่องไม่ได้รันอยู่ — เปิด Docker Desktop แล้วรัน npm run db:up' }
  $counts = docker compose exec -T postgres psql -U pas -d pas -tA -F ' | ' -c "select (select count(*) from employee) as employees, (select count(*) from local_credential where password_hash is not null) as with_password, (select count(*) from asset) as assets, (select count(*) from time_entry) as time_entries"
  Write-Host "   employees | with password | assets | time entries  =  $counts"
  docker compose exec -T postgres psql -U pas -d pas -tA -c "select email from employee where email like '%@pas.test' limit 3" | ForEach-Object {
    if ($_) { Write-Warning "พบผู้ใช้ทดสอบ ($_ …) — ข้อมูลทดสอบจาก db:seed จะถูกย้ายไปด้วย" }
  }

  Write-Warning "ข้อมูลทั้งหมดในฐานข้อมูลบน AWS (region $region) จะถูกแทนที่ด้วยฐานข้อมูลบนเครื่องนี้ และเว็บจะหยุดประมาณ 5–10 นาที"
  if (-not $Yes) {
    if ((Read-Host 'พิมพ์ YES เพื่อดำเนินการต่อ') -cne 'YES') { Write-Host 'ยกเลิก'; return }
  }

  $work = Join-Path $RepoRoot 'infra\.migrate'
  New-Item -ItemType Directory -Force $work | Out-Null
  $dump = Join-Path $work 'pas.dump'
  Native docker @('compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'pas', '-d', 'pas', '-Fc', '--no-owner', '--no-acl', '-f', '/tmp/pas.dump')
  Native docker @('compose', 'cp', 'postgres:/tmp/pas.dump', $dump)
  Write-Host ("   dump: {0:N1} MB" -f ((Get-Item $dump).Length / 1MB))

  # ---------- 2) upload to S3 (private bucket, short-lived link) ----------
  Write-Host '2) อัปโหลด dump ขึ้น S3' -ForegroundColor Cyan
  $key = "migrate/pas-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
  Native aws @('s3', 'cp', $dump, "s3://$bucket/$key", '--region', $region, '--only-show-errors', '--no-cli-pager')
  $url = aws s3 presign "s3://$bucket/$key" --expires-in 3600 --region $region --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or -not $url) { throw 's3 presign failed' }

  # ---------- 3) stop the portal so nothing writes during the restore ----------
  Write-Host '3) หยุด portal ชั่วคราว' -ForegroundColor Cyan
  Native aws @('ecs', 'update-service', '--region', $region, '--cluster', $cluster, '--service', $service, '--desired-count', '0', '--query', 'service.desiredCount', '--output', 'text', '--no-cli-pager')
  Native aws @('ecs', 'wait', 'services-stable', '--region', $region, '--cluster', $cluster, '--services', $service)

  # ---------- 4) restore inside the VPC ----------
  Write-Host '4) restore ลง RDS (2–5 นาที)' -ForegroundColor Cyan
  $restore = @'
set -e
DB="${DATABASE_URL%%\?*}"
apk add --no-cache curl >/dev/null
curl -fsSL -o /tmp/pas.dump "$DUMP_URL"
psql "$DB" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --no-owner --no-acl -d "$DB" /tmp/pas.dump || echo "pg_restore reported warnings (see above)"
psql "$DB" -v ON_ERROR_STOP=1 -q -c 'TRUNCATE "session";'
echo "employees: $(psql "$DB" -tAc 'select count(*) from employee')"
echo "accounts with password: $(psql "$DB" -tAc 'select count(*) from local_credential where password_hash is not null')"
test "$(psql "$DB" -tAc 'select count(*) from _prisma_migrations')" -gt 0
echo RESTORE_OK
'@
  $overrides = @{ containerOverrides = @(@{
        name        = 'dbtool'
        command     = @('sh', '-c', ($restore -replace "`r", ''))
        environment = @(@{ name = 'DUMP_URL'; value = "$url" })
      }) }
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, ($overrides | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
  $taskArn = aws ecs run-task --region $region --cluster $cluster --task-definition $dbtool `
    --capacity-provider-strategy capacityProvider=FARGATE,weight=1 `
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" `
    --overrides ('file://' + ($tmp -replace '\\', '/')) --query 'tasks[0].taskArn' --output text --no-cli-pager
  Remove-Item $tmp
  if ($LASTEXITCODE -ne 0 -or -not $taskArn -or $taskArn -eq 'None') { throw 'run-task failed' }
  aws ecs wait tasks-stopped --region $region --cluster $cluster --tasks $taskArn
  $exit = aws ecs describe-tasks --region $region --cluster $cluster --tasks $taskArn --query 'tasks[0].containers[0].exitCode' --output text --no-cli-pager
  $taskId = $taskArn.Split('/')[-1]
  aws logs get-log-events --region $region --log-group-name "/ecs/$cluster/jobs" --log-stream-name "jobs/dbtool/$taskId" --query 'events[].message' --output text --no-cli-pager

  aws s3 rm "s3://$bucket/$key" --region $region --only-show-errors --no-cli-pager | Out-Null
  if ($exit -ne '0') {
    Write-Warning "restore ไม่สำเร็จ (exit $exit) — portal ยังหยุดอยู่ ส่ง log ด้านบนให้ผู้ดูแล; เปิด portal กลับด้วย .\infra\scripts\pause.ps1 -Start"
    return
  }

  # ---------- 5) evidence files ----------
  $uploads = Join-Path $RepoRoot 'apps\api\var\uploads'
  if (-not $SkipFiles -and (Test-Path $uploads)) {
    Write-Host '5) คัดลอกไฟล์หลักฐาน (apps\api\var\uploads) ขึ้น S3' -ForegroundColor Cyan
    Native aws @('s3', 'sync', $uploads, "s3://$bucket/evidence/", '--region', $region, '--only-show-errors', '--no-cli-pager')
  }

  # ---------- 6) start the portal again (the API applies any newer migrations on start) ----------
  Write-Host '6) เปิด portal' -ForegroundColor Cyan
  Native aws @('ecs', 'update-service', '--region', $region, '--cluster', $cluster, '--service', $service, '--desired-count', '1', '--force-new-deployment', '--query', 'service.desiredCount', '--output', 'text', '--no-cli-pager')
  Write-Host ''
  Write-Host 'เสร็จแล้ว — portal จะกลับมาใน 2–4 นาที ผู้ใช้ล็อกอินด้วย username/รหัสผ่านเดิม (ทุกคนต้องล็อกอินใหม่)' -ForegroundColor Green
  Write-Host 'ลิงก์ตั้งรหัสผ่านที่เคยออกบนเครื่อง (localhost) ใช้ไม่ได้ — ออกลิงก์ใหม่จากหน้า พนักงานและสิทธิ์' -ForegroundColor Yellow
}
finally {
  Pop-Location
}
