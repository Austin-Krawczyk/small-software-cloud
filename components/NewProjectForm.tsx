"use client";

/*
 * New-app page — same Doc-like treatment as the app page.
 *  - Leads with friendly starting points (templates), not "where is the code?".
 *    Picking one is the whole flow; it suggests a name you can change.
 *  - Bring-your-own-code (Git repo / upload later) is a closed "I have my own
 *    code" escape hatch for the minority who need it — not the default step.
 *  - Plain language; no infrastructure framing. On create you land on the app
 *    page, which auto-publishes it — so a new app is just live.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

const TEMPLATES: Record<string, { emoji: string; title: string; blurb: string }> = {
  "team-notes": { emoji: "📝", title: "Team Notes", blurb: "A shared notepad your whole team can add to." },
  "orchard-tracker": { emoji: "🌱", title: "Tracker", blurb: "Log entries in a simple running table." },
  "sqlite-guestbook": { emoji: "💬", title: "Guestbook", blurb: "Collect messages, saved to a database." },
  "hello-static": { emoji: "🌐", title: "Simple Page", blurb: "A clean one-page website." },
};
const meta = (slug: string) =>
  TEMPLATES[slug] ?? { emoji: "📦", title: slug, blurb: "A starter app." };

export default function NewProjectForm({ samples }: { samples: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(samples[0] ?? "");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [later, setLater] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ownCode = repo.trim().length > 0 || later;

  function pick(slug: string) {
    setSelected(slug);
    if (!name.trim()) setName(meta(slug).title);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, string> = { name: name.trim(), description: "" };
    if (repo.trim()) body.repository_url = repo.trim();        // bring-your-own repo
    else if (!later) body.sample = selected;                   // a template
    // (later === true → no source; add code from the app page)

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const project = await res.json();
      router.push(`/projects/${project.id}`);
    } else {
      setError((await res.json()).error ?? "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="new-app">
      <h1>Create an app</h1>
      <p className="muted new-sub">Pick a starting point — you can change everything later.</p>

      <form onSubmit={submit}>
        <div className={`template-grid${ownCode ? " dimmed" : ""}`} role="radiogroup" aria-label="Starting point">
          {samples.map((slug) => {
            const t = meta(slug);
            const on = !ownCode && selected === slug;
            return (
              <button type="button" key={slug} className={`template-card${on ? " sel" : ""}`}
                role="radio" aria-checked={on} onClick={() => pick(slug)}>
                <span className="tc-emoji" aria-hidden="true">{t.emoji}</span>
                <span className="tc-title">{t.title}</span>
                <span className="tc-blurb">{t.blurb}</span>
              </button>
            );
          })}
        </div>

        <label className="name-field">
          Name your app
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="My app" />
        </label>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-lg create-btn" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create app"}
        </button>

        <details className="own-code" open={ownCode}>
          <summary>I have my own code</summary>
          <div className="own-code-body">
            <label>GitHub repository
              <input value={repo} onChange={(e) => setRepo(e.target.value)}
                placeholder="https://github.com/you/your-app" />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
              I’ll upload a zip after creating
            </label>
            {ownCode && <p className="muted tiny">Using your own code — the template above is ignored.</p>}
            <p className="muted tiny">
              Runs Node/Next.js, frontend apps (Vite/React/Vue), Python (FastAPI/Flask), and static sites.
            </p>
          </div>
        </details>
      </form>
    </div>
  );
}
