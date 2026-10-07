output "portal_url" {
  value = local.app_origin
}

output "site_url" {
  value = !local.site_enabled ? "(disabled — set enable_site = true)" : (var.site_domain_name != "" ? "https://${var.site_domain_name}" : "http://${aws_lb.main.dns_name}:8080")
}

output "alb_dns_name" {
  description = "Point your domain(s) here with a CNAME (or ALIAS at the apex)."
  value       = aws_lb.main.dns_name
}

output "acm_validation_records" {
  description = "Add these CNAME records at your DNS provider so the HTTPS certificate can be issued."
  value = local.has_domain ? [for o in aws_acm_certificate.main[0].domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }] : []
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_app_service" {
  value = aws_ecs_service.app.name
}

output "jobs_task_definition" {
  value = aws_ecs_task_definition.jobs.family
}

output "task_subnets" {
  value = aws_subnet.public[*].id
}

output "task_security_group" {
  value = aws_security_group.tasks.id
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.id
}

output "integrations_secret_name" {
  description = "Fill MONDAY_API_TOKEN / GOOGLE_SA_* here in the Secrets Manager console, then redeploy."
  value       = aws_secretsmanager_secret.integrations.name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_hosted_login_domain" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}
