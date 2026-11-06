/* ==========================================================================
   IRES — interactions & analytics
   Everything degrades to plain, readable HTML with JS disabled.
   ========================================================================== */

/* Enquiry API. Mail is sent by the API via Resend. */
const ENQUIRY_API = "https://2s128tbbya.execute-api.eu-west-1.amazonaws.com/enquiries";
const PRIVACY_VERSION = "2026-11-v1";

/* ---------- Analytics Helper (Cookieless) ---------- */
function trackEvent(name, props = {}) {
  try {
    if (typeof window.plausible === "function") {
      window.plausible(name, { props });
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...props });
    }
    document.dispatchEvent(new CustomEvent("ires:analytics", { detail: { name, props } }));
  } catch {
    // Analytics must never throw or break user actions
  }
}

function getEventLocation(el) {
  if (el.closest(".site-header")) return "header";
  if (el.closest(".hero")) return "hero";
  if (el.closest(".contact") || el.closest("#start")) return "start-section";
  if (el.closest(".site-footer")) return "footer";
  if (el.closest(".legal")) return "contact-page";
  return "panel";
}

/* ---------- Global Link & Click Tracking ---------- */
document.addEventListener("click", (event) => {
  const target = event.target.closest("a, button");
  if (!target) return;

  const href = target.getAttribute("href") || "";
  const loc = target.dataset.location || getEventLocation(target);

  if (href.includes("wa.me") || href.includes("whatsapp")) {
    trackEvent("whatsapp_click", { location: loc });
  } else if (href.startsWith("tel:")) {
    trackEvent("phone_click", { location: loc });
  } else if (target.dataset.analytics === "start_build_click" || href === "#start") {
    trackEvent("start_build_click", { location: loc });
  } else if (target.dataset.analytics === "request_call_click") {
    trackEvent("request_call_click", { location: loc });
  }
});

/* ---------- Reveal on scroll ---------- */
const revealItems = Array.from(document.querySelectorAll(".reveal"));

if ("IntersectionObserver" in window && revealItems.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");

        // Fire reveal_open event for sections
        const sectionSlug = entry.target.dataset.section || entry.target.id;
        if (sectionSlug) {
          trackEvent("reveal_open", { section: sectionSlug });
        }

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

/* ---------- Start section / Form view tracking ---------- */
const startSection = document.getElementById("start");
if (startSection && "IntersectionObserver" in window) {
  let hasScrolledStart = false;
  let hasOpenedForm = false;
  const startObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (!hasScrolledStart) {
            hasScrolledStart = true;
            trackEvent("scroll_start_section", {});
          }
          if (!hasOpenedForm) {
            hasOpenedForm = true;
            trackEvent("form_open", { page: window.location.pathname || "/" });
          }
          startObserver.disconnect();
        }
      });
    },
    { threshold: 0.15 }
  );
  startObserver.observe(startSection);
}

/* ---------- Header state + strata progress bar ---------- */
const header = document.getElementById("site-header");
const progress = document.querySelector(".scroll-progress i");

let ticking = false;

const updateHeader = () => {
  const y = window.scrollY || window.pageYOffset;
  if (header) header.classList.toggle("is-stuck", y > 90);

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
    const label = navToggle.querySelector(".nav-toggle-label");
    if (label) label.textContent = open ? "Close menu" : "Menu";
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

/* ---------- Anchor landing handler ---------- */
function handleHashScroll() {
  const h = window.location.hash;
  if (h === "#start" || h === "#contact") {
    const startEl = document.getElementById("start");
    if (startEl) {
      startEl.scrollIntoView({ behavior: "smooth" });
      const nameField = document.getElementById("f-name");
      if (nameField) nameField.focus();
    }
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", handleHashScroll);
} else {
  handleHashScroll();
}

/* ---------- Contact form ---------- */
const form = document.querySelector(".contact-form");

if (form) {
  const status = form.querySelector(".form-status");
  const submitButton = form.querySelector("button[type='submit']");

  const clearErrors = () => {
    form.querySelectorAll(".field").forEach((field) => field.classList.remove("has-error"));
    form.querySelectorAll(".field-error").forEach((slot) => {
      slot.textContent = "";
    });
    form.querySelectorAll("input, select, textarea").forEach((input) => {
      input.removeAttribute("aria-invalid");
    });
  };

  const setFieldError = (fieldName, message) => {
    const slot = form.querySelector(`[data-error-for="${fieldName}"]`);
    if (slot) slot.textContent = message;
    const input = form.elements[fieldName];
    if (input) {
      const holder = input.closest(".field");
      if (holder) holder.classList.add("has-error");
      input.setAttribute("aria-invalid", "true");
    }
  };

  const validateClient = () => {
    clearErrors();
    const errors = [];

    const name = String(form.elements.name?.value || "").trim();
    if (!name || name.length < 2) {
      errors.push({ field: "name", message: "Name is required (2 to 100 characters)." });
    }

    const phone = String(form.elements.phone?.value || "").trim();
    if (!phone || phone.replace(/\D/g, "").length < 7) {
      errors.push({ field: "phone", message: "Please enter a valid phone number." });
    }

    const plan = form.elements.plan?.value;
    if (!plan) {
      errors.push({ field: "plan", message: "Please select an enquiry type." });
    }

    const consent = form.elements.consent?.checked;
    if (!consent) {
      errors.push({ field: "consent", message: "Please agree that IRES may contact you about your enquiry." });
    }

    errors.forEach((err) => setFieldError(err.field, err.message));
    return errors;
  };

  // Clear error on input
  form.addEventListener("input", (e) => {
    const input = e.target;
    const name = input.name;
    if (!name) return;
    const holder = input.closest(".field");
    if (holder?.classList.contains("has-error")) {
      holder.classList.remove("has-error");
      input.removeAttribute("aria-invalid");
      const slot = form.querySelector(`[data-error-for="${name}"]`);
      if (slot) slot.textContent = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.className = "form-status";
    status.innerHTML = "";

    const clientErrors = validateClient();
    if (clientErrors.length > 0) {
      status.textContent = "Please check the highlighted fields.";
      status.classList.add("is-error");
      const firstInput = form.elements[clientErrors[0].field];
      if (firstInput) firstInput.focus();
      return;
    }

    const data = new FormData(form);
    const params = new URLSearchParams(window.location.search);

    const payload = {
      name: String(data.get("name") || "").trim(),
      country: String(data.get("country") || "GH").trim(),
      phone: String(data.get("phone") || "").trim(),
      plan: String(data.get("plan") || "").trim(),
      location: String(data.get("location") || "").trim(),
      message: String(data.get("message") || "").trim(),
      consent: data.get("consent") === "yes" || data.get("consent") === "true",
      consentVersion: PRIVACY_VERSION,
      website: String(data.get("website") || "").trim(),
      sourcePage: window.location.pathname || "/",
      utm: {
        utm_source: params.get("utm_source") || "",
        utm_medium: params.get("utm_medium") || "",
        utm_campaign: params.get("utm_campaign") || "",
      },
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

      if (response.status === 201 || (response.ok && result.id)) {
        form.reset();
        const countrySelect = document.getElementById("f-country");
        if (countrySelect) countrySelect.value = "GH";

        status.classList.remove("is-error");
        status.innerHTML = `
          <div class="thank-you-box" tabindex="-1">
            <p><strong>Thanks, ${escapeHtml(payload.name)}.</strong> We have your note and will be in touch within one business day.</p>
            <p>You can also reach us on WhatsApp: <a href="https://wa.me/233209669000?text=Hello%20IRES%2C%20I%20would%20like%20to%20talk%20about%20building%20a%20home." target="_blank" rel="noopener">+233 20 966 9000</a></p>
          </div>
        `;
        const thankBox = status.querySelector(".thank-you-box");
        if (thankBox) thankBox.focus();

        trackEvent("enquiry_sent", { plan: payload.plan, page: payload.sourcePage });
      } else if (response.status === 400 && Array.isArray(result.errors)) {
        clearErrors();
        result.errors.forEach((err) => setFieldError(err.field, err.message));
        status.textContent = "Please correct the errors above and try again.";
        status.classList.add("is-error");
        const firstBad = form.elements[result.errors[0]?.field];
        if (firstBad) firstBad.focus();
        trackEvent("enquiry_error", { status: 400 });
      } else if (response.status === 429) {
        status.classList.add("is-error");
        status.innerHTML = `
          <p>${escapeHtml(result.message || "Too many attempts, please try again later or message us on WhatsApp.")}</p>
          <a class="form-status-whatsapp" href="https://wa.me/233209669000?text=Hello%20IRES%2C%20I%20would%20like%20to%20talk%20about%20building%20a%20home." target="_blank" rel="noopener">Chat on WhatsApp</a>
        `;
        trackEvent("enquiry_error", { status: 429 });
      } else {
        // Fallback state (500 or unknown error)
        status.classList.add("is-error");
        status.innerHTML = `
          <p>We could not save that note. Please WhatsApp us directly at +233 20 966 9000.</p>
          <a class="form-status-whatsapp" href="https://wa.me/233209669000?text=Hello%20IRES%2C%20I%20would%20like%20to%20talk%20about%20building%20a%20home." target="_blank" rel="noopener">Chat on WhatsApp</a>
        `;
        trackEvent("enquiry_error", { status: response.status || 500 });
      }
    } catch {
      status.classList.add("is-error");
      status.innerHTML = `
        <p>Network error. We could not save your note right now. Please message us on WhatsApp:</p>
        <a class="form-status-whatsapp" href="https://wa.me/233209669000?text=Hello%20IRES%2C%20I%20would%20like%20to%20talk%20about%20building%20a%20home." target="_blank" rel="noopener">Chat on WhatsApp</a>
      `;
      trackEvent("enquiry_error", { status: 500 });
    } finally {
      submitButton.disabled = false;
    }
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
