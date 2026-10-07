<#
.SYNOPSIS
  Run a one-off job in AWS with the API image (same DB/secrets as the portal) and show its log.

.EXAMPLE
  # First administrator (prints a one-time set-password link)
  .\infra\scripts\run-job.ps1 -Job bootstrap-admin -Email you@pas-acc.com -Name "ชื่อ นามสกุล" -Username you

  # Fictional demo data (employee@pas.test …) — for a test environment only
  .\infra\scripts\run-job.ps1 -Job seed-demo
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('bootstrap-admin', 'seed-demo', 'migrate')][string]$Job,
  [string]$Email,
  [string]$Name,
  [string]$Username
)
$ErrorActionPreference = 'Stop'
$TfDir = (Resolve-Path (Join-Path $PSScriptRoot '..\terraform')).Path

Push-Location $TfDir
try {
  $cluster = terraform output -raw ecs_cluster
  $taskDef = terraform output -raw jobs_task_definition
  $subnets = (terraform output -json task_subnets | ConvertFrom-Json) -join ','
  $sg = terraform output -raw task_security_group
  $region = (terraform output -json ecr_repositories | ConvertFrom-Json).api.Split('.')[3]
}
finally { Pop-Location }

$extraEnv = @()
switch ($Job) {
  'bootstrap-admin' {
    if (-not $Email) { throw 'ใส่ -Email ของผู้ดูแลระบบคนแรก' }
    $cmd = 'cd /app/packages/db && node /app/node_modules/tsx/dist/cli.mjs prisma/bootstrap-admin.ts'
    $extraEnv += @{ name = 'BOOTSTRAP_EMAIL'; value = $Email }
    if ($Name) { $extraEnv += @{ name = 'BOOTSTRAP_NAME'; value = $Name } }
    if ($Username) { $extraEnv += @{ name = 'BOOTSTRAP_USERNAME'; value = $Username } }
  }
  'seed-demo' { $cmd = 'cd /app/packages/db && node ../../node_modules/prisma/build/index.js db seed' }
  'migrate' { $cmd = 'node /app/node_modules/prisma/build/index.js migrate deploy --schema /app/packages/db/prisma/schema.prisma' }
}

$overrides = @{ containerOverrides = @(@{ name = 'jobs'; command = @('sh', '-c', $cmd); environment = $extraEnv }) }
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, ($overrides | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
$fileUri = 'file://' + ($tmp -replace '\\', '/')

Write-Host "Starting job '$Job' on $cluster …" -ForegroundColor Cyan
$taskArn = aws ecs run-task --region $region --cluster $cluster --task-definition $taskDef `
  --capacity-provider-strategy capacityProvider=FARGATE,weight=1 `
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" `
  --overrides $fileUri --query 'tasks[0].taskArn' --output text
Remove-Item $tmp
if ($LASTEXITCODE -ne 0 -or -not $taskArn -or $taskArn -eq 'None') { throw 'run-task failed' }

Write-Host "Task: $taskArn — waiting for it to finish (1–3 min) …"
aws ecs wait tasks-stopped --region $region --cluster $cluster --tasks $taskArn
$exit = aws ecs describe-tasks --region $region --cluster $cluster --tasks $taskArn --query 'tasks[0].containers[0].exitCode' --output text
$taskId = $taskArn.Split('/')[-1]
$logGroup = "/ecs/$cluster/jobs"
Write-Host "--- log ($logGroup, stream jobs/jobs/$taskId) ---" -ForegroundColor Cyan
aws logs get-log-events --region $region --log-group-name $logGroup --log-stream-name "jobs/jobs/$taskId" --query 'events[].message' --output text
Write-Host "exit code: $exit" -ForegroundColor $(if ($exit -eq '0') { 'Green' } else { 'Red' })
