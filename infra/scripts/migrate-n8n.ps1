<#
.SYNOPSIS
  Move the local n8n (Docker on this PC, SQLite) to n8n on AWS: workflows, credentials, data tables,
  users/owner, tags, variables. Execution history is not copied.
  Everything currently in the AWS n8n database is replaced.

  How: `n8n export:entities` in the local container -> one JSON bundle -> private S3 object (1 h link)
  -> one-off Fargate task `n8n import:entities` -> the AWS n8n uses the SAME encryption key as the local
  one (copied into Secrets Manager <project>/n8n), so saved credentials keep working.

.EXAMPLE
  # from the repo root; Docker Desktop running and the local n8n container started
  .\infra\scripts\migrate-n8n.ps1
  .\infra\scripts\migrate-n8n.ps1 -Container n8n      # local container name (default: n8n)
#>
[CmdletBinding()]
param(
  [string]$Container = 'n8n',
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TfDir = Join-Path $RepoRoot 'infra\terraform'

function Native([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv[0]) $($argv[1]) failed ($LASTEXITCODE)" }
}
# Run a native command whose failure / stderr is expected (PowerShell 5.1 + Stop would otherwise abort).
function Try-Native([scriptblock]$block) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $block 2>$null } finally { $ErrorActionPreference = $prev }
}
function WriteUtf8([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

# ---------- AWS side ----------
Push-Location $TfDir
try {
  $cluster = terraform output -raw ecs_cluster
  $tool = terraform output -raw n8n_tool_task_definition
  $bucket = terraform output -raw uploads_bucket
  $subnets = (terraform output -json task_subnets | ConvertFrom-Json) -join ','
  $sg = terraform output -raw task_security_group
  $region = (terraform output -json ecr_repositories | ConvertFrom-Json).api.Split('.')[3]
}
finally { Pop-Location }
if (-not $tool) { throw 'ยังไม่มี n8n บน AWS — ตั้ง enable_n8n = true ใน terraform.tfvars แล้วรัน .\infra\scripts\deploy.ps1 -InfraOnly ก่อน' }
$service = "$cluster-n8n"
$secretId = "$cluster/n8n"

# ---------- 1) local n8n ----------
Write-Host "1) ตรวจ n8n บนเครื่อง (container '$Container')" -ForegroundColor Cyan
$running = Try-Native { docker inspect -f '{{.State.Running}}' $Container }
if ($running -ne 'true') { throw "ไม่พบ container '$Container' ที่กำลังรัน — เปิด Docker Desktop แล้วสตาร์ท n8n บนเครื่องก่อน (หรือใส่ -Container <ชื่อ>)" }
$localVersion = (docker exec $Container n8n --version | Select-Object -Last 1).Trim()
$awsImage = aws ecs describe-task-definition --task-definition $tool --region $region --query "taskDefinition.containerDefinitions[?name=='n8n-tool'].image | [0]" --output text --no-cli-pager
Write-Host "   n8n บนเครื่อง: $localVersion    image บน AWS: $awsImage"
Try-Native { docker exec $Container n8n export:entities --help } | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "n8n บนเครื่อง ($localVersion) เก่าเกินไป ไม่มีคำสั่ง export:entities — อัปเดตก่อน: ในโฟลเดอร์ n8n รัน docker compose pull แล้ว docker compose up -d"
}
if (-not $awsImage.EndsWith(":$localVersion")) {
  Write-Warning "เวอร์ชันไม่ตรงกัน — ตั้ง n8n_image = `"n8nio/n8n:$localVersion`" ใน infra\terraform\terraform.tfvars แล้วรัน .\infra\scripts\deploy.ps1 -InfraOnly ก่อน แล้วค่อยรันสคริปต์นี้ใหม่"
  return
}

# Encryption key of the local n8n (env first, then the config file in the data folder). Never printed.
$key = (Try-Native { docker exec $Container printenv N8N_ENCRYPTION_KEY } | Out-String).Trim()
if (-not $key) {
  $cfg = Try-Native { docker exec $Container cat /home/node/.n8n/config } | Out-String
  if ($cfg) { $key = ($cfg | ConvertFrom-Json).encryptionKey }
}
if (-not $key) { throw 'หา encryption key ของ n8n บนเครื่องไม่เจอ (ทั้งใน env และ /home/node/.n8n/config)' }
$sha = [Security.Cryptography.SHA256]::Create()
$keyPrint = (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') })).Substring(0, 12)
Write-Host "   key fingerprint บนเครื่อง: $keyPrint (ต้องตรงกับ 'key fingerprint on AWS' ใน log ขั้นที่ 6)"

Write-Warning "ข้อมูลทั้งหมดใน n8n บน AWS จะถูกแทนที่ด้วย n8n บนเครื่องนี้ และ n8n บน AWS จะหยุดประมาณ 5 นาที"
if (-not $Yes) {
  if ((Read-Host 'พิมพ์ YES เพื่อดำเนินการต่อ') -cne 'YES') { Write-Host 'ยกเลิก'; return }
}

$work = Join-Path $RepoRoot 'infra\.migrate\n8n'
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force $work | Out-Null
try {
  # ---------- 2) export ----------
  Write-Host '2) export จาก n8n บนเครื่อง' -ForegroundColor Cyan
  Try-Native { docker exec $Container rm -rf /tmp/n8n-export } | Out-Null
  # Encrypt the export with the local key explicitly (same key is used for the import on AWS).
  Native docker @('exec', '-e', "MIGKEY=$key", $Container, 'sh', '-c', 'umask 077; printf %s "$MIGKEY" > /tmp/n8n-key')
  try {
    Native docker @('exec', $Container, 'n8n', 'export:entities', '--outputDir=/tmp/n8n-export', '--keyFile=/tmp/n8n-key')
  }
  finally { Try-Native { docker exec $Container rm -f /tmp/n8n-key } | Out-Null }
  Native docker @('cp', "${Container}:/tmp/n8n-export", $work)
  Try-Native { docker exec $Container rm -rf /tmp/n8n-export } | Out-Null
  $root = Join-Path $work 'n8n-export'
  $files = Get-ChildItem $root -Recurse -File
  if (-not $files) { throw 'export ไม่ได้ไฟล์ใดเลย' }
  $bundle = [ordered]@{}
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
    $bundle[$rel] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
  }
  $bundleFile = Join-Path $work 'bundle.json'
  WriteUtf8 $bundleFile ($bundle | ConvertTo-Json -Compress)
  Write-Host ("   {0} ไฟล์, {1:N1} MB" -f $files.Count, ((Get-Item $bundleFile).Length / 1MB))

  # ---------- 3) upload (private bucket, 1-hour link) ----------
  Write-Host '3) อัปโหลดขึ้น S3 ชั่วคราว' -ForegroundColor Cyan
  $s3key = "migrate/n8n-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
  Native aws @('s3', 'cp', $bundleFile, "s3://$bucket/$s3key", '--region', $region, '--only-show-errors', '--no-cli-pager')
  $url = aws s3 presign "s3://$bucket/$s3key" --expires-in 3600 --region $region --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or -not $url) { throw 's3 presign failed' }

  # ---------- 4) same encryption key on AWS ----------
  Write-Host '4) ตั้ง encryption key บน AWS ให้ตรงกับเครื่อง' -ForegroundColor Cyan
  $cur = aws secretsmanager get-secret-value --secret-id $secretId --region $region --query SecretString --output text --no-cli-pager | ConvertFrom-Json
  $cur.N8N_ENCRYPTION_KEY = $key
  $secretFile = Join-Path $work 'secret.json'
  WriteUtf8 $secretFile ($cur | ConvertTo-Json -Compress)
  try {
    Native aws @('secretsmanager', 'put-secret-value', '--secret-id', $secretId, '--secret-string', ('file://' + ($secretFile -replace '\\', '/')), '--region', $region, '--query', 'VersionId', '--output', 'text', '--no-cli-pager')
  }
  finally { Remove-Item -Force $secretFile -ErrorAction SilentlyContinue }

  # ---------- 5) stop n8n on AWS ----------
  Write-Host '5) หยุด n8n บน AWS ชั่วคราว' -ForegroundColor Cyan
  Native aws @('ecs', 'update-service', '--region', $region, '--cluster', $cluster, '--service', $service, '--desired-count', '0', '--query', 'service.desiredCount', '--output', 'text', '--no-cli-pager')
  Native aws @('ecs', 'wait', 'services-stable', '--region', $region, '--cluster', $cluster, '--services', $service)

  # ---------- 6) import inside the VPC ----------
  # RDS gives nobody superuser, so n8n cannot switch off foreign keys while importing (session_replication_role).
  # Instead the n8n role (owner of every table) drops its foreign keys first, keeps their definitions in
  # public._mig_fk, and adds them back after the import — the same effect, no superuser needed.
  Write-Host '6) import ลงฐานข้อมูล n8n บน AWS (3–6 นาที)' -ForegroundColor Cyan
  $connSh = @'
U="${ADMIN_URL%%\?*}"; HP="${U##*@}"; HP="${HP%%/*}"
export PGSSLMODE="${PGSSLMODE:-require}" PGHOST="${HP%%:*}" PGPORT="${HP##*:}" PGUSER=n8n PGPASSWORD="$N8N_DB_PASSWORD" PGDATABASE=n8n
'@
  $prepSh = @'
set -e
psql -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF to_regclass('public._mig_fk') IS NULL THEN CREATE TABLE public._mig_fk AS SELECT conrelid::regclass::text AS tbl, conname::text AS conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace; END IF; END \$\$;"
psql -v ON_ERROR_STOP=1 -qAt -c "SELECT format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I;', tbl, conname) FROM public._mig_fk" > /tmp/drop.sql
psql -v ON_ERROR_STOP=1 -q -f /tmp/drop.sql
echo "FK_DROPPED $(psql -tAc 'SELECT count(*) FROM public._mig_fk')"
'@
  $restoreSh = @'
set -e
if [ "$(psql -tAc "SELECT to_regclass('public._mig_fk') IS NOT NULL")" = "t" ]; then
  psql -v ON_ERROR_STOP=1 -qAt -c "SELECT format('ALTER TABLE %s ADD CONSTRAINT %I %s;', f.tbl, f.conname, f.def) FROM public._mig_fk f WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = f.conname AND c.conrelid = f.tbl::regclass)" > /tmp/add.sql
  psql -v ON_ERROR_STOP=1 -q -1 -f /tmp/add.sql
  psql -v ON_ERROR_STOP=1 -q -c 'DROP TABLE public._mig_fk'
fi
echo "FK_RESTORED $(psql -tAc "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace")"
'@
  function Invoke-ToolTask([string]$label, [string]$dbinitCmd, [string]$toolCmd, [object[]]$toolEnv) {
    $ov = @{ containerOverrides = @(
        @{ name = 'dbinit'; command = @('sh', '-c', ($dbinitCmd -replace "`r", '')) },  # postgres image: no sh -c entrypoint
        @{ name = 'n8n-tool'; command = @(($toolCmd -replace "`r", '')); environment = $toolEnv }
      ) }
    $f = Join-Path $work "overrides-$label.json"
    WriteUtf8 $f ($ov | ConvertTo-Json -Depth 6 -Compress)
    $arn = aws ecs run-task --region $region --cluster $cluster --task-definition $tool `
      --capacity-provider-strategy capacityProvider=FARGATE,weight=1 `
      --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" `
      --overrides ('file://' + ($f -replace '\\', '/')) --query 'tasks[0].taskArn' --output text --no-cli-pager
    if ($LASTEXITCODE -ne 0 -or -not $arn -or $arn -eq 'None') { throw "run-task ($label) failed" }
    aws ecs wait tasks-stopped --region $region --cluster $cluster --tasks $arn | Out-Null
    $id = $arn.Split('/')[-1]
    $codes = aws ecs describe-tasks --region $region --cluster $cluster --tasks $arn --query "tasks[0].containers[].[name,exitCode]" --output text --no-cli-pager
    foreach ($c in @('dbinit', 'n8n-tool')) {
      $stream = if ($c -eq 'dbinit') { "dbinit/dbinit/$id" } else { "tool/n8n-tool/$id" }
      Write-Host "--- $label / $c ---" -ForegroundColor DarkGray
      Try-Native { aws logs get-log-events --region $region --log-group-name "/ecs/$cluster/n8n" --log-stream-name $stream --query 'events[].message' --output text --no-cli-pager } | Out-Host
    }
    $ok = $true
    foreach ($line in @($codes)) { $p = "$line" -split '\s+'; if ($p.Count -ge 2 -and $p[1] -ne '0') { $ok = $false } }
    return $ok
  }

  $fetchJs = @'
const fs = require('fs'), path = require('path');
(async () => {
  const r = await fetch(process.env.BUNDLE_URL);
  if (!r.ok) throw new Error('download failed: HTTP ' + r.status);
  const bundle = await r.json();
  const dir = '/tmp/n8n-import';
  for (const [name, b64] of Object.entries(bundle)) {
    const target = path.resolve(dir, name);
    if (!target.startsWith(dir + path.sep)) throw new Error('bad file name in bundle: ' + name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(b64, 'base64'));
  }
  console.log('files written: ' + Object.keys(bundle).length);
})().catch((e) => { console.error(e.message); process.exit(1); });
'@
  $importCmd = 'set -e; node -e "$FETCH_JS"; umask 077; printf %s "$N8N_ENCRYPTION_KEY" > /tmp/n8n-key; echo "key fingerprint on AWS: $(node -e "$PRINT_JS")"; n8n import:entities --inputDir=/tmp/n8n-import --truncateTables=true --keyFile=/tmp/n8n-key --skipTogglingForeignKeyConstraints; echo IMPORT_OK'
  $importEnv = @(
    @{ name = 'BUNDLE_URL'; value = "$url" },
    @{ name = 'FETCH_JS'; value = ($fetchJs -replace "`r", '') },
    @{ name = 'PRINT_JS'; value = 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.N8N_ENCRYPTION_KEY || "").digest("hex").slice(0, 12))' }
  )
  $imported = Invoke-ToolTask 'import' ($connSh + "`n" + $prepSh) $importCmd $importEnv
  aws s3 rm "s3://$bucket/$s3key" --region $region --only-show-errors --no-cli-pager | Out-Null

  Write-Host '   คืนค่า foreign keys' -ForegroundColor Cyan
  $restored = Invoke-ToolTask 'restore-fk' ($connSh + "`n" + $restoreSh) 'echo done' @()

  if (-not $imported -or -not $restored) {
    Write-Warning "ไม่สำเร็จ (import=$imported, foreign keys=$restored) — n8n บน AWS ยังหยุดอยู่ ส่ง log ด้านบนให้ผู้ดูแล"
    Write-Warning "เปิด n8n กลับ: aws ecs update-service --cluster $cluster --service $service --desired-count 1 --region $region --no-cli-pager"
    return
  }

  # ---------- 7) start n8n again (picks up the new key) ----------
  Write-Host '7) เปิด n8n บน AWS' -ForegroundColor Cyan
  Native aws @('ecs', 'update-service', '--region', $region, '--cluster', $cluster, '--service', $service, '--desired-count', '1', '--force-new-deployment', '--query', 'service.desiredCount', '--output', 'text', '--no-cli-pager')
  Write-Host ''
  Write-Host 'เสร็จแล้ว — n8n บน AWS จะกลับมาใน 3–5 นาที ล็อกอินด้วยอีเมล/รหัสเดียวกับ n8n บนเครื่อง' -ForegroundColor Green
  Write-Host 'workflow ที่ย้ายมาอาจถูกปิดไว้ (inactive) — ตรวจแล้วกด Active ทีละตัว' -ForegroundColor Yellow
  Write-Host 'ก่อนเปิดบน AWS ให้ปิด (Deactivate) workflow บนเครื่องก่อน ไม่งั้น LINE จะถูกส่งซ้ำ 2 ที่' -ForegroundColor Yellow
}
finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
