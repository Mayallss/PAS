# Amazon Cognito as the portal's OIDC identity provider (the API speaks generic OIDC: OIDC_ISSUER etc.).
# The user pool is always created (free up to 10,000 MAU on the Lite tier); it is wired into the app only
# when domain_name is set, because Cognito accepts only https:// callback URLs (localhost excepted).
# Sign-in still requires a matching Employee e-mail in the portal database.

resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name}-users"
  user_pool_tier           = "LITE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"
  deletion_protection      = "INACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  admin_create_user_config {
    allow_admin_create_user_only = true # no self sign-up: HR/IT invites people
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 3
      max_length = 254
    }
  }
}

resource "random_string" "cognito_domain" {
  length  = 6
  special = false
  upper   = false
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${local.name}-${random_string.cognito_domain.result}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "portal" {
  count        = local.oidc_enabled ? 1 : 0
  name         = "${local.name}-portal"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.domain_name}/api/auth/callback"]
  logout_urls                          = ["https://${var.domain_name}/login"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  id_token_validity                    = 60
  access_token_validity                = 60
  refresh_token_validity               = 1
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}
