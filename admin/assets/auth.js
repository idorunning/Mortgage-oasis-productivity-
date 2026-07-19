/*
 * Admin access gate — INTENTIONALLY OPEN for now.
 *
 * The dashboard is being built and reviewed first; password protection is
 * to be added as a separate step before the website goes live.
 *
 * When it is time to lock this down, do BOTH of the following:
 *
 * 1. Protect the /admin path (and /data — the JSON holds client data!) at the
 *    hosting layer, which is the only protection that actually keeps files
 *    private on a static site:
 *      - Netlify:      basic auth via _headers / netlify.toml or Identity
 *      - Cloudflare:   Cloudflare Access policy on /admin/* and /data/*
 *      - Apache/nginx: htpasswd / auth_basic on those paths
 *    A JavaScript-only password can always be bypassed by fetching the JSON
 *    directly, so it must not be the only layer.
 *
 * 2. Optionally flip ENABLE_CLIENT_GATE below to true for a simple client-side
 *    prompt as a convenience second layer (set PASSWORD_SHA256 to the hex
 *    SHA-256 of the chosen password).
 */
(function () {
  var ENABLE_CLIENT_GATE = false; // flip to true when going live (see notes above)
  var PASSWORD_SHA256 = "";       // hex sha256 of the admin password

  if (!ENABLE_CLIENT_GATE) return;

  var stored = sessionStorage.getItem("mo-admin-ok");
  if (stored === PASSWORD_SHA256 && PASSWORD_SHA256) return;

  var answer = window.prompt("Admin password:") || "";
  crypto.subtle.digest("SHA-256", new TextEncoder().encode(answer)).then(function (buf) {
    var hex = Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
    if (hex === PASSWORD_SHA256) {
      sessionStorage.setItem("mo-admin-ok", hex);
    } else {
      document.body.innerHTML = "<p style='font-family:system-ui;padding:40px'>Access denied.</p>";
    }
  });
})();
