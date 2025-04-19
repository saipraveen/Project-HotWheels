# Define the AWS provider
provider "aws" {
  region = "ap-south-2"
}

# Check if the S3 bucket already exists
data "aws_s3_bucket" "existing_bucket" {
  bucket = "hotwheels-scraper-bucket"
  depends_on = [] # Ensure this data block runs without dependencies
}

# S3 Bucket to store scraped data
resource "aws_s3_bucket" "hotwheels_bucket" {
  bucket = "hotwheels-scraper-bucket"

  tags = {
    Name        = "HotWheelsScraperBucket"
    Environment = "Development"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [bucket]
  }

  count = data.aws_s3_bucket.existing_bucket.bucket != null ? 0 : 1
}

# S3 bucket ACL (separate resource as per deprecation warning)
resource "aws_s3_bucket_acl" "bucket_acl" {
  count = length(aws_s3_bucket.hotwheels_bucket) > 0 ? 1 : 0

  bucket = aws_s3_bucket.hotwheels_bucket[0].id
  acl    = "private"
}

resource "aws_s3_bucket_versioning" "hotwheels_bucket_versioning" {
  count = length(aws_s3_bucket.hotwheels_bucket) > 0 ? 1 : 0

  bucket = aws_s3_bucket.hotwheels_bucket[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

# Check if the IAM role already exists
data "aws_iam_role" "existing_lambda_role" {
  name = "hotwheels-lambda-role"
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "hotwheels-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [name]
  }

  count = length(data.aws_iam_role.existing_lambda_role.id) == 0 ? 1 : 0
}

# IAM Policy for Lambda to access S3, ECR, and CloudWatch Logs
resource "aws_iam_policy" "lambda_policy" {
  count = length(aws_s3_bucket.hotwheels_bucket) > 0 ? 1 : 0

  name        = "hotwheels-lambda-policy"
  description = "Policy for Lambda to access S3, ECR, and CloudWatch Logs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Effect = "Allow"
        Resource = [
          aws_s3_bucket.hotwheels_bucket[0].arn,
          "${aws_s3_bucket.hotwheels_bucket[0].arn}/*"
        ]
      },
      {
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Effect   = "Allow"
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Effect = "Allow"
        Resource = "*"
      }
    ]
  })
}

# Attach the policy to the role
resource "aws_iam_role_policy_attachment" "lambda_policy_attachment" {
  count = length(aws_iam_role.lambda_role) > 0 ? 1 : 0

  role       = aws_iam_role.lambda_role[0].name
  policy_arn = aws_iam_policy.lambda_policy[0].arn
}

# Check if ECR repository exists
data "aws_ecr_repository" "existing_repo" {
  name = "hotwheels-scraper"

  depends_on = []
}

# Create ECR Repository only if it doesn't exist
resource "aws_ecr_repository" "lambda_ecr_repo" {
  count = data.aws_ecr_repository.existing_repo.repository_url != null ? 0 : 1

  name = "hotwheels-scraper"
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Variable for Lambda image tag
variable "lambda_image_tag" {
  description = "Tag for the Lambda container image"
  type        = string
  default     = "latest"
}

# Add null_resource for Lambda cleanup
resource "null_resource" "lambda_cleanup" {
  triggers = {
    image_tag = var.lambda_image_tag
  }

  provisioner "local-exec" {
    command = "aws lambda delete-function --function-name hotwheels-scraper || true"
  }
}

# Updated Lambda Function to use container image with specific tag
resource "aws_lambda_function" "hotwheels_scraper" {
  function_name = "hotwheels-scraper"
  role          = coalesce(try(aws_iam_role.lambda_role[0].arn, null), "arn:aws:iam::760214176364:role/hotwheels-lambda-role")
  
  # Use container image with specific tag
  package_type  = "Image"
  image_uri     = "${coalesce(try(aws_ecr_repository.lambda_ecr_repo[0].repository_url, null), data.aws_ecr_repository.existing_repo.repository_url)}:${var.lambda_image_tag}"

  memory_size   = 256
  timeout       = 300

  environment {
    variables = {
      BUCKET_NAME = coalesce(try(aws_s3_bucket.hotwheels_bucket[0].bucket, null), "hotwheels-scraper-bucket")
      TOPIC_ARN   = aws_sns_topic.hotwheels_notifications.arn
    }
  }

  tags = {
    Name        = "HotWheelsScraperLambda"
    Environment = "Development"
  }

  depends_on = [aws_iam_role.lambda_role, aws_ecr_repository.lambda_ecr_repo, null_resource.lambda_cleanup]
}

# SNS Topic for notifications
resource "aws_sns_topic" "hotwheels_notifications" {
  name = "hotwheels-notifications"
}

# SNS Subscription (e.g., Email)
resource "aws_sns_topic_subscription" "email_subscription" {
  topic_arn = aws_sns_topic.hotwheels_notifications.arn
  protocol  = "email"
  endpoint  = "your-email@example.com" # Replace with your email
}

# CloudWatch Event Rule to trigger Lambda periodically
resource "aws_cloudwatch_event_rule" "schedule_rule" {
  name                = "hotwheels-schedule-rule"
  description         = "Trigger Lambda every day"
  schedule_expression = "rate(15 minutes)"
}

# CloudWatch Event Target to invoke Lambda
resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.schedule_rule.name
  target_id = "hotwheels-lambda"
  arn       = aws_lambda_function.hotwheels_scraper.arn
}

# Permission for CloudWatch to invoke Lambda
resource "aws_lambda_permission" "allow_cloudwatch" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.hotwheels_scraper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule_rule.arn
}