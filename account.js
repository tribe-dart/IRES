const API = "https://api-crm.iresglobal.com";
const form = document.getElementById("account-form");
const status = document.getElementById("account-status");
const nameField = document.getElementById("name-field");
const nameInput = document.getElementById("account-name");
const submit = document.getElementById("account-submit");
const switcher = document.getElementById("account-switch");
const title = document.getElementById("account-title");
const copy = document.getElementById("account-copy");
const crmLink = document.getElementById("crm-link");
const password = document.getElementById("account-password");

let mode = "signup";

const post = async (path, body) => {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};

fetch(`${API}/api/auth/me`, { credentials: "include" })
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => {
    if (!data?.user) return;
    title.textContent = `Hello, ${data.user.name}.`;
    copy.textContent = "You are signed in. Open the CRM, or stay on the website.";
    form.hidden = true;
    crmLink.hidden = false;
  })
  .catch(() => {});

switcher.addEventListener("click", () => {
  mode = mode === "signup" ? "login" : "signup";
  const signingUp = mode === "signup";
  title.textContent = signingUp ? "Create your IRES account." : "Sign in.";
  copy.textContent = signingUp
    ? "Confirm the email we send you. Then you can open the CRM or stay on the website. It is the same login either way."
    : "Use the account you confirmed. Then you can open the CRM.";
  nameField.hidden = !signingUp;
  nameInput.required = signingUp;
  password.autocomplete = signingUp ? "new-password" : "current-password";
  submit.textContent = signingUp ? "Create account" : "Sign in";
  switcher.textContent = signingUp ? "I already have an account" : "Create an account";
  status.textContent = "";
  status.classList.remove("is-error");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.classList.remove("is-error");
  submit.disabled = true;
  const payload = {
    name: nameInput.value.trim(),
    email: document.getElementById("account-email").value.trim(),
    password: password.value,
  };
  try {
    if (mode === "signup") {
      await post("/api/auth/signup", payload);
      status.textContent = "Check your email and open the confirmation link. After that you can go to the CRM.";
      form.reset();
    } else {
      const data = await post("/api/auth/login", payload);
      title.textContent = `Hello, ${data.user.name}.`;
      copy.textContent = "You are signed in.";
      form.hidden = true;
      crmLink.hidden = false;
    }
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
  } finally {
    submit.disabled = false;
  }
});
