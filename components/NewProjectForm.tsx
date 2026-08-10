"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectForm({ samples }: { samples: string[] }) {
  const router = useRouter();
  const [source, setSource] = useState<"git" | "sample" | "later">("git");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: Record<string, string> = {
      name: data.name,
      description: data.description ?? "",
    };
    if (source === "git" && data.repository_url?.trim()) body.repository_url = data.repository_url;
    if (source === "sample" && data.sample) body.sample = data.sample;

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
    <div className="card auth-card">
      <h2>New app</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={submit}>
        <label>Name <input name="name" required autoFocus placeholder="Orchard Irrigation Tracker" /></label>
        <label>Description <input name="description" placeholder="What does it do? (optional)" /></label>

        <fieldset>
          <legend>Where is the code?</legend>
          <label className="radio">
            <input type="radio" name="source" checked={source === "git"} onChange={() => setSource("git")} />
            Git repository
          </label>
          {source === "git" && (
            <input name="repository_url" placeholder="https://github.com/you/your-app" />
          )}
          <label className="radio">
            <input type="radio" name="source" checked={source === "sample"} onChange={() => setSource("sample")} />
            Start from a sample app
          </label>
          {source === "sample" && (
            <select name="sample" defaultValue={samples[0]}>
              {samples.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <label className="radio">
            <input type="radio" name="source" checked={source === "later"} onChange={() => setSource("later")} />
            I&apos;ll upload a zip later
          </label>
        </fieldset>

        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Deploys Node.js &amp; Next.js servers, frontend apps (Vite/React/Vue → static),
          Python FastAPI or Flask, and plain static sites.
        </p>

        <button className="btn btn-primary" type="submit" disabled={busy}>Create app</button>
      </form>
    </div>
  );
}
