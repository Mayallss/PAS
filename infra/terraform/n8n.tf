# n8n (workflow automation) on the same cluster, load balancer and PostgreSQL instance as the portal.
#
#   enable_n8n      = true
#   n8n_domain_name = "n8n.pas-acc.com"      # needs domain_name too (shares the HTTPS listener)
#
# - Own database "n8n" and login role "n8n" inside the existing RDS instance (created by a one-shot
#   init container on every start; idempotent). n8n cannot read the portal database.
# - Own certificate (attached to the existing HTTPS listener), so the portal certificate is never replaced.
# - Runs on regular Fargate (not Spot): an interrupted task would drop running workflows and webhooks.
# - Never runs two copies at once (min healthy 0 %): two schedulers on one database would run every
#   scheduled workflow twice. A deploy therefore means ~1–2 minutes of n8n downtime.
# - N8N_ENCRYPTION_KEY encrypts every credential saved in n8n. It lives in Secrets Manager (<project>/n8n);
#   losing it makes all saved credentials unreadable.

locals {
  # Everything below is created only when all three are set; n8n_requirements explains a missing one.
  n8n_enabled = var.enable_n8n && local.has_domain && var.n8n_domain_name != ""
  n8n_port    = 5678
  # Paths that must stay public even when the editor is limited to n8n_editor_allowed_cidrs.
  n8n_public_paths = ["/webhook/*", "/webhook-waiting/*", "/form/*", "/form-waiting/*"]
  n8n_restricted   = local.n8n_enabled && length(var.n8n_editor_allowed_cidrs) > 0
}

resource "terraform_data" "n8n_requirements" {
  count = var.enable_n8n ? 1 : 0
  lifecycle {
    precondition {
      condition     = local.has_domain && var.n8n_domain_name != ""
      error_message = "enable_n8n needs domain_name (the HTTPS listener) and n8n_domain_name."
    }
  }
}

# ---------- secrets ----------
resource "random_password" "n8n_db" {
  count   = local.n8n_enabled ? 1 : 0
  length  = 32
  special = false # embedded in SQL by the init container
}

resource "random_password" "n8n_encryption_key" {
  count   = local.n8n_enabled ? 1 : 0
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "n8n" {
  count                   = local.n8n_enabled ? 1 : 0
  name                    = "${local.name}/n8n"
  recovery_window_in_days = 7 # deleting it by mistake must stay recoverable: it holds the encryption key
}

resource "aws_secretsmanager_secret_version" "n8n" {
  count     = local.n8n_enabled ? 1 : 0
  secret_id = aws_secretsmanager_secret.n8n[0].id
  secret_string = jsonencode({
    N8N_ENCRYPTION_KEY = random_password.n8n_encryption_key[0].result
    DB_PASSWORD        = random_password.n8n_db[0].result
  })
  lifecycle {
    # Never rotate the encryption key by accident (e.g. after a state loss): saved credentials depend on it.
    ignore_changes = [secret_string]
  }
}

# ---------- logs ----------
resource "aws_cloudwatch_log_group" "n8n" {
  count             = local.n8n_enabled ? 1 : 0
  name              = "/ecs/${local.name}/n8n"
  retention_in_days = var.log_retention_days
}

# ---------- task ----------
locals {
  n8n_dbinit_container = {
    # Creates role + database "n8n" if missing and (re)sets the role password, then exits.
    name      = "dbinit"
    image     = "public.ecr.aws/docker/library/postgres:16-alpine"
    essential = false
    # replace(): this file may be checked out with Windows (CRLF) line endings; sh must not see the \r.
    command = ["sh", "-c", replace(<<-EOT
    set -e
    DB="$${ADMIN_URL%%\?*}"
    export PGSSLMODE=require
    psql "$DB" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n') THEN CREATE ROLE n8n LOGIN; END IF; END \$\$;"
    psql "$DB" -v ON_ERROR_STOP=1 -q -c "ALTER ROLE n8n WITH LOGIN PASSWORD '$N8N_DB_PASSWORD';"
    psql "$DB" -v ON_ERROR_STOP=1 -q -c "GRANT n8n TO CURRENT_USER;" 2>/dev/null || true
    if ! psql "$DB" -tAc "SELECT 1 FROM pg_database WHERE datname = 'n8n'" | grep -q 1; then
      psql "$DB" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE n8n OWNER n8n;"
    fi
    echo N8N_DB_READY
  EOT
    , "\r", "")]
    secrets = [
      { name = "ADMIN_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
      { name = "N8N_DB_PASSWORD", valueFrom = "${join("", aws_secretsmanager_secret.n8n[*].arn)}:DB_PASSWORD::" },
    ]
    logConfiguration = { logDriver = "awslogs", options = merge(local.n8n_log_options, { awslogs-stream-prefix = "dbinit" }) }
  }

  n8n_environment = [
    { name = "N8N_HOST", value = var.n8n_domain_name },
    { name = "N8N_PORT", value = tostring(local.n8n_port) },
    { name = "N8N_PROTOCOL", value = "https" },
    { name = "N8N_EDITOR_BASE_URL", value = "https://${var.n8n_domain_name}/" },
    { name = "WEBHOOK_URL", value = "https://${var.n8n_domain_name}/" },
    { name = "N8N_PROXY_HOPS", value = "1" },
    { name = "GENERIC_TIMEZONE", value = "Asia/Bangkok" },
    { name = "TZ", value = "Asia/Bangkok" },
    { name = "DB_TYPE", value = "postgresdb" },
    { name = "DB_POSTGRESDB_HOST", value = aws_db_instance.main.address },
    { name = "DB_POSTGRESDB_PORT", value = "5432" },
    { name = "DB_POSTGRESDB_DATABASE", value = "n8n" },
    { name = "DB_POSTGRESDB_USER", value = "n8n" },
    { name = "DB_POSTGRESDB_SSL_ENABLED", value = "true" },
    { name = "DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED", value = "false" }, # RDS CA is not in the image's trust store
    { name = "EXECUTIONS_DATA_PRUNE", value = "true" },
    { name = "EXECUTIONS_DATA_MAX_AGE", value = "336" }, # keep execution history 14 days
    { name = "N8N_DIAGNOSTICS_ENABLED", value = "false" },
    { name = "N8N_VERSION_NOTIFICATIONS_ENABLED", value = "false" },
    { name = "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS", value = "true" },
    { name = "N8N_RUNNERS_ENABLED", value = "true" },
    { name = "N8N_BLOCK_ENV_ACCESS_IN_NODE", value = "true" }, # Code nodes must not read the DB password from env
  ]

  n8n_secrets = [
    { name = "N8N_ENCRYPTION_KEY", valueFrom = "${join("", aws_secretsmanager_secret.n8n[*].arn)}:N8N_ENCRYPTION_KEY::" },
    { name = "DB_POSTGRESDB_PASSWORD", valueFrom = "${join("", aws_secretsmanager_secret.n8n[*].arn)}:DB_PASSWORD::" },
  ]

  n8n_log_options = {
    awslogs-group  = join("", aws_cloudwatch_log_group.n8n[*].name)
    awslogs-region = var.region
  }
}

resource "aws_ecs_task_definition" "n8n" {
  count                    = local.n8n_enabled ? 1 : 0
  family                   = "${local.name}-n8n"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    local.n8n_dbinit_container,
    {
      name             = "n8n"
      image            = var.n8n_image
      essential        = true
      portMappings     = [{ containerPort = local.n8n_port, protocol = "tcp" }]
      dependsOn        = [{ containerName = "dbinit", condition = "SUCCESS" }]
      environment      = local.n8n_environment
      secrets          = local.n8n_secrets
      logConfiguration = { logDriver = "awslogs", options = merge(local.n8n_log_options, { awslogs-stream-prefix = "n8n" }) }
    },
  ])
}

# One-off n8n CLI jobs (import / export) against the same database and key — used by infra/scripts/migrate-n8n.ps1.
resource "aws_ecs_task_definition" "n8n_tool" {
  count                    = local.n8n_enabled ? 1 : 0
  family                   = "${local.name}-n8n-tool"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    local.n8n_dbinit_container,
    {
      name             = "n8n-tool"
      image            = var.n8n_image
      essential        = true
      entryPoint       = ["sh", "-c"]
      command          = ["n8n --version"]
      dependsOn        = [{ containerName = "dbinit", condition = "SUCCESS" }]
      environment      = local.n8n_environment
      secrets          = local.n8n_secrets
      logConfiguration = { logDriver = "awslogs", options = merge(local.n8n_log_options, { awslogs-stream-prefix = "tool" }) }
    },
  ])
}

resource "aws_ecs_service" "n8n" {
  count                              = local.n8n_enabled ? 1 : 0
  name                               = "${local.name}-n8n"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.n8n[0].arn
  desired_count                      = 1
  health_check_grace_period_seconds  = 300 # first start runs n8n's database migrations
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.n8n[0].arn
    container_name   = "n8n"
    container_port   = local.n8n_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener_rule.n8n_open, aws_lb_listener_rule.n8n_editor, aws_ecs_cluster_capacity_providers.main]

}

# ---------- network ----------
resource "aws_vpc_security_group_ingress_rule" "tasks_n8n" {
  count                        = local.n8n_enabled ? 1 : 0
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = local.n8n_port
  to_port                      = local.n8n_port
  ip_protocol                  = "tcp"
}

resource "aws_lb_target_group" "n8n" {
  count                = local.n8n_enabled ? 1 : 0
  name                 = "${local.name}-n8n"
  port                 = local.n8n_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# ---------- HTTPS certificate (separate from the portal's, added to the same listener) ----------
resource "aws_acm_certificate" "n8n" {
  count             = local.n8n_enabled ? 1 : 0
  domain_name       = var.n8n_domain_name
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "n8n" {
  count           = local.n8n_enabled ? 1 : 0
  certificate_arn = aws_acm_certificate.n8n[0].arn
  timeouts {
    create = "2h"
  }
}

resource "aws_lb_listener_certificate" "n8n" {
  count           = local.n8n_enabled ? 1 : 0
  listener_arn    = aws_lb_listener.https[0].arn
  certificate_arn = aws_acm_certificate_validation.n8n[0].certificate_arn
}

# ---------- routing: n8n.<domain> → n8n ----------
# Without n8n_editor_allowed_cidrs: one rule, everything open (n8n's own login protects the editor).
# With it: webhooks/forms stay public, the editor answers only those IP ranges, everyone else gets 403.
resource "aws_lb_listener_rule" "n8n_open" {
  count        = local.n8n_enabled ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20
  condition {
    host_header {
      values = [var.n8n_domain_name]
    }
  }
  dynamic "condition" {
    for_each = local.n8n_restricted ? [1] : []
    content {
      path_pattern {
        values = local.n8n_public_paths
      }
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.n8n[0].arn
  }
  depends_on = [aws_lb_listener_certificate.n8n]
}

resource "aws_lb_listener_rule" "n8n_editor" {
  count        = local.n8n_restricted ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 21
  condition {
    host_header {
      values = [var.n8n_domain_name]
    }
  }
  condition {
    source_ip {
      values = var.n8n_editor_allowed_cidrs
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.n8n[0].arn
  }
}

resource "aws_lb_listener_rule" "n8n_deny" {
  count        = local.n8n_restricted ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 22
  condition {
    host_header {
      values = [var.n8n_domain_name]
    }
  }
  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

# ---------- outputs ----------
output "n8n_url" {
  value = local.n8n_enabled ? "https://${var.n8n_domain_name}" : "(disabled — set enable_n8n = true)"
}

output "n8n_acm_validation_records" {
  description = "Add these CNAME records at your DNS provider so the n8n HTTPS certificate can be issued."
  value = local.n8n_enabled ? [for o in aws_acm_certificate.n8n[0].domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }] : []
}

output "n8n_tool_task_definition" {
  value = local.n8n_enabled ? aws_ecs_task_definition.n8n_tool[0].family : ""
}
