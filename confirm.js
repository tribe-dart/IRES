const API = "https://api-crm.iresglobal.com";
const title = document.getElementById("confirm-title");
const copy = document.getElementById("confirm-copy");
const actions = document.getElementById("confirm-actions");
const params = new URLSearchParams(window.location.search);

fetch(`${API}/api/auth/confirm`, {
  method: "POST",
  credentials: "include",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    token: params.get("token") || "",
    email: params.get("email") || "",
  }),
})
  .then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "We could not confirm that email.");
    title.textContent = "Your email is confirmed.";
    copy.textContent = `Hello, ${data.user.name}. You are signed in. Open the CRM, or stay on the website.`;
    actions.hidden = false;
    window.history.replaceState({}, "", "confirm.html");
  })
  .catch((error) => {
    title.textContent = "That link did not work.";
    copy.textContent = `${error.message} You can request a new one from the account page.`;
  });
