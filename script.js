/* ==========================================================================
   IRES — interactions
   Everything degrades to plain, readable HTML with JS disabled.
   ========================================================================== */

/* Enquiry API. Mail is sent by the API once Cloudflare Email Sending is configured. */
const ENQUIRY_API = "https://2s128tbbya.execute-api.eu-west-1.amazonaws.com/enquiries";
const PRIVACY_VERSION = "2026-10-26";

/* ---------- Reveal on scroll ---------- */
const revealItems = Array.from(document.querySelectorAll(".reveal"));

if ("IntersectionObserver" in window && revealItems.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.05, rootMargin: "0px 0px 40px 0px" }
  );

  revealItems.forEach((item, index) => {
    // Small stagger so groups of cards or tiles resolve in sequence.
    item.style.transitionDelay = `${Math.min(index % 4, 3) * 90}ms`;
    observer.observe(item);
  });
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

/* ---------- Header state + strata progress bar ---------- */
const header = document.getElementById("site-header");
const progress = document.querySelector(".scroll-progress i");

let ticking = false;

const updateHeader = () => {
  const y = window.scrollY || window.pageYOffset;
  header.classList.toggle("is-stuck", y > 90);

  if (progress) {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(y / scrollable, 1) : 0;
    progress.style.transform = `scaleX(${ratio})`;
  }
  ticking = false;
};

window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateHeader);
  },
  { passive: true }
);

window.addEventListener("resize", updateHeader, { passive: true });
updateHeader();

/* ---------- Mobile menu ---------- */
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.getElementById("site-nav");

if (navToggle && siteNav && header) {
  const setMenuOpen = (open) => {
    header.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navToggle.querySelector(".nav-toggle-label").textContent = open ? "Close menu" : "Menu";
    if (!open && siteNav.contains(document.activeElement)) navToggle.focus();
  };

  navToggle.addEventListener("click", () => {
    setMenuOpen(!header.classList.contains("is-open"));
  });

  siteNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (!header.contains(event.target)) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenuOpen(false);
  });

  window.matchMedia("(min-width: 1101px)").addEventListener("change", (event) => {
    if (event.matches) setMenuOpen(false);
  });
}

/* ---------- Contact form ---------- */
const form = document.querySelector(".contact-form");

if (form) {
  const status = form.querySelector(".form-status");
  const submitButton = form.querySelector("button[type='submit']");
  const requiredFields = ["f-name", "f-site", "f-message"].map((id) => document.getElementById(id));

  const setError = (input, message) => {
    const holder = input.closest(".field");
    const slot = holder ? holder.querySelector(".field-error") : null;
    holder?.classList.toggle("has-error", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (slot) slot.textContent = message || "";
  };

  const validate = () => {
    let firstBad = null;
    const email = document.getElementById("f-email");
    const phone = document.getElementById("f-phone");
    const consent = document.getElementById("f-consent");

    requiredFields.forEach((input) => {
      const message = input.value.trim() ? "" : "This field is needed.";
      setError(input, message);
      if (message && !firstBad) firstBad = input;
    });

    const emailValue = email.value.trim();
    let emailMessage = "";
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailValue)) {
      emailMessage = "Enter an email address we can reply to.";
    } else if (!emailValue && !phone.value.trim()) {
      emailMessage = "Add an email address or a phone number.";
    }
    setError(email, emailMessage);
    if (emailMessage && !firstBad) firstBad = email;

    const consentMessage = consent.checked ? "" : "Please agree to the privacy policy.";
    setError(consent, consentMessage);
    if (consentMessage && !firstBad) firstBad = consent;

    return firstBad;
  };

  [...requiredFields, document.getElementById("f-email"), document.getElementById("f-phone"), document.getElementById("f-consent")].forEach((input) => {
    input.addEventListener("input", () => {
      if (input.closest(".field")?.classList.contains("has-error")) setError(input, "");
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.classList.remove("is-error");

    const firstBad = validate();
    if (firstBad) {
      status.textContent = "Check the highlighted fields and try again.";
      status.classList.add("is-error");
      firstBad.focus();
      return;
    }

    const data = new FormData(form);
    const params = new URLSearchParams(window.location.search);
    const payload = {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      enquiryType: String(data.get("project-type") || ""),
      location: String(data.get("site") || "").trim(),
      message: String(data.get("message") || "").trim(),
      country: String(data.get("country") || ""),
      preferredContact: String(data.get("preferred-contact") || ""),
      consent: data.get("consent") === "yes",
      privacyPolicyVersion: PRIVACY_VERSION,
      company_website: String(data.get("company_website") || ""),
      sourcePage: window.location.href.split("#")[0],
      referrer: document.referrer || "",
      utmSource: params.get("utm_source") || "",
      utmMedium: params.get("utm_medium") || "",
      utmCampaign: params.get("utm_campaign") || "",
    };

    submitButton.disabled = true;
    status.textContent = "Sending your note…";

    try {
      const response = await fetch(ENQUIRY_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        status.textContent = result.error || "We could not save that note. Please WhatsApp +233 20 966 9000.";
        status.classList.add("is-error");
        return;
      }
      form.reset();
      document.getElementById("f-country").value = "GH";
      document.getElementById("f-prefer").value = "whatsapp";
      status.classList.remove("is-error");
      status.textContent = `Thanks, ${payload.name}. We have your note and will be in touch within one business day. You can also reach us on WhatsApp at +233 20 966 9000.`;
    } catch {
      status.textContent = "We could not save that note. Please WhatsApp +233 20 966 9000.";
      status.classList.add("is-error");
    } finally {
      submitButton.disabled = false;
    }
  });
}
