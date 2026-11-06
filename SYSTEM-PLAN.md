# IRES System Plan

## Status & Evolution

Updated on 6 November 2026 to incorporate feedback and requirements from Richard's **"IRES Website v2 — Backend Brief" (4 Nov 2026)** while maintaining complete respect and fidelity to the existing AWS architecture, static site, and internal CRM.

The enquiry path is live in AWS account `622211271637`, region `eu-west-1` (Ireland), profile `william_tribedart`. The contact form stores a lead in DynamoDB, syncs with the internal CRM (`ires_crm_contacts`), and triggers sales alerts via Resend from `contact@iresglobal.com`.

- **Website API**: `POST https://2s128tbbya.execute-api.eu-west-1.amazonaws.com/enquiries`
- **Website Table**: DynamoDB `ires_website_enquiries` (store-before-notify master record)
- **CRM Table**: DynamoDB `ires_crm_contacts` (sales pipeline)
- **CRM Dashboard**: `https://crm.iresglobal.com`
- **CRM API**: `https://api-crm.iresglobal.com`
- **Transactional Mail**: Resend (from `contact@iresglobal.com`, domain verified in DNS)

---

## Alignment with Manager's Backend Brief (4 Nov 2026)

The brief provides recommendations designed for a small, fast, static site and an enquiry-driven sales pipeline. As stated in the brief (Page 3):
> *"These are recommendations, chosen for fit with a small team and a small site. Where the team already has strong experience in an alternative, swap it in. Keep the shape of the architecture and the rules in the rest of this brief."*

Our implementation keeps the exact architecture, guarantees, and contracts of the brief using the established AWS infrastructure:

| Brief Recommendation | Implemented Stack | Justification & Compatibility |
|---|---|---|
| **Front end**: Next.js static / Astro | **Static HTML5 / CSS / Vanilla JS** | Zero hydration overhead, instant load on mobile in Ghana, runs without node server. |
| **Hosting & CDN**: Cloudflare Pages / S3 | **AWS S3 + Cloudflare CDN** | S3 origin with Cloudflare global edge network, SSL, and caching. |
| **Enquiry API**: Cloudflare Workers / Lambda | **AWS Lambda (`nodejs22.x`)** | Serverless edge API in `eu-west-1`, HTTP API Gateway, zero servers to patch. |
| **Database**: Supabase / Postgres | **AWS DynamoDB (`ires_website_enquiries`)** | Master leads record with point-in-time recovery (30 days), GSIs for deduplication, and encrypted at rest. |
| **Email**: Postmark / Resend | **Resend** | High delivery, simple REST API, domain authenticated via SPF/DKIM/DMARC. |
| **CRM**: Internal CRM | **IRES Internal CRM** | Direct adapter writing to DynamoDB `ires_crm_contacts` and EC2 API. Deduplication by phone number. |
| **Spam Protection**: Turnstile + Honeypot | **Cloudflare Turnstile + Honeypot** | Silent honeypot return on `website` / `company_website`, Turnstile token verification on submit. |

---

## Key Decisions & Guardrails Implemented

### 1. Location & Address Policy (Brief Decision #12)
- **Decision**: Publish the city only: **Accra, Ghana**. No street address.
- **Implemented**: The Cantonments office address (`54, 5th Circular Road`) and embedded maps have been removed from `index.html`, `privacy.html`, structured data, and auto-reply templates.

### 2. Content Guardrails & Banned Phrases (Brief Page 11 & 28)
- **Banned phrases**: "solar-powered pump" and "terms vary" are forbidden. Cleaned from `index.html` (updated to "solar water pumping" and "solar water delivery").
- **Finance options**: Strictly four options in fixed order:
  1. Developer finance
  2. Interest-free payment plans
  3. Milestone billing
  4. Mortgage with banking partners
- **Place names**: Verified place names only (Prampram, Aburi, Komenda, Kumasi, Accra, Tamale).
- **Automated Check**: `tools/guardrail-check.js` validates all guardrails on build and pull request.

### 3. Canonical Slugs & Legacy Hash Redirects (Brief Page 24 & 25)
- Canonical sections on the homepage:
  - `#about-ires` (Our Philosophy & About)
  - `#why-ires` (Why IRES?)
  - `#how-we-create-value` (How We Create Value)
  - `#what-we-build` (What We Build)
  - `#ways-to-own` (Ways to Own)
  - `#start` (Start Your Build / Contact)
- A 15-line synchronous redirect script in `<head>` maps historical bookmark hashes (`#why-rammed-earth`, `#solutions`, `#who-we-build-for`, `#finance`, `#about`, `#contact`, `#top`) instantly before first paint.
- `#start` and `#contact` automatically smooth-scroll to the enquiry form and focus the name input.

### 4. Enquiry API Response Contract (Brief Page 14)
The Lambda endpoint adheres strictly to the API contract:

| HTTP Status | Response Body | Frontend Behaviour |
|---|---|---|
| **201** | `{"id": "..."}` | Shows Thank You message, shifts focus, dispatches `enquiry_sent` analytics event. |
| **400** | `{"errors": [{"field": "phone", "message": "..."}]}` | Displays validation error messages under respective fields. |
| **429** | `{"message": "Too many attempts, please try again later or message us on WhatsApp"}` | Renders rate limit alert with direct WhatsApp button. |
| **500** | `{"fallback": "whatsapp"}` | Shows fallback state with WhatsApp button, preserving entered text. |

- **Body Size Limit**: Rejects non-POST and payloads > 10 KB with status 413.
- **Honeypot**: Hidden `website` field; returns silent 201 and stores nothing.
- **Rate Limit**: Max 5 submissions per 10 minutes and max 20 per hour per IP.
- **Privacy Hashing**: Client IP addresses are cryptographically hashed (`sha256(RATE_SALT + ip)`); raw IP addresses are never saved in DynamoDB or logged.
- **Non-JS Graceful Fallback**: URL-encoded submissions answer with 303 redirect to `/thank-you`.

### 5. Sales Email Notification (Brief Page 16)
- **Subject**: `New enquiry: {plan} from {name}`
- **Body Content**:
  - Name
  - Phone with tap-to-call (`tel:...`) and tap-to-WhatsApp (`https://wa.me/...`)
  - Where will you build (location)
  - Plan type
  - Page submitted from
  - Time in Accra (`Africa/Accra` timezone)
  - CRM link (`https://crm.iresglobal.com`)

### 6. Cookieless Analytics (Brief Page 18 & 19)
Tracks 10 standardized events without personal data or cookies:
1. `reveal_open`: `section` (slug)
2. `hotspot_click`: `id` (1 to 6)
3. `request_call_click`: `location`
4. `start_build_click`: `location`
5. `form_open`: `page`
6. `enquiry_sent`: `plan`, `page`
7. `enquiry_error`: `status`
8. `whatsapp_click`: `location`
9. `phone_click`: `location`
10. `scroll_start_section`: `{}`

### 7. Data Protection & Legal Pages
- **Consent Wording**: `"I agree that IRES may contact me about my enquiry."` (Version `2026-11-v1`).
- **Privacy Policy (`privacy.html`)**: Plain English (< 800 words), fully compliant with Ghana’s Data Protection Act, 2012 (Act 843).
- **Cookie Policy (`cookie-policy.html`)**: Declares zero tracking cookies and technical session storage only.
- **Thank You Page (`thank-you.html`)**: Non-JS fallback, marked `noindex`.
- **404 Page (`404.html`)**: Real 404 status with navigation to Home and Contact.
- **Security & Crawlers**: `robots.txt`, `sitemap.xml`, and `.well-known/security.txt`.

---

## Build Verification Checklist

Run guardrail and validation tests locally:
```bash
node tools/guardrail-check.js
node tools/test-enquiry-validation.js
```
