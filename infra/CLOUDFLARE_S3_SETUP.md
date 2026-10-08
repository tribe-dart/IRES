# Cloudflare CDN + AWS S3 Website Setup for IRES (`iresglobal.com`)

Your static website is hosted in **AWS S3** and will be live at:
`http://iresglobal-frontend-628711466156.s3-website-eu-west-1.amazonaws.com`

By placing **Cloudflare CDN** in front of this bucket, you get:
- Free automated SSL/TLS certificate (`https://iresglobal.com`).
- Lightning-fast global CDN edge caching.
- Zero CloudFront account verification restrictions.
- CNAME flattening at apex `iresglobal.com`.
- Automatic `www` to apex 301 redirection.

---

## Step 1: Add DNS Records in Cloudflare

In your **Cloudflare Dashboard** under **DNS** > **Records**, add or update the following records:

| Type | Name | Target | Proxy Status | TTL |
| :--- | :--- | :--- | :--- | :--- |
| **CNAME** | `@` *(or iresglobal.com)* | `iresglobal.com.s3-website-eu-west-1.amazonaws.com` | **Proxied (Orange Cloud)** | Auto |
| **CNAME** | `www` | `iresglobal.com.s3-website-eu-west-1.amazonaws.com` | **Proxied (Orange Cloud)** | Auto |

---

## Step 2: Configure Cloudflare SSL/TLS

1. In Cloudflare, navigate to **SSL/TLS** > **Overview**.
2. Set the encryption mode to **Flexible** *(this encrypts traffic between visitors and Cloudflare with HTTPS, while Cloudflare connects to the S3 website endpoint)*.
3. In **SSL/TLS** > **Edge Certificates**, toggle **Always Use HTTPS** to **ON**.

---

## Step 3: Canonical Redirect (`www` → apex)

To automatically redirect visitors from `www.iresglobal.com` to `iresglobal.com`:

1. In Cloudflare, navigate to **Rules** > **Redirect Rules**.
2. Click **Create rule**.
3. **Rule name:** `Redirect www to root`
4. **When incoming requests match:** Custom filter expression
   - Field: `Hostname`
   - Operator: `equals`
   - Value: `www.iresglobal.com`
5. **Then redirect to:**
   - Type: `Dynamic`
   - Expression: `concat("https://iresglobal.com", http.request.uri.path)`
   - Status code: `301` (Moved Permanently)
   - Preserve query string: Checked
6. Click **Deploy**.

---

## Step 4: Verification

Once the DNS records are saved:
- Visit **`https://iresglobal.com`** — it will load your IRES application securely over HTTPS.
- Visit **`https://www.iresglobal.com`** — it will redirect cleanly to `https://iresglobal.com`.
