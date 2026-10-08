import subprocess
import time
import sys
import json

PROFILE = "william_tribedart"
REGION = "eu-west-1"
BUCKET = "iresglobal.com"
WWW_BUCKET = "www.iresglobal.com"
REPO = "tribe-dart/IRES"

def run_cmd(args):
    print(f"Running: {' '.join(args)}")
    res = subprocess.run(args, capture_output=True, text=True)
    return res

def try_create_bucket(bucket_name):
    cmd = [
        "aws", "s3api", "create-bucket",
        "--bucket", bucket_name,
        "--region", REGION,
        "--create-bucket-configuration", f"LocationConstraint={REGION}",
        "--profile", PROFILE
    ]
    res = run_cmd(cmd)
    if res.returncode == 0:
        print(f"Successfully created bucket: {bucket_name}")
        return True
    else:
        err = res.stderr.strip()
        print(f"Failed to create {bucket_name}: {err}")
        return False

def configure_website_bucket(bucket_name):
    print(f"Configuring public access and website hosting on {bucket_name}...")
    
    # Disable block public access
    run_cmd([
        "aws", "s3api", "put-public-access-block",
        "--bucket", bucket_name,
        "--public-access-block-configuration",
        "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false",
        "--profile", PROFILE
    ])

    # Enable website hosting
    run_cmd([
        "aws", "s3api", "put-bucket-website",
        "--bucket", bucket_name,
        "--website-configuration",
        json.dumps({
            "IndexDocument": {"Suffix": "index.html"},
            "ErrorDocument": {"Key": "404.html"}
        }),
        "--profile", PROFILE
    ])

    # Apply public read bucket policy
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "PublicReadForWebsite",
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{bucket_name}/*"
            }
        ]
    }
    run_cmd([
        "aws", "s3api", "put-bucket-policy",
        "--bucket", bucket_name,
        "--policy", json.dumps(policy),
        "--profile", PROFILE
    ])

def configure_redirect_bucket(bucket_name, target_host):
    print(f"Configuring {bucket_name} to redirect to {target_host}...")
    run_cmd([
        "aws", "s3api", "put-public-access-block",
        "--bucket", bucket_name,
        "--public-access-block-configuration",
        "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false",
        "--profile", PROFILE
    ])
    run_cmd([
        "aws", "s3api", "put-bucket-website",
        "--bucket", bucket_name,
        "--website-configuration",
        json.dumps({
            "RedirectAllRequestsTo": {
                "HostName": target_host,
                "Protocol": "https"
            }
        }),
        "--profile", PROFILE
    ])

def sync_files():
    print("Syncing static files to S3...")
    cmd = [
        "aws", "s3", "sync", ".", f"s3://{BUCKET}",
        "--profile", PROFILE,
        "--exclude", ".git/*",
        "--exclude", ".github/*",
        "--exclude", "infra/*",
        "--exclude", "tmp/*",
        "--exclude", "tools/*",
        "--exclude", "*.md"
    ]
    res = run_cmd(cmd)
    print(res.stdout)

def update_gh_secret():
    print(f"Updating GitHub secret S3_BUCKET_NAME to {BUCKET}...")
    subprocess.run(["gh", "secret", "set", "S3_BUCKET_NAME", "--body", BUCKET, "-R", REPO])

def main():
    wait_mode = "--wait" in sys.argv
    print(f"Attempting to setup {BUCKET} in AWS Account for profile {PROFILE}...")
    
    while True:
        if try_create_bucket(BUCKET):
            break
        if not wait_mode:
            print(f"\nBucket {BUCKET} is still in AWS release cooldown.")
            print("Run with '--wait' (python tools/setup-bucket.py --wait) to poll until released.")
            sys.exit(1)
        print("Cooldown in progress. Retrying in 60 seconds...")
        time.sleep(60)

    configure_website_bucket(BUCKET)
    sync_files()
    update_gh_secret()

    # Attempt to setup www redirect bucket as well
    if try_create_bucket(WWW_BUCKET):
        configure_redirect_bucket(WWW_BUCKET, BUCKET)

    print("\n=======================================================")
    print("SUCCESS! Bucket created, website configured, files synced, and GitHub Actions secret updated.")
    print(f"Website endpoint: http://{BUCKET}.s3-website-{REGION}.amazonaws.com")
    print("=======================================================")

if __name__ == "__main__":
    main()
