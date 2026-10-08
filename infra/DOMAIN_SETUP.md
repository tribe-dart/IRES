# IRES Custom Domain Setup (`iresglobal.com` & `www.iresglobal.com`)

This guide outlines configuring **`iresglobal.com`** and **`www.iresglobal.com`** directly with AWS CloudFront if you wish to use CloudFront in addition to or instead of Cloudflare.

---

## 1. Request SSL/TLS Certificate in AWS ACM (us-east-1)

CloudFront requires ACM certificates to be in `us-east-1` (N. Virginia):

```bash
aws cloudformation deploy \
  --template-file infra/certificate.yml \
  --stack-name iresglobal-certificate \
  --region us-east-1 \
  --parameter-overrides \
      DomainName=iresglobal.com \
      AlternativeDomainName=www.iresglobal.com
```

Add the generated CNAME validation records to your DNS provider until the status is `ISSUED`.

---

## 2. Deploy CloudFront with Custom Domain

Once the certificate is issued:

```bash
aws cloudformation deploy \
  --template-file infra/cloudfront-s3.yml \
  --stack-name iresglobal-frontend \
  --region eu-west-1 \
  --parameter-overrides \
      DomainName=iresglobal.com \
      AlternativeDomainName=www.iresglobal.com \
      AcmCertificateArn=<your-acm-arn-here> \
  --capabilities CAPABILITY_IAM
```

Retrieve your CloudFront Distribution Domain Name:
```bash
aws cloudformation describe-stacks \
  --stack-name iresglobal-frontend \
  --region eu-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" \
  --output text
```

---

## 3. Point DNS to CloudFront

In your DNS provider:
- **`www.iresglobal.com`**: CNAME to `<distribution-id>.cloudfront.net`
- **`iresglobal.com`**: ALIAS / ANAME / CNAME (flattened) to `<distribution-id>.cloudfront.net`
