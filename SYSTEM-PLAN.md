# IRES system plan

## Status

The enquiry path is live in AWS account `622211271637`, region `eu-west-1`, profile `william_tribedart`. The contact form saves a lead and creates a CRM contact at 15% (Inquiry). Mail is sent with Resend from `contact@iresglobal.com`. The API key stays in `.env` and on the Lambda. It is not committed.

- API: `POST https://2s128tbbya.execute-api.eu-west-1.amazonaws.com/enquiries`
- Website copy: DynamoDB `ires_website_enquiries`
- CRM copy: written straight into `ires_crm_contacts`, which is the table the dashboard already reads
- Each enquiry emails the IRES team and, when the visitor gave an email address, sends them a confirmation

The CRM dashboard was left open on purpose. It has no login, so requiring a secret on every CRM route would lock the sales team out. The public site does not call the CRM API. It calls the website API only.

`iresglobal.com` must be a verified domain in Resend, with the DNS records Resend provides added in Cloudflare. Until that verification is in place, Resend refuses mail from `contact@iresglobal.com`.

Adapted from the 21 Oct 2026 backend brief to the two applications that already exist. The brief’s job is unchanged: keep the marketing site fast, let no enquiry disappear, and hand every lead to the sales team.

This plan does not rebuild the site on Vercel, Sanity, or HubSpot. Those were options in the brief. IRES already has a static site and a CRM on AWS. Equivalent tools are what the brief allows when the team already runs them.

| | |
|---|---|
| AWS profile | `william_tribedart` (the profile on this machine; referred to as tribedart-william) |
| Region | `eu-west-1` (Ireland) |
| Website repo | this repository, `iresglobal.com` |
| CRM repo | `C:\Users\PC\Documents\GitHub\iresglobal-crm` |
| Website | `https://iresglobal.com` |
| CRM app | `https://crm.iresglobal.com` |
| CRM API | `https://api-crm.iresglobal.com` |

## What stays

**Website.** Static HTML, CSS, and JavaScript in an S3 website bucket, with Cloudflare in front for HTTPS and the CDN. GitHub Actions on `main` syncs the bucket with the `william_tribedart` credentials. Pages are already pre-built, which is the performance outcome the brief asked Next.js for. A framework rewrite is not part of launch.

**CRM.** This is the sales system. Do not add HubSpot or Zoho.

- Dashboard on S3: `crm.iresglobal.com`
- API on the existing EC2 instance, Node 22, Express, PM2 process `ires-crm-backend`, Nginx on port 5002
- DynamoDB: `ires_crm_contacts`, `ires_crm_quotes`, `ires_crm_questionnaires`
- Attachments bucket: `ires-crm-attachments-65ppow`
- Lead sources the API already accepts include `website`

A new website enquiry enters the CRM at stage `15%` (Inquiry). Later CRM stages stay as they are:

| Brief stage | CRM stage |
|---|---|
| New | `15%` Inquiry |
| Contacted, consultation booked | `15%`, with the activity recorded on the contact |
| Proposal sent | `50%` Discovery / proposal |
| Quote issued | `75%` |
| Won | `100%` Contract signed |
| Lost | Not in the CRM yet. Add a closed-lost state in the CRM before launch so lost work is not stuck at 15%. |

## What the brief changes

The public form currently opens the visitor’s mail app and sends nothing to the CRM. That is the gap this plan closes.

The brief also asks for a copy of every lead that does not depend on the CRM call succeeding. On AWS that copy is a new DynamoDB table, not Postgres. The CRM remains the place sales works. The new table is the safety copy and the retry queue.

Staff-editable pages (a CMS, drafts, scheduled publish) are a later phase. Launch does not block on Sanity or Strapi. Until that phase, content changes stay in this repository.

The brief says the public site has no street address. The contact page now shows 54, 5th Circular Road, Cantonments, Accra, and `+233 20 966 9000`, `contact@iresglobal.com`. Keep those. Do not add a map embed unless IRES asks for one.

## How an enquiry moves

```text
Visitor on iresglobal.com
        |
        |  HTTPS via Cloudflare
        v
Static site (S3)
        |
        |  POST /enquiries
        |  Turnstile token + form fields
        v
API Gateway  -->  Lambda (ires-website-enquiry)
        |                 |
        |                 |  1. Validate
        |                 |  2. Check Turnstile
        |                 |  3. Rate limit
        |                 |  4. Save our copy first
        |                 v
        |           DynamoDB ires_website_enquiries
        |                 |
        |                 |  5. Create or update the CRM contact
        |                 v
        |           CRM API  -->  DynamoDB ires_crm_contacts
        |                 |
        |                 |  6. Email the owner and the visitor
        |                 v
        |           Resend
        |           from contact@iresglobal.com
        |
        If step 5 fails: leave the row as pending.
        SQS retries it. After 3 failures, SNS emails the developer.
        The visitor still gets a success response. The lead is already saved.
```

The browser never calls `api-crm.iresglobal.com` directly. The CRM API currently allows any origin and does not require a key, including on the contact list. Before the form goes live:

- The Lambda calls the CRM with a shared secret header.
- The CRM rejects contact writes and all contact reads that lack that secret, except the health check.
- CORS on the CRM allows only `https://crm.iresglobal.com`.
- The website API allows only `https://iresglobal.com`.

## Form and lead record

Grow the current form toward the brief’s fields. Name, email or phone, project type, site, and message stay. Add the rest only when IRES has named an owner for each enquiry type.

| Brief field | Launch form | Stored |
|---|---|---|
| enquiry_type | Project type already on the form. Map the four options to `home`, `commercial`, `development`, `not_sure`. | Both tables |
| location | Site location, required | Both |
| name | Required | Both |
| email, phone | At least one required. Phone stored in E.164. Default country code `+233`. | Both |
| message | Required. Stored in CRM `notes`. | Both |
| country_of_residence | Add. Flags diaspora leads. | Website table, and CRM notes until the contact record has a field for it |
| preferred_contact | Add: WhatsApp, call, or email | Both |
| consent | Unticked checkbox, time, and privacy-policy version | Website table |
| services, finance_preference, timeline, has_land, budget_range | After launch, once IRES sets the budget ranges | Website table; summary copied into CRM notes |
| source | Page URL, referrer, UTM tags. Filled in by the page, not the visitor. | Website table |

Server-side rules from the brief:

- Validate again in the Lambda. The browser check is not enough.
- Cloudflare Turnstile, plus a hidden honeypot field.
- At most 5 submissions from one IP in an hour.
- Same email or same phone within 30 days updates the existing lead. It does not create a second CRM contact.
- Assign an owner from enquiry type. The names are an open question below. Until they exist, notify `contact@iresglobal.com`.
- Email that owner immediately. Email the visitor a short confirmation with the next three steps and a WhatsApp link to `+233209669000`.
- If the CRM call fails, keep the DynamoDB row and retry. Tell the developer after the third failure.

WhatsApp on the page is a `wa.me` link. No WhatsApp Business API at launch.

## AWS pieces to add

All of these use profile `william_tribedart` in `eu-west-1`. Prefer a small Terraform directory in this repo, the same way the CRM already uses Terraform. Do not put secrets in git.

| Piece | Name | Purpose |
|---|---|---|
| DynamoDB table | `ires_website_enquiries` | Our copy of every enquiry. Partition key `id`. GSIs on email and on phone so the 30-day update rule can find the earlier row. |
| Lambda | `ires-website-enquiry` | Validate, save, sync to CRM, send mail |
| HTTP API | `ires-website-api` | `POST /enquiries` only |
| SQS queue | `ires-enquiry-crm-retry` | CRM retries |
| SNS topic | `ires-enquiry-failures` | Developer alert after 3 failed CRM syncs |
| Resend | verified domain `iresglobal.com` | Owner alert and visitor auto-reply. The API key lives in `.env` and on the Lambda. |
| Secrets Manager | `ires/website/prod` | CRM shared secret and Turnstile secret, when those are added |
| Cloudflare Turnstile | widget on the contact form | Bot check with no puzzle |

Mail goes out through Resend, from the enquiry Lambda. The call is `POST https://api.resend.com/emails`. The API key is a send-only key. It stays in `.env` locally and in the Lambda environment. It is not stored in git.

`iresglobal.com` must be verified in Resend. Add the SPF and DKIM records Resend shows to the Cloudflare DNS zone. Until that verification succeeds, Resend will not deliver from `contact@iresglobal.com`.

The CRM contact write should set `source` to `website`, `stage` to `15%`, and `nextSteps` to “Read the enquiry and reply within one business day.” Extra brief fields that the CRM contact type does not have yet go in `notes` as labelled lines, so sales can read them without a schema change on day one. Add real fields on the CRM contact when the same data needs to be filtered.

## Privacy and access

Ghana’s Data Protection Act, 2012 (Act 843) applies. UK or EU visitors can also bring GDPR into play. This plan is not legal advice. A lawyer should confirm the policy before launch.

- Privacy policy and terms on the site. The consent box links to the policy and starts unticked.
- Collect only the fields in the table above. Budget stays optional.
- Say in the policy that enquiries are stored on AWS in Ireland and are shared with the IRES CRM and with Resend, which sends the email.
- Suggested retention, unless IRES chooses another period: delete or anonymise leads with no contact for 24 months.
- HTTPS only. The Cloudflare zone should send HSTS.
- No enquiry contents in analytics, in the page URL, or in Lambda log lines.
- Two-factor authentication on the AWS account, Cloudflare, the domain registrar, GitHub, and the CRM.
- Editors do not get AWS or CRM admin. Sales uses the CRM and does not edit the website. The agency deploys code and does not browse production leads unless IRES asks for a specific debug.
- Backups: DynamoDB point-in-time recovery on both the new enquiries table and the three CRM tables. Restore once on a copy before launch. Keep that recovery window at 30 days.

## Build order

1. **Lock the CRM API.** Shared secret, tighter CORS, and a closed-lost stage. Deploy through the CRM repo’s existing GitHub Action.
2. **Create the website table, API, Lambda, and queue** in `eu-west-1` with `william_tribedart`. Verify `iresglobal.com` in Resend and keep the API key out of git.
3. **Point the contact form at `POST /enquiries`.** Remove the “open the visitor’s mail app” behaviour. Show a clear success or error on the page.
4. **Turn on Turnstile, the honeypot, and the rate limit.** Prove a sixth submission from the same IP is rejected, and that a failed CRM call still leaves a row in `ires_website_enquiries`.
5. **Send the two emails** from `contact@iresglobal.com` through Resend after the domain’s SPF and DKIM records pass. Staging sends only to the team.
6. **Publish the privacy policy** and the unticked consent box. Submit the sitemap in Search Console. Add the Organization and `HomeAndConstructionBusiness` structured data with service area Ghana.
7. **Train one IRES editor** with a one-page note: how a lead appears in the CRM, and how to reply.

Staging is a second API stage and a second DynamoDB table, not a second EC2 instance. The staging site can be a Cloudflare preview or a private S3 prefix. It must not email real visitors.

## Explicitly later

- A CMS so IRES staff can edit page copy, projects, FAQs, and finance options without a developer. Revisit this when the copy is changing often. Do not start it before the form is saving leads.
- Booking links (Cal.com or Calendly) for diaspora time zones.
- WhatsApp Business Platform automated replies. The click-to-chat link is enough at launch.
- Analytics. Plausible keeps the cookie banner smaller. GA4 is the alternative if IRES wants Google’s reports. Pick one before adding a banner.
- Cookie-free page events from the frontend brief, once that brief’s event list is in hand.
- Google Business Profile as a service-area business.

## Still needed from IRES

- Who owns a home enquiry, a commercial enquiry, a development enquiry, and a “not sure” enquiry, and the reply target (the brief suggests one business day).
- Whether `contact@iresglobal.com` is the auto-reply sender, and where that mailbox is hosted today.
- Budget ranges to show, if any.
- How long to keep a lead that nobody contacts.
- Whether IRES is already registered with the Data Protection Commission.
- GA4 or a cookie-free analytics tool.
- Confirmation that the Cantonments office address stays on the contact page.
