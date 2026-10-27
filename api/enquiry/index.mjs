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
const PRIVACY_VERSION = process.env.PRIVACY_VERSION || "2026-10-26";
const TYPES = new Set(["home", "commercial", "development", "not_sure"]);
const PREFER = new Set(["whatsapp", "call", "email"]);
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const TYPE_LABEL = {
  home: "Residential",
  commercial: "Commercial or institutional",
  development: "Development",
  not_sure: "Not sure yet",
};

export const handler = async (event) => {
  if (event.Records) return retryQueued(event);
  if (event.source === "aws.events") return retryPending();
  return handleHttp(event);
};

async function handleHttp(event) {
  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    if (raw.length > 20000) return json(413, { ok: false, error: "That note is too long." });
    payload = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "Check the form and try again." });
  }

  if (String(payload.company_website || "").trim()) {
    return json(200, { ok: true });
  }

  const ip = event.requestContext?.http?.sourceIp || "unknown";
  try {
    if (await overLimit(ip)) {
      return json(429, { ok: false, error: "Too many notes from this connection. Please try again in an hour, or WhatsApp +233 20 966 9000." });
    }
  } catch (error) {
    console.error("rate-limit", error.name);
    return json(500, { ok: false, error: "We could not save that note. Please WhatsApp +233 20 966 9000." });
  }

  if (process.env.TURNSTILE_SECRET) {
    const passed = await turnstile(payload.turnstileToken, ip);
    if (!passed) return json(400, { ok: false, error: "The spam check did not pass. Please try again." });
  }

  const lead = validate(payload);
  if (lead.error) return json(400, { ok: false, error: lead.error });

  try {
    const saved = await saveEnquiry(lead.value);
    const synced = await syncContact(saved);
    const emailStatus = await sendMail(saved);
    await ddb.send(new UpdateCommand({
      TableName: ENQUIRIES,
      Key: { id: saved.id },
      UpdateExpression: "SET crmContactId = :cid, crmSyncStatus = :sync, crmSyncAttempts = :attempts, emailStatus = :email, updatedAt = :now",
      ExpressionAttributeValues: {
        ":cid": synced.contactId || saved.crmContactId || "",
        ":sync": synced.ok ? "synced" : "pending",
        ":attempts": synced.ok ? 0 : 1,
        ":email": emailStatus,
        ":now": new Date().toISOString(),
      },
    }));
    if (!synced.ok) await enqueue(saved.id);
    return json(200, { ok: true });
  } catch (error) {
    console.error("save", error.name);
    return json(500, { ok: false, error: "We could not save that note. Please WhatsApp +233 20 966 9000." });
  }
}

function validate(payload) {
  const name = clean(payload.name, 120);
  const email = clean(payload.email, 200).toLowerCase();
  const phone = normalizePhone(clean(payload.phone, 40));
  const location = clean(payload.location, 200);
  const message = clean(payload.message, 4000);
  const enquiryType = clean(payload.enquiryType, 40);
  const country = clean(payload.country, 2).toUpperCase();
  const preferredContact = clean(payload.preferredContact, 20);
  const consent = payload.consent === true;

  if (!name || !location || !message) return { error: "Name, site location, and a short note are required." };
  if (!TYPES.has(enquiryType)) return { error: "Choose a project type." };
  if (!/^[A-Z]{2}$/.test(country)) return { error: "Choose the country you live in." };
  if (!PREFER.has(preferredContact)) return { error: "Choose how you would like us to reply." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "Enter an email address we can reply to." };
  if (payload.phone && !phone) return { error: "Enter a phone number with the country code, such as +233." };
  if (!email && !phone) return { error: "Add an email address or a phone number." };
  if (!consent || payload.privacyPolicyVersion !== PRIVACY_VERSION) {
    return { error: "Please agree to the privacy policy before sending." };
  }

  return {
    value: {
      name,
      email,
      phone,
      location,
      message,
      enquiryType,
      country,
      preferredContact,
      sourcePage: clean(payload.sourcePage, 300),
      referrer: clean(payload.referrer, 300),
      utmSource: clean(payload.utmSource, 120),
      utmMedium: clean(payload.utmMedium, 120),
      utmCampaign: clean(payload.utmCampaign, 120),
    },
  };
}

async function saveEnquiry(lead) {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - THIRTY_DAYS).toISOString();
  const existing = await findRecent(lead.email, lead.phone, since);
  const id = existing?.id || randomUUID();
  const item = omitEmpty({
    id,
    ...lead,
    consent: true,
    consentAt: now,
    privacyPolicyVersion: PRIVACY_VERSION,
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
  if (email) {
    const found = await ddb.send(new QueryCommand({
      TableName: ENQUIRIES,
      IndexName: "EmailIndex",
      KeyConditionExpression: "email = :email AND createdAt >= :since",
      ExpressionAttributeValues: { ":email": email, ":since": since },
      ScanIndexForward: false,
      Limit: 1,
    }));
    if (found.Items?.[0]) return found.Items[0];
  }
  if (phone) {
    const found = await ddb.send(new QueryCommand({
      TableName: ENQUIRIES,
      IndexName: "PhoneIndex",
      KeyConditionExpression: "phone = :phone AND createdAt >= :since",
      ExpressionAttributeValues: { ":phone": phone, ":since": since },
      ScanIndexForward: false,
      Limit: 1,
    }));
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
          ":phone": enquiry.phone || current.Item.phone || "",
          ":notes": `${prior}--- Website enquiry ${now} ---\n${notes}`,
          ":now": now,
        };
        let expression = "SET #name = :name, phone = :phone, notes = :notes, updatedAt = :now";
        if (enquiry.email) {
          expression += ", email = :email";
          values[":email"] = enquiry.email;
        }
        await ddb.send(new UpdateCommand({
          TableName: CONTACTS,
          Key: { id: contactId },
          UpdateExpression: expression,
          ExpressionAttributeNames: { "#name": "name" },
          ExpressionAttributeValues: values,
        }));
        return { ok: true, contactId };
      }
    }

    contactId = randomUUID();
    await ddb.send(new PutCommand({
      TableName: CONTACTS,
      Item: {
        id: contactId,
        brand: "ires",
        name: enquiry.name,
        email: enquiry.email || "",
        phone: enquiry.phone || "",
        company: "",
        source: "website",
        stage: "15%",
        notes,
        comments: [],
        nextSteps: "Read the enquiry and reply within one business day.",
        createdAt: now,
        updatedAt: now,
      },
    }));
    return { ok: true, contactId };
  } catch (error) {
    console.error("crm-sync", error.name);
    return { ok: false, contactId: enquiry.crmContactId || "" };
  }
}

function salesNotes(enquiry) {
  return [
    `Project type: ${TYPE_LABEL[enquiry.enquiryType] || enquiry.enquiryType}`,
    `Site: ${enquiry.location}`,
    `Country of residence: ${enquiry.country}`,
    `Preferred contact: ${enquiry.preferredContact}`,
    enquiry.email ? `Email: ${enquiry.email}` : "",
    enquiry.phone ? `Phone: ${enquiry.phone}` : "",
    enquiry.sourcePage ? `Page: ${enquiry.sourcePage}` : "",
    "",
    enquiry.message,
  ].filter((line) => line !== "").join("\n");
}

async function sendMail(enquiry) {
  const token = process.env.RESEND_API_KEY || "";
  if (!token) return "not_configured";

  const from = process.env.MAIL_FROM || "IRES <contact@iresglobal.com>";
  const owner = process.env.NOTIFY_EMAIL || "contact@iresglobal.com";
  try {
    await resendSend(token, {
      from,
      to: owner,
      reply_to: enquiry.email || undefined,
      subject: `New IRES enquiry — ${TYPE_LABEL[enquiry.enquiryType] || "Website"}`,
      text: salesNotes(enquiry),
    });
    if (enquiry.email) {
      await resendSend(token, {
        from,
        to: enquiry.email,
        subject: "We have your note — IRES",
        text: [
          `Hello ${enquiry.name},`,
          "",
          "Thank you for writing to Innovative Rammed Earth Solutions.",
          "We read your note and study the site, then come back with the questions that matter.",
          "You can also reach us on WhatsApp: https://wa.me/233209669000",
          "",
          "IRES",
          "54, 5th Circular Road, Cantonments, Accra",
        ].join("\n"),
      });
    }
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
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({ id }),
  }));
}

async function retryQueued(event) {
  for (const record of event.Records) {
    const { id } = JSON.parse(record.body);
    await retryOne(id);
  }
  return {};
}

async function retryPending() {
  const found = await ddb.send(new ScanCommand({
    TableName: ENQUIRIES,
    FilterExpression: "crmSyncStatus = :pending",
    ExpressionAttributeValues: { ":pending": "pending" },
    ProjectionExpression: "id",
  }));
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
    await ddb.send(new UpdateCommand({
      TableName: ENQUIRIES,
      Key: { id },
      UpdateExpression: "SET crmContactId = :cid, crmSyncStatus = :sync, crmSyncAttempts = :attempts, updatedAt = :now",
      ExpressionAttributeValues: {
        ":cid": synced.contactId,
        ":sync": "synced",
        ":attempts": attempts,
        ":now": new Date().toISOString(),
      },
    }));
    return;
  }
  const failed = attempts >= 3;
  await ddb.send(new UpdateCommand({
    TableName: ENQUIRIES,
    Key: { id },
    UpdateExpression: "SET crmSyncStatus = :sync, crmSyncAttempts = :attempts, updatedAt = :now",
    ExpressionAttributeValues: {
      ":sync": failed ? "failed" : "pending",
      ":attempts": attempts,
      ":now": new Date().toISOString(),
    },
  }));
  if (failed && ALERT_TOPIC) {
    await sns.send(new PublishCommand({
      TopicArn: ALERT_TOPIC,
      Subject: "IRES enquiry did not reach the CRM",
      Message: `Enquiry ${id} was saved on the website but did not sync to the CRM after 3 attempts.`,
    }));
  }
}

async function overLimit(ip) {
  const hour = new Date().toISOString().slice(0, 13);
  const pk = createHash("sha256").update(`${process.env.RATE_SALT}|${ip}|${hour}`).digest("hex");
  const updated = await ddb.send(new UpdateCommand({
    TableName: RATE,
    Key: { pk },
    UpdateExpression: "ADD #count :one SET expiresAt = if_not_exists(expiresAt, :ttl)",
    ExpressionAttributeNames: { "#count": "count" },
    ExpressionAttributeValues: {
      ":one": 1,
      ":ttl": Math.floor(Date.now() / 1000) + 3 * 60 * 60,
    },
    ReturnValues: "UPDATED_NEW",
  }));
  return Number(updated.Attributes?.count || 0) > 5;
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

function normalizePhone(value) {
  if (!value) return "";
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("0")) digits = `+233${digits.slice(1)}`;
  if (digits.startsWith("233")) digits = `+${digits}`;
  if (!digits.startsWith("+") && digits.length >= 8) digits = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

function omitEmpty(item) {
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== "" && value !== undefined));
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
