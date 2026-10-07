resource "aws_lb" "main" {
  name                       = "${local.name}-alb"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  idle_timeout               = 120 # evidence uploads up to 20 MB
}

resource "aws_lb_target_group" "web" {
  name                 = "${local.name}-web"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/login"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "site" {
  count                = local.site_enabled ? 1 : 0
  name                 = "${local.name}-site"
  port                 = 3001
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path    = "/th"
    matcher = "200-399"
  }
}

# ---------- HTTPS (only with a domain) ----------
resource "aws_acm_certificate" "main" {
  count                     = local.has_domain ? 1 : 0
  domain_name               = var.domain_name
  subject_alternative_names = local.site_enabled && var.site_domain_name != "" ? [var.site_domain_name, "www.${var.site_domain_name}"] : []
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# Waits until you have added the CNAME records (output: acm_validation_records) at your DNS provider.
resource "aws_acm_certificate_validation" "main" {
  count           = local.has_domain ? 1 : 0
  certificate_arn = aws_acm_certificate.main[0].arn
  timeouts {
    create = "2h"
  }
}

resource "aws_lb_listener" "https" {
  count             = local.has_domain ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main[0].certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "site_host" {
  count        = local.has_domain && local.site_enabled && var.site_domain_name != "" ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10
  condition {
    host_header {
      values = [var.site_domain_name, "www.${var.site_domain_name}"]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.site[0].arn
  }
}

# ---------- HTTP ----------
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = local.has_domain ? [1] : []
    content {
      type = "redirect"
      redirect {
        protocol    = "HTTPS"
        port        = "443"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = local.has_domain ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }

  lifecycle {
    precondition {
      condition     = var.site_domain_name == "" || local.has_domain
      error_message = "site_domain_name needs domain_name as well (both share one HTTPS certificate)."
    }
  }
}

resource "aws_lb_listener" "site_port" {
  count             = local.site_on_port ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 8080
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.site[0].arn
  }
}
