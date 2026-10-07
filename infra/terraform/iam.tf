data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:${var.region}:${local.account_id}:*"]
    }
  }
}

# ---------- execution role: used by ECS itself (pull image, write logs, inject secrets) ----------
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.integrations.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ---------- task role: what the application code may do (least privilege) ----------
resource "aws_iam_role" "app_task" {
  name               = "${local.name}-app-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "app_task" {
  statement {
    sid       = "EvidenceFilesWriteOnceRead"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/evidence/*"]
  }
  statement {
    sid       = "EcsExec"
    actions   = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "app_task" {
  name   = "app"
  role   = aws_iam_role.app_task.id
  policy = data.aws_iam_policy_document.app_task.json
}

# The public website needs no AWS permissions at all.
resource "aws_iam_role" "site_task" {
  count              = local.site_enabled ? 1 : 0
  name               = "${local.name}-site-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}
