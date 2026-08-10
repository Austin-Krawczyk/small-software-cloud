// SQLite Guestbook — a sample showing Small Software Cloud's managed database.
//
// Attach a database to this project and the platform injects SCLOUD_DATABASE_PATH
// (and a DATABASE_URL). We open a SQLite file there with Node's built-in driver;
// entries survive restarts and redeploys. No database server to run.
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// Prefer the managed database path; fall back to durable storage so the app
// still runs before a database is attached.
const dbPath =
  process.env.SCLOUD_DATABASE_PATH ||
  path.join(process.env.SCLOUD_DATA_DIR || ".", "guestbook.sqlite");

const db = new DatabaseSync(dbPath);
db.exec("CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, who TEXT, msg TEXT, at INTEGER)");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (user, prefix) => {
  const rows = db.prepare("SELECT who, msg FROM entries ORDER BY id DESC LIMIT 50").all();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Guestbook</title>
<style>
 body { font-family: system-ui; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #223; }
 h1 { font-size: 1.4rem; } .who { color: #78a; font-size: .9rem; }
 li { margin: .5rem 0; } .by { color: #999; font-size: .85rem; }
 form { display: flex; gap: .5rem; margin-top: 1.5rem; }
 input { flex: 1; padding: .5rem; border: 1px solid #ccd; border-radius: 6px; }
 button { padding: .5rem 1rem; border: 0; border-radius: 6px; background: #2c6bed; color: #fff; }
 footer { margin-top: 2rem; color: #aab; font-size: .8rem; }
</style></head><body>
 <h1>📖 Guestbook</h1>
 <p class="who">Signed in as <b>${esc(user)}</b> · ${rows.length} recent entries</p>
 <ul>${rows.map((r) => `<li>${esc(r.msg)} <span class="by">— ${esc(r.who)}</span></li>`).join("")}</ul>
 <form method="post" action="${prefix}/sign">
   <input name="msg" placeholder="Leave a message…" required>
   <button type="submit">Sign</button>
 </form>
 <footer>Stored in ${esc(process.env.DATABASE_URL || dbPath)}</footer>
</body></html>`;
};

const server = http.createServer((req, res) => {
  const user = req.headers["x-smallsoftware-user"] || "someone";
  const prefix = req.headers["x-forwarded-prefix"] || "";

  if (req.method === "POST" && req.url.endsWith("/sign")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = decodeURIComponent(
        (new URLSearchParams(body).get("msg") || "").replace(/\+/g, " ")
      ).trim();
      if (msg) db.prepare("INSERT INTO entries (who, msg, at) VALUES (?,?,?)").run(user, msg, Date.now());
      res.writeHead(303, { location: `${prefix}/` });
      res.end();
    });
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page(user, prefix));
});

server.listen(process.env.PORT || 3000, process.env.HOST || "127.0.0.1", () => {
  console.log(`guestbook listening; db at ${dbPath}`);
});
