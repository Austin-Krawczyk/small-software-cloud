"""Orchard Irrigation Tracker — a tiny sample app for Small Software Cloud.

Note what is MISSING here: no auth, no user management, no sessions.
The platform handles all of that; the app just reads X-SmallSoftware-User.
"""
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse

app = FastAPI(title="Orchard Irrigation Tracker")

# In-memory for the demo; restarts start fresh.
entries: list[dict] = [
    {"block": "North apples", "minutes": 45, "by": "sample data"},
    {"block": "Young pears", "minutes": 20, "by": "sample data"},
]

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Orchard Irrigation Tracker</title>
<style>
 body {{ font-family: system-ui; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color:#233; }}
 h1 {{ font-size: 1.4rem; }} .who {{ color: #7a8; font-size: .9rem; }}
 table {{ width: 100%; border-collapse: collapse; margin: 1.2rem 0; }}
 td, th {{ text-align: left; padding: .45rem .3rem; border-bottom: 1px solid #dde5dd; }}
 form {{ display: flex; gap: .5rem; }}
 input {{ padding: .45rem; border: 1px solid #cdd5cd; border-radius: 6px; flex: 1; }}
 button {{ padding: .45rem 1rem; border: 0; border-radius: 6px; background: #2c7a4b; color: #fff; }}
</style></head>
<body>
 <h1>🍏 Orchard Irrigation Tracker</h1>
 <p class="who">Signed in through Small Software Cloud as <b>{user}</b></p>
 <table>
  <tr><th>Block</th><th>Minutes</th><th>Logged by</th></tr>
  {rows}
 </table>
 <form method="post" action="{prefix}/log">
  <input name="block" placeholder="Block (e.g. North apples)" required>
  <input name="minutes" type="number" placeholder="Minutes" required style="max-width:7rem">
  <button type="submit">Log watering</button>
 </form>
</body></html>"""


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    user = request.headers.get("x-smallsoftware-user", "someone")
    prefix = request.headers.get("x-forwarded-prefix", "")
    rows = "\n".join(
        f"<tr><td>{e['block']}</td><td>{e['minutes']}</td><td>{e['by']}</td></tr>"
        for e in entries
    )
    return PAGE.format(user=user, rows=rows, prefix=prefix)


@app.post("/log")
def log(request: Request, block: str = Form(...), minutes: int = Form(...)):
    user = request.headers.get("x-smallsoftware-user", "someone")
    prefix = request.headers.get("x-forwarded-prefix", "")
    entries.append({"block": block, "minutes": minutes, "by": user})
    return RedirectResponse(f"{prefix}/", status_code=303)
