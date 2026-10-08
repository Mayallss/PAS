variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "pas"
}

variable "region" {
  description = "AWS region. ap-southeast-1 (Singapore) is the closest full-service region to Bangkok."
  type        = string
  default     = "ap-southeast-1"
}

variable "alert_email" {
  description = "E-mail for budget and CloudWatch alarms (confirm the SNS subscription e-mail AWS sends)."
  type        = string
}

variable "monthly_budget_usd" {
  description = "AWS Budgets limit; alerts at 50%, 80%, 100% actual and 100% forecast."
  type        = number
  default     = 40
}

variable "image_tag" {
  description = "Container image tag pushed to ECR (deploy script sets this to the git short SHA or a timestamp)."
  type        = string
  default     = "latest"
}

# ---------- domain / HTTPS (optional) ----------
variable "domain_name" {
  description = "Portal host name, e.g. portal.pas-acc.com. Empty = HTTP only on the ALB DNS name (testing)."
  type        = string
  default     = ""
}

variable "site_domain_name" {
  description = "Public website host name, e.g. pas-acc.com. Empty = site on ALB port 8080 (when enable_site)."
  type        = string
  default     = ""
}

variable "enable_site" {
  description = "Run the public website (apps/site). Off by default to save credits (~$9/month)."
  type        = bool
  default     = false
}

variable "enable_cognito_login" {
  description = "Wire Cognito as the OIDC provider (needs domain_name: Cognito only allows https callbacks)."
  type        = bool
  default     = true
}

variable "oidc_allowed_domain" {
  description = "Only accept SSO e-mails from this domain (e.g. pas-acc.com). Empty = any."
  type        = string
  default     = ""
}

# ---------- sizing ----------
variable "use_fargate_spot" {
  description = "Run tasks on Fargate Spot (~70% cheaper; AWS may restart a task with 2 min notice)."
  type        = bool
  default     = true
}

variable "app_desired_count" {
  description = "Portal tasks (API + web). 0 = stopped (no Fargate cost; ALB/RDS still billed)."
  type        = number
  default     = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_deletion_protection" {
  description = "Set true once real data lives in the database."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 7
}

# ---------- n8n (optional, see n8n.tf) ----------
variable "enable_n8n" {
  description = "Run n8n on the cluster (needs domain_name and n8n_domain_name)."
  type        = bool
  default     = false
}

variable "n8n_domain_name" {
  description = "n8n host name, e.g. n8n.pas-acc.com."
  type        = string
  default     = ""
}

variable "n8n_image" {
  description = "n8n container image. Pin a version (e.g. n8nio/n8n:1.123.4) to control upgrades; a new tag = an upgrade on the next apply."
  type        = string
  default     = "n8nio/n8n:latest"
}

variable "n8n_editor_allowed_cidrs" {
  description = "Limit the n8n editor/UI to these IP ranges (e.g. [\"203.0.113.10/32\"] = office IP). Webhooks and forms stay public. Empty = open."
  type        = list(string)
  default     = []
}
