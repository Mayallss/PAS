# ---------- ECR ----------
resource "aws_ecr_repository" "app" {
  for_each             = toset(["api", "web", "site"])
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}

# ---------- CloudWatch Logs ----------
resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "web", "site", "jobs"])
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

# ---------- cluster ----------
resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "disabled" # enhanced metrics cost extra; basic CPU/memory metrics are free
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }
}

locals {
  capacity_provider = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
  image             = { for k, r in aws_ecr_repository.app : k => "${r.repository_url}:${var.image_tag}" }

  log_config = { for k in ["api", "web", "site", "jobs"] : k => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.app[k].name
      awslogs-region        = var.region
      awslogs-stream-prefix = k
    }
  } }

  api_environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "API_HOST", value = "127.0.0.1" },
      { name = "API_PORT", value = "4000" },
      { name = "APP_ORIGIN", value = local.app_origin },
      { name = "TZ_BUSINESS", value = "Asia/Bangkok" },
      { name = "SESSION_TTL_HOURS", value = "10" },
      { name = "PASSWORD_LOGIN", value = "true" },
      { name = "AUTH_DEV_LOGIN", value = "false" },
      { name = "S3_BUCKET", value = aws_s3_bucket.uploads.id },
      { name = "AWS_REGION", value = var.region },
      { name = "OIDC_ALLOWED_DOMAIN", value = var.oidc_allowed_domain },
    ],
    local.oidc_enabled ? [
      { name = "OIDC_ISSUER", value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}" },
      { name = "OIDC_CLIENT_ID", value = aws_cognito_user_pool_client.portal[0].id },
      { name = "OIDC_REDIRECT_URI", value = "https://${var.domain_name}/api/auth/callback" },
    ] : []
  )

  app_secret_keys          = ["DATABASE_URL", "HANDOFF_LINK_SECRET", "OIDC_CLIENT_SECRET"]
  integrations_secret_keys = ["MONDAY_API_TOKEN", "GOOGLE_SA_EMAIL", "GOOGLE_SA_PRIVATE_KEY"]
  api_secrets = concat(
    [for k in local.app_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [for k in local.integrations_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.integrations.arn}:${k}::" }],
  )
}

# ---------- portal task: API + web in one task (they talk over localhost, the API is never exposed) ----------
resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name              = "api"
      image             = local.image["api"]
      essential         = true
      memoryReservation = 448
      environment       = local.api_environment
      secrets           = local.api_secrets
      logConfiguration  = local.log_config["api"]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 120 # migrations run before the API starts
      }
    },
    {
      name              = "web"
      image             = local.image["web"]
      essential         = true
      memoryReservation = 384
      portMappings      = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "API_INTERNAL_URL", value = "http://127.0.0.1:4000" },
      ]
      dependsOn        = [{ containerName = "api", condition = "HEALTHY" }]
      logConfiguration = local.log_config["web"]
    },
  ])
}

resource "aws_ecs_service" "app" {
  name                              = "${local.name}-app"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.app.arn
  desired_count                     = var.app_desired_count
  health_check_grace_period_seconds = 180
  enable_execute_command            = true
  propagate_tags                    = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = local.capacity_provider
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true # no NAT Gateway: needed to reach ECR / Secrets Manager / CloudWatch
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # New images are rolled out by GitHub Actions / deploy.ps1 (they register task-definition revisions);
  # Terraform must not roll the service back to the revision it last created.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.http, aws_ecs_cluster_capacity_providers.main]
}

# ---------- one-off jobs: seed / first admin (run with infra/scripts/*.ps1) ----------
resource "aws_ecs_task_definition" "jobs" {
  family                   = "${local.name}-jobs"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name             = "jobs"
    image            = local.image["api"]
    essential        = true
    command          = ["node", "-e", "console.log('override the command when running this task')"]
    environment      = local.api_environment
    secrets          = local.api_secrets
    logConfiguration = local.log_config["jobs"]
  }])
}

# ---------- public website (optional) ----------
resource "aws_ecs_task_definition" "site" {
  count                    = local.site_enabled ? 1 : 0
  family                   = "${local.name}-site"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.site_task[0].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "site"
    image        = local.image["site"]
    essential    = true
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "SITE_URL", value = var.site_domain_name != "" ? "https://${var.site_domain_name}" : "http://${aws_lb.main.dns_name}:8080" },
    ]
    logConfiguration = local.log_config["site"]
  }])
}

resource "aws_ecs_service" "site" {
  count                             = local.site_enabled ? 1 : 0
  name                              = "${local.name}-site"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.site[0].arn
  desired_count                     = 1
  health_check_grace_period_seconds = 60

  capacity_provider_strategy {
    capacity_provider = local.capacity_provider
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.site[0].arn
    container_name   = "site"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # New images are rolled out by GitHub Actions / deploy.ps1 (they register task-definition revisions);
  # Terraform must not roll the service back to the revision it last created.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.http, aws_ecs_cluster_capacity_providers.main]
}

# ---------- one-off DB tool (pg_dump / pg_restore) — used by infra/scripts/migrate-local-db.ps1 ----------
# RDS has no public endpoint, so restores run inside the VPC as a short-lived Fargate task.
resource "aws_ecs_task_definition" "dbtool" {
  family                   = "${local.name}-dbtool"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name             = "dbtool"
    image            = "public.ecr.aws/docker/library/postgres:16-alpine"
    essential        = true
    command          = ["sh", "-c", "echo override the command"]
    environment      = [{ name = "PGSSLMODE", value = "require" }]
    secrets          = [{ name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" }]
    logConfiguration = local.log_config["jobs"]
  }])
}
