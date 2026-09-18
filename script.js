/* ==========================================================================
   IRES — interactions
   Everything degrades to plain, readable HTML with JS disabled.
   ========================================================================== */

/* --------------------------------------------------------------------------
   CONTACT DESTINATION
   Set this to the inbox that should receive project notes. While it is empty
   the form tells the visitor the address is not set yet instead of pretending
   the note was delivered.
   -------------------------------------------------------------------------- */
const CONTACT_EMAIL = "";

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
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
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

/* ---------- Contact form ---------- */
const form = document.querySelector(".contact-form");

if (form) {
  const status = form.querySelector(".form-status");
  const fields = ["f-name", "f-email", "f-message"].map((id) => document.getElementById(id));

  const setError = (input, message) => {
    const holder = input.closest(".field");
    const slot = holder ? holder.querySelector(".field-error") : null;
    holder?.classList.toggle("has-error", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (slot) slot.textContent = message || "";
  };

  const validate = () => {
    let firstBad = null;
    fields.forEach((input) => {
      const value = input.value.trim();
      let message = "";

      if (!value) {
        message = "This field is needed.";
      } else if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        message = "Enter an email address we can reply to.";
      }

      setError(input, message);
      if (message && !firstBad) firstBad = input;
    });
    return firstBad;
  };

  fields.forEach((input) => {
    input.addEventListener("input", () => {
      if (input.closest(".field")?.classList.contains("has-error")) setError(input, "");
    });
  });

  form.addEventListener("submit", (event) => {
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
    const name = String(data.get("name") || "").trim();
    const lines = [
      `Name: ${name}`,
      `Email: ${data.get("email")}`,
      `Project type: ${data.get("project-type")}`,
      `Site location: ${data.get("site") || "Not given"}`,
      "",
      String(data.get("message") || ""),
    ];

    if (!CONTACT_EMAIL) {
      // No verified IRES inbox yet, so nothing is sent and we say so plainly.
      // Dev instruction stays in the console, not in front of visitors.
      console.warn("[IRES] Contact form has no destination. Set CONTACT_EMAIL in script.js.");
      status.textContent = "The enquiry form is not accepting messages yet. Please try again shortly.";
      status.classList.add("is-error");
      return;
    }

    const subject = encodeURIComponent(`Project enquiry — ${data.get("project-type")}`);
    const body = encodeURIComponent(lines.join("\n"));
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;

    status.textContent = `Thanks, ${name}. Your mail app is opening with the note ready to send.`;
  });
}
