import { createHash, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const sqs = new SQSClient({});
const sns = new SNSClient({});

const ENQUIRIES = process.env.ENQUIRIES_TABLE;
const CONTACTS = process.env.CONTACTS_TABLE;
const RATE = process.env.RATE_TABLE;
const QUEUE_URL = process.env.RETRY_QUEUE_URL || "";
const ALERT_TOPIC = process.env.ALERT_TOPIC_ARN || "";
const PRIVACY_VERSION = process.env.PRIVACY_VERSION || "2026-11-v1";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const PLAN_MAP = {
  home: "residential",
  residential: "residential",
  commercial: "commercial-institutional",
  "commercial-institutional": "commercial-institutional",
  development: "developments",
  developments: "developments",
  not_sure: "not-sure",
  "not-sure": "not-sure",
};

const PLAN_TITLES = {
  residential: "Residential",
  "commercial-institutional": "Commercial and institutional",
  developments: "Developments",
  "not-sure": "Not sure yet",
};

const COUNTRY_DIAL_CODES = {
  GH: "233",
  NG: "234",
  GB: "44",
  US: "1",
  CA: "1",
  DE: "49",
  NL: "31",
  FR: "33",
  IT: "39",
  AE: "971",
  ZA: "27",
  KE: "254",
  CN: "86",
  IN: "91",
};

export const handler = async (event) => {
  if (event.Records) return retryQueued(event);
  if (event.source === "aws.events") return retryPending();
  return handleHttp(event);
};

async function handleHttp(event) {
  const method = (event.requestContext?.http?.method || event.httpMethod || "POST").toUpperCase();
  if (method !== "POST") {
    return json(405, { errors: [{ field: "method", message: "Only POST requests are allowed." }] });
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  // Reject bodies over 10 KB
  if (Buffer.byteLength(raw, "utf8") > 10240) {
    return json(413, { errors: [{ field: "body", message: "Payload exceeds 10 KB limit." }] });
  }

  const contentType = (event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").toLowerCase();
  const isFormUrlEncoded = contentType.includes("application/x-www-form-urlencoded");

  let payload;
  try {
    if (isFormUrlEncoded) {
      payload = Object.fromEntries(new URLSearchParams(raw));
    } else {
      payload = JSON.parse(raw);
    }
  } catch {
    return json(400, { errors: [{ field: "body", message: "Invalid payload format." }] });
  }

  // Honeypot check: silent 201 success, store nothing
  if (String(payload.website || payload.company_website || "").trim()) {
    if (isFormUrlEncoded) {
      return { statusCode: 303, headers: { Location: "/thank-you" }, body: "" };
    }
    return json(201, { id: randomUUID() });
  }

  const ip =
    event.requestContext?.http?.sourceIp ||
    event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown";

  // Rate limit: 5 in 10 minutes, 20 in 1 hour
  try {
    if (await overLimit(ip)) {
      return json(429, {
        message: "Too many attempts, please try again later or message us on WhatsApp",
      });
    }
  } catch (error) {
    console.error("rate-limit", error.name || error.message);
    return json(500, { fallback: "whatsapp" });
  }

  // Turnstile spam verification
  if (process.env.TURNSTILE_SECRET) {
    const passed = await turnstile(payload.turnstileToken, ip);
    if (!passed) {
      return json(400, {
        errors: [{ field: "turnstile", message: "The spam check did not pass. Please try again." }],
      });
    }
  }

  // Validate and normalize fields
  const validation = validate(payload);
  if (validation.errors && validation.errors.length > 0) {
    return json(400, { errors: validation.errors });
  }

  const lead = validation.value;
  const salt = process.env.RATE_SALT || "ires-salt";
  lead.ip_hash = createHash("sha256").update(`${salt}|${ip}`).digest("hex");
  lead.userAgent = clean(event.headers?.["user-agent"] || "", 300);
  lead.referrer = clean(payload.referrer || event.headers?.["referer"] || "", 300);
  lead.isTest = event.headers?.["x-ires-test"] === "true";

  let saved;
  try {
    // 1. Insert lead into database first (store-before-notify)
    saved = await saveEnquiry(lead);
  } catch (error) {
    console.error("save", error.name || error.message);
    return json(500, { fallback: "whatsapp" });
  }

  // 2. Lead safely stored! Handle integrations in background
  try {
    if (lead.isTest) {
      // Per brief page 28 & 29: test header marks the row as test and skips CRM and alert email
      await ddb.send(
        new UpdateCommand({
          TableName: ENQUIRIES,
          Key: { id: saved.id },
          UpdateExpression:
            "SET crmSyncStatus = :sync, emailStatus = :email, updatedAt = :now",
          ExpressionAttributeValues: {
            ":sync": "test",
            ":email": "test",
            ":now": new Date().toISOString(),
          },
        })
      );
    } else {
      const synced = await syncContact(saved);
      const emailStatus = await sendMail(saved);
      await ddb.send(
        new UpdateCommand({
          TableName: ENQUIRIES,
          Key: { id: saved.id },
          UpdateExpression:
            "SET crmContactId = :cid, crmSyncStatus = :sync, crmSyncAttempts = :attempts, emailStatus = :email, crm_synced_at = :crmSynced, email_sent_at = :emailSent, updatedAt = :now",
          ExpressionAttributeValues: {
            ":cid": synced.contactId || saved.crmContactId || "",
            ":sync": synced.ok ? "synced" : "pending",
            ":attempts": synced.ok ? 0 : 1,
            ":email": emailStatus,
            ":crmSynced": synced.ok ? new Date().toISOString() : null,
            ":emailSent": emailStatus === "sent" ? new Date().toISOString() : null,
            ":now": new Date().toISOString(),
          },
        })
      );
      if (!synced.ok) await enqueue(saved.id);
    }
  } catch (integrationError) {
    console.error("background-integrations", integrationError.name || integrationError.message);
  }

  if (isFormUrlEncoded) {
    return { statusCode: 303, headers: { Location: "/thank-you" }, body: "" };
  }

  return json(201, { id: saved.id });
}

function validate(payload) {
  const errors = [];

  const name = clean(payload.name, 100);
  if (!name || name.length < 2) {
    errors.push({ field: "name", message: "Name is required (2 to 100 characters)." });
  }

  const rawCountry = clean(payload.country, 2).toUpperCase() || "GH";
  const country = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : "GH";

  const rawPhone = clean(payload.phone, 50);
  const phoneE164 = normalizePhone(rawPhone, country);
  if (!phoneE164) {
    errors.push({ field: "phone", message: "Please check your phone number." });
  }

  const rawPlan = clean(payload.plan || payload.enquiryType || payload["project-type"], 50).toLowerCase();
  const plan = PLAN_MAP[rawPlan];
  if (!plan) {
    errors.push({ field: "plan", message: "Choose a project type." });
  }

  const consent =
    payload.consent === true ||
    payload.consent === "yes" ||
    payload.consent === "true" ||
    payload.consent === "1";
  const consentVersion = clean(payload.consentVersion || payload.privacyPolicyVersion, 40) || PRIVACY_VERSION;
  if (!consent) {
    errors.push({ field: "consent", message: "Please agree that IRES may contact you about your enquiry." });
  }

  const location = clean(payload.location || payload.site, 120);
  const email = clean(payload.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.push({ field: "email", message: "Enter an email address we can reply to." });
  }

  const message = clean(payload.message, 4000);
  const sourcePage = clean(payload.sourcePage, 300) || "/";

  let utm = payload.utm;
  if (!utm || typeof utm !== "object") {
    utm = {
      utm_source: clean(payload.utmSource || payload.utm_source, 120),
      utm_medium: clean(payload.utmMedium || payload.utm_medium, 120),
      utm_campaign: clean(payload.utmCampaign || payload.utm_campaign, 120),
    };
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    value: {
      name,
      country,
      phone: phoneE164,
      phone_country: country,
      phone_e164: phoneE164,
      location,
      plan,
      consent: true,
      consentVersion,
      sourcePage,
      utm,
      email,
      message,
    },
  };
}

function normalizePhone(value, country = "GH") {
  if (!value) return "";
  let digits = String(value).replace(/[^\d+]/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) {
    digits = `+${digits.slice(2)}`;
  }

  const dialCode = COUNTRY_DIAL_CODES[country] || "233";

  if (digits.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }

  if (digits.startsWith(dialCode)) {
    digits = `+${digits}`;
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }

  if (digits.startsWith("0")) {
    digits = `+${dialCode}${digits.slice(1)}`;
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }

  digits = `+${dialCode}${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

async function saveEnquiry(lead) {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - THIRTY_DAYS).toISOString();
  const existing = await findRecent(lead.email, lead.phone_e164, since);
  const id = existing?.id || randomUUID();

  const item = omitEmpty({
    id,
    created_at: existing?.created_at || now,
    name: lead.name,
    phone_country: lead.country,
    phone_e164: lead.phone_e164,
    phone: lead.phone_e164, // for PhoneIndex GSI
    email: lead.email || undefined, // for EmailIndex GSI
    location: lead.location || "",
    plan: lead.plan,
    source_page: lead.sourcePage,
    utm: lead.utm,
    consent_given: true,
    consent_version: lead.consentVersion,
    consent_at: now,
    ip_hash: lead.ip_hash,
    user_agent: lead.userAgent,
    referrer: lead.referrer,
    status: existing?.status || "new",
    is_test: Boolean(lead.isTest),
    message: lead.message || "",
    crmContactId: existing?.crmContactId || "",
    crmSyncStatus: "pending",
    crmSyncAttempts: existing?.crmSyncAttempts || 0,
    emailStatus: "not_configured",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  await ddb.send(new PutCommand({ TableName: ENQUIRIES, Item: item }));
  return item;
}

async function findRecent(email, phone, since) {
  if (phone) {
    const found = await ddb.send(
      new QueryCommand({
        TableName: ENQUIRIES,
        IndexName: "PhoneIndex",
        KeyConditionExpression: "phone = :phone AND createdAt >= :since",
        ExpressionAttributeValues: { ":phone": phone, ":since": since },
        ScanIndexForward: false,
        Limit: 1,
      })
    );
    if (found.Items?.[0]) return found.Items[0];
  }
  if (email) {
    const found = await ddb.send(
      new QueryCommand({
        TableName: ENQUIRIES,
        IndexName: "EmailIndex",
        KeyConditionExpression: "email = :email AND createdAt >= :since",
        ExpressionAttributeValues: { ":email": email, ":since": since },
        ScanIndexForward: false,
        Limit: 1,
      })
    );
    if (found.Items?.[0]) return found.Items[0];
  }
  return null;
}

async function syncContact(enquiry) {
  try {
    const now = new Date().toISOString();
    const notes = salesNotes(enquiry);
    let contactId = enquiry.crmContactId;

    if (contactId) {
      const current = await ddb.send(new GetCommand({ TableName: CONTACTS, Key: { id: contactId } }));
      if (!current.Item) contactId = "";
      else {
        const prior = current.Item.notes ? `${current.Item.notes}\n\n` : "";
        const values = {
          ":name": enquiry.name,
          ":phone": enquiry.phone_e164 || enquiry.phone || current.Item.phone || "",
          ":notes": `${prior}--- Website enquiry ${now} ---\n${notes}`,
          ":now": now,
        };
        let expression = "SET #name = :name, phone = :phone, notes = :notes, updatedAt = :now";
        if (enquiry.email) {
          expression += ", email = :email";
          values[":email"] = enquiry.email;
        }
        await ddb.send(
          new UpdateCommand({
            TableName: CONTACTS,
            Key: { id: contactId },
            UpdateExpression: expression,
            ExpressionAttributeNames: { "#name": "name" },
            ExpressionAttributeValues: values,
          })
        );
        return { ok: true, contactId };
      }
    }

    contactId = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: CONTACTS,
        Item: {
          id: contactId,
          brand: "ires",
          name: enquiry.name,
          email: enquiry.email || "",
          phone: enquiry.phone_e164 || enquiry.phone || "",
          company: "",
          source: "website",
          stage: "15%",
          notes,
          comments: [],
          nextSteps: "Read the enquiry and reply within one business day.",
          createdAt: now,
          updatedAt: now,
        },
      })
    );
    return { ok: true, contactId };
  } catch (error) {
    console.error("crm-sync", error.name || error.message);
    return { ok: false, contactId: enquiry.crmContactId || "" };
  }
}

function salesNotes(enquiry) {
  const planLabel = PLAN_TITLES[enquiry.plan] || enquiry.plan;
  const phoneClean = (enquiry.phone_e164 || enquiry.phone || "").replace(/[^\d]/g, "");

  return [
    `Name: ${enquiry.name}`,
    `Phone: ${enquiry.phone_e164 || enquiry.phone}`,
    `Call: tel:${enquiry.phone_e164 || enquiry.phone}`,
    `WhatsApp: https://wa.me/${phoneClean}`,
    `Location: ${enquiry.location || "Not specified"}`,
    `Plan: ${planLabel}`,
    `Page: ${enquiry.source_page || enquiry.sourcePage || "/"}`,
    enquiry.email ? `Email: ${enquiry.email}` : "",
    "",
    enquiry.message ? `Message: ${enquiry.message}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function sendMail(enquiry) {
  const token = process.env.RESEND_API_KEY || "";
  if (!token) return "not_configured";

  const from = process.env.MAIL_FROM || "IRES <contact@iresglobal.com>";
  const owner = process.env.NOTIFY_EMAIL || "contact@iresglobal.com";
  const planLabel = PLAN_TITLES[enquiry.plan] || enquiry.plan;
  const phoneClean = (enquiry.phone_e164 || enquiry.phone || "").replace(/[^\d]/g, "");

  const accraTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const alertBody = [
    `New enquiry received for IRES:`,
    ``,
    `Name: ${enquiry.name}`,
    `Plan: ${planLabel}`,
    `Where will you build: ${enquiry.location || "Not specified"}`,
    `Phone (tap to call): tel:${enquiry.phone_e164 || enquiry.phone}`,
    `WhatsApp: https://wa.me/${phoneClean}`,
    `Page submitted: ${enquiry.source_page || enquiry.sourcePage || "/"}`,
    `Time in Accra: ${accraTime}`,
    `CRM link: https://crm.iresglobal.com`,
    ``,
    enquiry.email ? `Email: ${enquiry.email}` : "",
    enquiry.message ? `Notes: ${enquiry.message}` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  try {
    await resendSend(token, {
      from,
      to: owner,
      reply_to: enquiry.email || undefined,
      subject: `New enquiry: ${planLabel} from ${enquiry.name}`,
      text: alertBody,
    });
    return "sent";
  } catch (error) {
    console.error("mail", error.name || "send-failed");
    return "failed";
  }
}

async function resendSend(token, message) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    console.error("mail", response.status);
    throw new Error("mail-rejected");
  }
}

async function enqueue(id) {
  if (!QUEUE_URL) return;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ id }),
    })
  );
}

async function retryQueued(event) {
  for (const record of event.Records) {
    const { id } = JSON.parse(record.body);
    await retryOne(id);
  }
  return {};
}

async function retryPending() {
  const found = await ddb.send(
    new ScanCommand({
      TableName: ENQUIRIES,
      FilterExpression: "crmSyncStatus = :pending",
      ExpressionAttributeValues: { ":pending": "pending" },
      ProjectionExpression: "id",
    })
  );
  for (const item of found.Items || []) await retryOne(item.id);
  return { retried: (found.Items || []).length };
}

async function retryOne(id) {
  const loaded = await ddb.send(new GetCommand({ TableName: ENQUIRIES, Key: { id } }));
  const enquiry = loaded.Item;
  if (!enquiry || enquiry.crmSyncStatus === "synced") return;
  const attempts = (enquiry.crmSyncAttempts || 0) + 1;
  const synced = await syncContact(enquiry);
  if (synced.ok) {
    await ddb.send(
      new UpdateCommand({
        TableName: ENQUIRIES,
        Key: { id },
        UpdateExpression:
          "SET crmContactId = :cid, crmSyncStatus = :sync, crmSyncAttempts = :attempts, crm_synced_at = :now, updatedAt = :now",
        ExpressionAttributeValues: {
          ":cid": synced.contactId,
          ":sync": "synced",
          ":attempts": attempts,
          ":now": new Date().toISOString(),
        },
      })
    );
    return;
  }
  const failed = attempts >= 3;
  await ddb.send(
    new UpdateCommand({
      TableName: ENQUIRIES,
      Key: { id },
      UpdateExpression: "SET crmSyncStatus = :sync, crmSyncAttempts = :attempts, updatedAt = :now",
      ExpressionAttributeValues: {
        ":sync": failed ? "failed" : "pending",
        ":attempts": attempts,
        ":now": new Date().toISOString(),
      },
    })
  );
  if (failed && ALERT_TOPIC) {
    await sns.send(
      new PublishCommand({
        TopicArn: ALERT_TOPIC,
        Subject: "IRES enquiry did not reach the CRM",
        Message: `Enquiry ${id} was saved on the website but did not sync to the CRM after 3 attempts.`,
      })
    );
  }
}

async function overLimit(ip) {
  const salt = process.env.RATE_SALT || "ires-salt";
  const now = Date.now();
  const window10m = Math.floor(now / (10 * 60 * 1000));
  const window1h = Math.floor(now / (60 * 60 * 1000));

  const pk10m = createHash("sha256").update(`${salt}|${ip}|10m|${window10m}`).digest("hex");
  const pk1h = createHash("sha256").update(`${salt}|${ip}|1h|${window1h}`).digest("hex");

  const [res10m, res1h] = await Promise.all([
    ddb.send(
      new UpdateCommand({
        TableName: RATE,
        Key: { pk: pk10m },
        UpdateExpression: "ADD #count :one SET expiresAt = if_not_exists(expiresAt, :ttl)",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":ttl": Math.floor(now / 1000) + 60 * 60, // 1 hour TTL
        },
        ReturnValues: "UPDATED_NEW",
      })
    ),
    ddb.send(
      new UpdateCommand({
        TableName: RATE,
        Key: { pk: pk1h },
        UpdateExpression: "ADD #count :one SET expiresAt = if_not_exists(expiresAt, :ttl)",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":ttl": Math.floor(now / 1000) + 3 * 60 * 60, // 3 hours TTL
        },
        ReturnValues: "UPDATED_NEW",
      })
    ),
  ]);

  const count10m = Number(res10m.Attributes?.count || 0);
  const count1h = Number(res1h.Attributes?.count || 0);

  return count10m > 5 || count1h > 20;
}

async function turnstile(token, ip) {
  if (!token) return false;
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET,
    response: String(token),
    remoteip: ip,
  });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const data = await response.json();
  return Boolean(data.success);
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function omitEmpty(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== "" && value !== undefined && value !== null)
  );
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "https://iresglobal.com",
    },
    body: JSON.stringify(body),
  };
}
