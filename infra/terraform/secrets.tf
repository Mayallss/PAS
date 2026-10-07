# Two secrets (~$0.40 each per month):
#  - <project>/app          managed by Terraform (DB URL, link-signing secret, Cognito client secret)
#  - <project>/integrations filled in by you in the console (monday.com, Google Calendar); Terraform never overwrites it

resource "random_password" "handoff_link_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  recovery_window_in_days = 0 # allow terraform destroy + re-create without the 7–30 day wait
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL        = local.database_url
    HANDOFF_LINK_SECRET = random_password.handoff_link_secret.result
    OIDC_CLIENT_SECRET  = local.oidc_enabled ? aws_cognito_user_pool_client.portal[0].client_secret : ""
  })
}

resource "aws_secretsmanager_secret" "integrations" {
  name                    = "${local.name}/integrations"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "integrations" {
  secret_id = aws_secretsmanager_secret.integrations.id
  secret_string = jsonencode({
    MONDAY_API_TOKEN      = ""
    GOOGLE_SA_EMAIL       = ""
    GOOGLE_SA_PRIVATE_KEY = ""
  })
  lifecycle {
    ignore_changes = [secret_string]
  }
}
