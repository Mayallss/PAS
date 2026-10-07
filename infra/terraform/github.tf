# GitHub Actions → AWS without long-lived keys (OIDC). The workflow .github/workflows/deploy.yml assumes this
# role to push images to ECR and roll out new task definitions. It cannot change infrastructure (that stays
# with Terraform run by a person), so a leaked workflow can at most deploy a different image.

variable "github_repo" {
  description = "owner/repo allowed to deploy, e.g. Mayallss/PAS. Empty = no GitHub role."
  type        = string
  default     = ""
}

variable "github_deploy_branch" {
  type    = string
  default = "main"
}

variable "create_github_oidc_provider" {
  description = "false if this AWS account already has the token.actions.githubusercontent.com provider."
  type        = bool
  default     = true
}

locals {
  github_enabled = var.github_repo != ""
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = local.github_enabled && var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = local.github_enabled && !var.create_github_oidc_provider ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = !local.github_enabled ? "" : (
    var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

data "aws_iam_policy_document" "github_assume" {
  count = local.github_enabled ? 1 : 0
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only the deploy branch, or a job running in the protected "production" environment.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/${var.github_deploy_branch}",
        "repo:${var.github_repo}:environment:production",
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  count                = local.github_enabled ? 1 : 0
  name                 = "${local.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume[0].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  count = local.github_enabled ? 1 : 0

  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
    ]
    resources = [for r in aws_ecr_repository.app : r.arn]
  }
  statement {
    sid       = "TaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:TagResource"]
    resources = ["*"] # RegisterTaskDefinition does not support resource-level permissions
  }
  statement {
    sid     = "RollOutServices"
    actions = ["ecs:UpdateService", "ecs:DescribeServices"]
    resources = concat(
      [aws_ecs_service.app.id],
      local.site_enabled ? [aws_ecs_service.site[0].id] : [],
    )
  }
  statement {
    sid     = "PassTaskRoles"
    actions = ["iam:PassRole"]
    resources = concat(
      [aws_iam_role.execution.arn, aws_iam_role.app_task.arn],
      local.site_enabled ? [aws_iam_role.site_task[0].arn] : [],
    )
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  count  = local.github_enabled ? 1 : 0
  name   = "deploy-images"
  role   = aws_iam_role.github_deploy[0].id
  policy = data.aws_iam_policy_document.github_deploy[0].json
}

output "github_deploy_role_arn" {
  description = "GitHub repo → Settings → Secrets and variables → Actions → Variables: AWS_DEPLOY_ROLE_ARN"
  value       = local.github_enabled ? aws_iam_role.github_deploy[0].arn : "(set github_repo in terraform.tfvars)"
}
