terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region  = "eu-west-1"
  profile = "william_tribedart"
}

variable "resend_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

data "archive_file" "enquiry" {
  type        = "zip"
  source_file = "${path.module}/../../api/enquiry/index.mjs"
  output_path = "${path.module}/enquiry.zip"
}

resource "random_password" "rate_salt" {
  length  = 32
  special = false
}

resource "aws_dynamodb_table" "enquiries" {
  name         = "ires_website_enquiries"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "phone"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "PhoneIndex"
    hash_key        = "phone"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Application = "ires-website"
  }
}

resource "aws_dynamodb_table" "rate" {
  name         = "ires_website_rate"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Application = "ires-website"
  }
}

resource "aws_sqs_queue" "retry" {
  name                       = "ires-enquiry-crm-retry"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
}

resource "aws_sns_topic" "failures" {
  name = "ires-enquiry-failures"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "enquiry" {
  name               = "ires-website-enquiry"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "enquiry" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:eu-west-1:*:*"]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      aws_dynamodb_table.enquiries.arn,
      "${aws_dynamodb_table.enquiries.arn}/index/*",
      aws_dynamodb_table.rate.arn,
      "arn:aws:dynamodb:eu-west-1:622211271637:table/ires_crm_contacts",
    ]
  }

  statement {
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.retry.arn]
  }

  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.failures.arn]
  }
}

resource "aws_iam_role_policy" "enquiry" {
  name   = "ires-website-enquiry"
  role   = aws_iam_role.enquiry.id
  policy = data.aws_iam_policy_document.enquiry.json
}

resource "aws_lambda_function" "enquiry" {
  function_name = "ires-website-enquiry"
  role          = aws_iam_role.enquiry.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  filename      = data.archive_file.enquiry.output_path
  source_code_hash = data.archive_file.enquiry.output_base64sha256
  timeout       = 20
  memory_size   = 256

  environment {
    variables = {
      ENQUIRIES_TABLE       = aws_dynamodb_table.enquiries.name
      CONTACTS_TABLE        = "ires_crm_contacts"
      RATE_TABLE            = aws_dynamodb_table.rate.name
      RETRY_QUEUE_URL       = aws_sqs_queue.retry.url
      ALERT_TOPIC_ARN       = aws_sns_topic.failures.arn
      RATE_SALT             = random_password.rate_salt.result
      PRIVACY_VERSION       = "2026-10-26"
      MAIL_FROM        = "IRES <contact@iresglobal.com>"
      NOTIFY_EMAIL     = "contact@iresglobal.com"
      RESEND_API_KEY   = var.resend_api_key
      TURNSTILE_SECRET = ""
    }
  }
}

resource "aws_lambda_event_source_mapping" "retry" {
  event_source_arn = aws_sqs_queue.retry.arn
  function_name    = aws_lambda_function.enquiry.arn
  batch_size       = 1
}

resource "aws_cloudwatch_event_rule" "retry" {
  name                = "ires-enquiry-retry"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "retry" {
  rule = aws_cloudwatch_event_rule.retry.name
  arn  = aws_lambda_function.enquiry.arn
}

resource "aws_lambda_permission" "retry_schedule" {
  statement_id  = "AllowEventBridgeRetry"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.enquiry.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.retry.arn
}

resource "aws_apigatewayv2_api" "enquiry" {
  name          = "ires-website-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [
      "https://iresglobal.com",
      "https://www.iresglobal.com",
      "http://localhost:8765",
      "http://127.0.0.1:8765",
    ]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 86400
  }
}

resource "aws_apigatewayv2_integration" "enquiry" {
  api_id                 = aws_apigatewayv2_api.enquiry.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.enquiry.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "enquiry" {
  api_id    = aws_apigatewayv2_api.enquiry.id
  route_key = "POST /enquiries"
  target    = "integrations/${aws_apigatewayv2_integration.enquiry.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.enquiry.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.enquiry.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.enquiry.execution_arn}/*/*"
}

output "enquiries_url" {
  value = "${aws_apigatewayv2_api.enquiry.api_endpoint}/enquiries"
}
