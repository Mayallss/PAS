<#
.SYNOPSIS
  Save credits when nobody uses the portal: stop the ECS tasks and the RDS instance, or start them again.
  ALB (~$0.55/day) and storage are still billed while paused. RDS restarts itself after 7 days stopped.

.EXAMPLE
  .\infra\scripts\pause.ps1 -Stop
  .\infra\scripts\pause.ps1 -Start
#>
[CmdletBinding()]
param([switch]$Stop, [switch]$Start)
$ErrorActionPreference = 'Stop'
if ($Stop -eq $Start) { throw 'ใช้ -Stop หรือ -Start อย่างใดอย่างหนึ่ง' }

Push-Location (Join-Path $PSScriptRoot '..\terraform')
try {
  $cluster = terraform output -raw ecs_cluster
  $service = terraform output -raw ecs_app_service
  $db = (terraform output -raw db_endpoint).Split('.')[0]
  $region = (terraform output -json ecr_repositories | ConvertFrom-Json).api.Split('.')[3]
}
finally { Pop-Location }

if ($Stop) {
  aws ecs update-service --region $region --cluster $cluster --service $service --desired-count 0 --query 'service.desiredCount' | Out-Null
  aws rds stop-db-instance --region $region --db-instance-identifier $db --query 'DBInstance.DBInstanceStatus'
  Write-Host 'หยุดแล้ว (ECS tasks = 0, RDS stopping)' -ForegroundColor Yellow
}
else {
  aws rds start-db-instance --region $region --db-instance-identifier $db --query 'DBInstance.DBInstanceStatus'
  Write-Host 'รอ RDS พร้อม (~5 นาที) …'
  aws rds wait db-instance-available --region $region --db-instance-identifier $db
  aws ecs update-service --region $region --cluster $cluster --service $service --desired-count 1 --query 'service.desiredCount' | Out-Null
  Write-Host 'เปิดแล้ว — portal พร้อมใน 2–3 นาที' -ForegroundColor Green
}
