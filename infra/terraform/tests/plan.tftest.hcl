mock_provider "aws" {
  mock_data "aws_availability_zones" { defaults = { names = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"] } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_iam_policy_document" { defaults = { json = "{}" } }
  mock_resource "aws_lb" { defaults = { dns_name = "pas-alb-1.ap-southeast-1.elb.amazonaws.com", arn = "arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:loadbalancer/app/pas-alb/abc" } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:pas/app-abc" } }
  mock_resource "aws_s3_bucket" { defaults = { arn = "arn:aws:s3:::pas-uploads-x", id = "pas-uploads-x" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/x" } }
  mock_resource "aws_ecr_repository" { defaults = { repository_url = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/pas/x" } }
  mock_resource "aws_acm_certificate" { defaults = { arn = "arn:aws:acm:ap-southeast-1:123456789012:certificate/x" } }
  mock_resource "aws_lb_listener" { defaults = { arn = "arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:listener/app/pas-alb/abc/def" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:targetgroup/pas-web/abc" } }
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:ap-southeast-1:123456789012:pas-alerts" } }
}
mock_provider "random" {}

run "no_domain" {
  command = apply
  variables { alert_email = "a@b.com" }
  assert {
    condition     = output.portal_url == "http://pas-alb-1.ap-southeast-1.elb.amazonaws.com"
    error_message = "origin"
  }
}

run "with_domain_site_cognito" {
  command = apply
  variables {
    alert_email      = "a@b.com"
    domain_name      = "portal.example.com"
    enable_site      = true
    site_domain_name = "example.com"
  }
  assert {
    condition     = length(aws_cognito_user_pool_client.portal) == 1 && length(aws_ecs_service.site) == 1
    error_message = "cognito/site"
  }
  assert {
    condition     = strcontains(aws_ecs_task_definition.app.container_definitions, "OIDC_ISSUER")
    error_message = "oidc env"
  }
}

run "site_without_domain_port" {
  command = apply
  variables {
    alert_email = "a@b.com"
    enable_site = true
  }
  assert {
    condition     = length(aws_lb_listener.site_port) == 1
    error_message = "8080"
  }
}

run "github_cicd_role" {
  command = apply
  variables {
    alert_email = "a@b.com"
    github_repo = "Mayallss/PAS"
  }
  assert {
    condition     = length(aws_iam_user.github_deploy) == 1 && length(aws_iam_openid_connect_provider.github) == 0
    error_message = "github user (default access_key mode)"
  }
}

run "github_oidc_mode" {
  command = apply
  variables {
    alert_email = "a@b.com"
    github_repo = "Mayallss/PAS"
    github_auth = "oidc"
  }
  assert {
    condition     = length(aws_iam_role.github_deploy) == 1 && length(aws_iam_user.github_deploy) == 0
    error_message = "github oidc role"
  }
}

run "n8n_open" {
  command = apply
  variables {
    alert_email     = "a@b.com"
    domain_name     = "portal.example.com"
    enable_n8n      = true
    n8n_domain_name = "n8n.example.com"
  }
  assert {
    condition     = length(aws_ecs_service.n8n) == 1 && length(aws_lb_listener_rule.n8n_open) == 1 && length(aws_lb_listener_rule.n8n_deny) == 0
    error_message = "n8n open"
  }
  assert {
    condition     = strcontains(aws_ecs_task_definition.n8n[0].container_definitions, "WEBHOOK_URL") && strcontains(aws_ecs_task_definition.n8n[0].container_definitions, "CREATE DATABASE n8n OWNER n8n")
    error_message = "n8n env / init script"
  }
  assert {
    condition     = strcontains(aws_ecs_task_definition.n8n_tool[0].container_definitions, "\"entryPoint\":[\"sh\",\"-c\"]") && strcontains(aws_ecs_task_definition.n8n[0].container_definitions, "N8N_BLOCK_ENV_ACCESS_IN_NODE")
    error_message = "n8n tool task / env block"
  }
}

run "n8n_editor_restricted" {
  command = apply
  variables {
    alert_email              = "a@b.com"
    domain_name              = "portal.example.com"
    enable_n8n               = true
    n8n_domain_name          = "n8n.example.com"
    n8n_editor_allowed_cidrs = ["203.0.113.10/32"]
  }
  assert {
    condition     = length(aws_lb_listener_rule.n8n_editor) == 1 && length(aws_lb_listener_rule.n8n_deny) == 1
    error_message = "n8n restricted"
  }
}

run "n8n_needs_domain" {
  command = plan
  variables {
    alert_email     = "a@b.com"
    enable_n8n      = true
    n8n_domain_name = "n8n.example.com"
  }
  expect_failures = [terraform_data.n8n_requirements]
}

run "n8n_no_cr_in_script" {
  command = apply
  variables {
    alert_email     = "a@b.com"
    domain_name     = "portal.example.com"
    enable_n8n      = true
    n8n_domain_name = "n8n.example.com"
  }
  assert {
    condition     = !strcontains(aws_ecs_task_definition.n8n[0].container_definitions, "\\r")
    error_message = "CR in init script"
  }
}
