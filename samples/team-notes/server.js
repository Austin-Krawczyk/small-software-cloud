// Team Notes — a tiny sample app for Small Software Cloud.
//
// Note what is MISSING here: no auth, no user management, no sessions.
// The platform handles all of that; the app just reads X-SmallSoftware-User.
const http = require("node:http");

const notes = [
  { text: "Welcome! Notes anyone on the team adds show up here.", by: "sample data" },
];

const page = (user, prefix) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Team Notes</title>
<style>
  body { font-family: system-ui; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #223; }
  h1 { font-size: 1.4rem; } .who { color: #78a; font-size: .9rem; }
  li { margin: .6rem 0; } .by { color: #999; font-size: .85rem; }
  form { display: flex; gap: .5rem; margin-top: 1.5rem; }
  input { flex: 1; padding: .5rem; border: 1px solid #ccd; border-radius: 6px; }
  button { padding: .5rem 1rem; border: 0; border-radius: 6px; background: #2c6bed; color: #fff; }
</style></head>
<body>
  <h1>📝 Team Notes</h1>
  <p class="who">Signed in through Small Software Cloud as <b>${esc(user)}</b></p>
  <ul>${notes.map((n) => `<li>${esc(n.text)} <span class="by">— ${esc(n.by)}</span></li>`).join("")}</ul>
  <form method="post" action="${prefix}/add">
    <input name="text" placeholder="Add a note…" required>
    <button type="submit">Add</button>
  </form>
</body></html>`;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const server = http.createServer((req, res) => {
  const user = req.headers["x-smallsoftware-user"] || "someone";
  const prefix = req.headers["x-forwarded-prefix"] || "";

  if (req.method === "POST" && req.url.endsWith("/add")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const text = decodeURIComponent(
        (new URLSearchParams(body).get("text") || "").replace(/\+/g, " ")
      ).trim();
      if (text) notes.push({ text, by: user });
      res.writeHead(303, { location: `${prefix}/` });
      res.end();
    });
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page(user, prefix));
});

server.listen(process.env.PORT || 3000, process.env.HOST || "127.0.0.1", () => {
  console.log(`team-notes listening on ${process.env.PORT || 3000}`);
});
