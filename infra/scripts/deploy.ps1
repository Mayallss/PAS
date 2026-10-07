<#
.SYNOPSIS
  Build the container images, push them to Amazon ECR and apply the Terraform stack.

.EXAMPLE
  # from the repo root, in PowerShell
  .\infra\scripts\deploy.ps1                 # build + push images, then terraform apply
  .\infra\scripts\deploy.ps1 -InfraOnly      # only terraform apply (no image build)
  The public-website image is built too when terraform.tfvars has enable_site = true.

  Needs: AWS CLI v2 (aws configure / aws sso login), Docker Desktop, Terraform >= 1.6.
#>
[CmdletBinding()]
param(
  [switch]$InfraOnly,
  [string]$Tag
)
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TfDir = Join-Path $RepoRoot 'infra\terraform'

function Need($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "ไม่พบคำสั่ง '$cmd' — ติดตั้งก่อน (ดู infra/DEPLOY-AWS.md)" }
}
function Run([string]$exe, [string[]]$argv) {
  Write-Host "> $exe $($argv -join ' ')" -ForegroundColor DarkGray
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}

Need aws; Need terraform
if (-not $InfraOnly) { Need docker }

$TfVars = Join-Path $TfDir 'terraform.tfvars'
if (-not (Test-Path $TfVars)) {
  throw "ยังไม่มี infra\terraform\terraform.tfvars — คัดลอกจาก terraform.tfvars.example แล้วแก้ alert_email ก่อน"
}
$WithSite = [bool](Select-String -Path $TfVars -Pattern '^\s*enable_site\s*=\s*true' -Quiet)

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'AWS CLI ยังไม่ได้ login (aws configure หรือ aws sso login)' }
Write-Host "AWS account: $($identity.Account)  ($($identity.Arn))" -ForegroundColor Cyan

Push-Location $TfDir
try {
  Run terraform @('init', '-input=false', '-upgrade')

  if (-not $InfraOnly) {
    # 1) ECR repositories first, so there is somewhere to push.
    Run terraform @('apply', '-input=false', '-auto-approve', '-target=aws_ecr_repository.app')
    $repos = terraform output -json ecr_repositories | ConvertFrom-Json
    $registry = ($repos.api -split '/')[0]
    $region = ($registry -split '\.')[3]

    if (-not $Tag) {
      # Unique per deploy: git short SHA (if this is a git repo) + timestamp.
      $sha = $null
      if (Get-Command git -ErrorAction SilentlyContinue) {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $sha = git -C $RepoRoot rev-parse --short HEAD 2>&1 | Where-Object { $_ -is [string] }
        if ($LASTEXITCODE -ne 0) { $sha = $null }
        $ErrorActionPreference = $prev
      }
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      $Tag = if ($sha) { "$sha-$stamp" } else { $stamp }
    }
    Write-Host "Image tag: $Tag" -ForegroundColor Cyan

    # 2) Build + push images (linux/amd64 = Fargate X86_64).
    # Docker login to ECR on Windows: two known traps give "400 Bad Request"
    #  - PowerShell adds a newline/encoding to text piped into native programs  -> pipe inside cmd.exe instead
    #  - Docker Desktop's Windows credential store can't hold long ECR tokens   -> use a private DOCKER_CONFIG
    #    without a credsStore (token is kept in infra\.docker\config.json, git-ignored, valid 12 h)
    $dockerCfg = Join-Path $RepoRoot 'infra\.docker'
    New-Item -ItemType Directory -Force $dockerCfg | Out-Null
    $cfgFile = Join-Path $dockerCfg 'config.json'
    if (-not (Test-Path $cfgFile)) { [IO.File]::WriteAllText($cfgFile, '{"auths":{}}') }
    $env:DOCKER_CONFIG = $dockerCfg
    cmd.exe /c "aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $registry"
    if ($LASTEXITCODE -ne 0) { throw 'docker login to ECR failed' }

    $targets = @('api', 'web')
    if ($WithSite) { $targets += 'site' }
    foreach ($t in $targets) {
      $image = "$($repos.$t):$Tag"
      Run docker @('build', '--platform', 'linux/amd64', '--target', $t, '-t', $image, $RepoRoot)
      Run docker @('push', $image)
    }

    # Remember the tag so a later plain `terraform apply` keeps the same images.
    "image_tag = `"$Tag`"" | Set-Content -Encoding ascii (Join-Path $TfDir 'image_tag.auto.tfvars')
  }

  # 3) Everything else (VPC, RDS, ECS, ALB, Cognito, Secrets, CloudWatch, Budgets).
  Run terraform @('apply', '-input=false', '-auto-approve')

  if (-not $InfraOnly) {
    # 4) Roll the services onto the newest task-definition revision (the one with the images just pushed).
    #    Terraform ignores the service's task definition so it never rolls back a GitHub Actions deploy.
    $cluster = terraform output -raw ecs_cluster
    Run aws @('ecs', 'update-service', '--region', $region, '--cluster', $cluster, '--service', "$cluster-app",
      '--task-definition', "$cluster-app", '--query', 'service.taskDefinition', '--output', 'text')
    if ($WithSite) {
      Run aws @('ecs', 'update-service', '--region', $region, '--cluster', $cluster, '--service', "$cluster-site",
        '--task-definition', "$cluster-site", '--query', 'service.taskDefinition', '--output', 'text')
    }
  }

  Write-Host ''
  Write-Host 'เสร็จแล้ว — ECS กำลังสตาร์ท task (รอ 2–5 นาที; ครั้งแรก RDS ใช้ ~10 นาที)' -ForegroundColor Green
  terraform output portal_url
  terraform output site_url
}
finally {
  Pop-Location
}
