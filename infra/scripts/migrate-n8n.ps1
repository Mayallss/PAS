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
  Native docker @('exec', $Container, 'n8n', 'export:entities', '--outputDir=/tmp/n8n-export')
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
  Write-Host '6) import ลงฐานข้อมูล n8n บน AWS (2–5 นาที)' -ForegroundColor Cyan
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
  $cmd = 'set -e; node -e "$FETCH_JS"; n8n import:entities --inputDir=/tmp/n8n-import --truncateTables=true || { echo "--- import:entities --help ---"; n8n import:entities --help; exit 1; }; echo IMPORT_OK'
  $overrides = @{ containerOverrides = @(@{
        name        = 'n8n-tool'
        command     = @($cmd)
        environment = @(
          @{ name = 'BUNDLE_URL'; value = "$url" },
          @{ name = 'FETCH_JS'; value = ($fetchJs -replace "`r", '') }
        )
      }) }
  $tmp = Join-Path $work 'overrides.json'
  WriteUtf8 $tmp ($overrides | ConvertTo-Json -Depth 6 -Compress)
  $taskArn = aws ecs run-task --region $region --cluster $cluster --task-definition $tool `
    --capacity-provider-strategy capacityProvider=FARGATE,weight=1 `
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" `
    --overrides ('file://' + ($tmp -replace '\\', '/')) --query 'tasks[0].taskArn' --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or -not $taskArn -or $taskArn -eq 'None') { throw 'run-task failed' }
  aws ecs wait tasks-stopped --region $region --cluster $cluster --tasks $taskArn
  $exit = aws ecs describe-tasks --region $region --cluster $cluster --tasks $taskArn --query "tasks[0].containers[?name=='n8n-tool'].exitCode | [0]" --output text --no-cli-pager
  $taskId = $taskArn.Split('/')[-1]
  Write-Host "--- log (/ecs/$cluster/n8n, tool/n8n-tool/$taskId) ---" -ForegroundColor DarkGray
  aws logs get-log-events --region $region --log-group-name "/ecs/$cluster/n8n" --log-stream-name "tool/n8n-tool/$taskId" --query 'events[].message' --output text --no-cli-pager

  aws s3 rm "s3://$bucket/$s3key" --region $region --only-show-errors --no-cli-pager | Out-Null
  if ($exit -ne '0') {
    Write-Warning "import ไม่สำเร็จ (exit $exit) — n8n บน AWS ยังหยุดอยู่ ส่ง log ด้านบนให้ผู้ดูแล"
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
