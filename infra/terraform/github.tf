# GitHub Actions → AWS. Two ways, same permissions (push images to ECR + roll out task definitions; it cannot
# change infrastructure, so a leaked credential can at most deploy a different image):
#  - github_auth = "access_key" (default): an IAM user whose key goes into GitHub secrets. Needed on the new
#    AWS free-plan / project accounts, whose SCP blocks iam:CreateOpenIDConnectProvider.
#  - github_auth = "oidc": no stored keys; GitHub assumes a role via OIDC (preferred where allowed).

variable "github_repo" {
  description = "owner/repo allowed to deploy, e.g. Mayallss/PAS. Empty = no GitHub role."
  type        = string
  default     = ""
}

variable "github_deploy_branch" {
  type    = string
  default = "main"
}

variable "github_auth" {
  description = "access_key or oidc"
  type        = string
  default     = "access_key"
  validation {
    condition     = contains(["access_key", "oidc"], var.github_auth)
    error_message = "github_auth must be access_key or oidc."
  }
}

variable "create_github_oidc_provider" {
  description = "false if this AWS account already has the token.actions.githubusercontent.com provider."
  type        = bool
  default     = true
}

locals {
  github_enabled = var.github_repo != ""
  github_oidc    = local.github_enabled && var.github_auth == "oidc"
  github_key     = local.github_enabled && var.github_auth == "access_key"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = local.github_oidc && var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = local.github_oidc && !var.create_github_oidc_provider ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = !local.github_oidc ? "" : (
    var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

data "aws_iam_policy_document" "github_assume" {
  count = local.github_oidc ? 1 : 0
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
  count                = local.github_oidc ? 1 : 0
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
  count  = local.github_oidc ? 1 : 0
  name   = "deploy-images"
  role   = aws_iam_role.github_deploy[0].id
  policy = data.aws_iam_policy_document.github_deploy[0].json
}

# ---------- access-key mode ----------
resource "aws_iam_user" "github_deploy" {
  count = local.github_key ? 1 : 0
  name  = "${local.name}-github-deploy"
}

resource "aws_iam_user_policy" "github_deploy" {
  count  = local.github_key ? 1 : 0
  name   = "deploy-images"
  user   = aws_iam_user.github_deploy[0].name
  policy = data.aws_iam_policy_document.github_deploy[0].json
}

# The secret ends up in terraform.tfstate (git-ignored). Rotate: terraform apply -replace='aws_iam_access_key.github_deploy[0]'
resource "aws_iam_access_key" "github_deploy" {
  count = local.github_key ? 1 : 0
  user  = aws_iam_user.github_deploy[0].name
}

output "github_deploy_role_arn" {
  description = "OIDC mode: GitHub → Settings → Secrets and variables → Actions → Variables: AWS_DEPLOY_ROLE_ARN"
  value       = local.github_oidc ? aws_iam_role.github_deploy[0].arn : ""
}

output "github_access_key_id" {
  description = "Access-key mode: GitHub → Actions secrets: AWS_ACCESS_KEY_ID"
  value       = local.github_key ? aws_iam_access_key.github_deploy[0].id : ""
}

output "github_secret_access_key" {
  description = "Access-key mode: GitHub → Actions secrets: AWS_SECRET_ACCESS_KEY  (terraform output -raw github_secret_access_key)"
  value       = local.github_key ? aws_iam_access_key.github_deploy[0].secret : ""
  sensitive   = true
}
