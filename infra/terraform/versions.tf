terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # State is local (terraform.tfstate in this folder) — it contains the DB password, keep it private and out of git.
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name       = var.project
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)

  has_domain   = var.domain_name != ""
  app_origin   = local.has_domain ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
  site_enabled = var.enable_site
  # Without a domain the public site is served on ALB port 8080 (testing only).
  site_on_port = local.site_enabled && var.site_domain_name == ""
  oidc_enabled = local.has_domain && var.enable_cognito_login
}
