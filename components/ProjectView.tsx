"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Member { user_id: string; name: string; email: string; role: string }
interface Detail {
  id: string; name: string; description: string; slug: string;
  status: string; status_label: string; url: string | null; app_path: string;
  source_kind: string; repository_url: string; sample: string;
  role: string; owner_id?: string;
  members: Member[];
  pending_invites: { email: string }[];
  latest_deployment: { id: string; status: string; logs: string } | null;
}

export default function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.status === 401) { window.location.href = `/login?next=/projects/${projectId}`; return; }
    if (!res.ok) { setNotFound(true); return; }
    setDetail(await res.json());
  }, [projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  async function act(path: string, init?: RequestInit) {
    setBusy(true);
    await fetch(path, { method: "POST", ...init });
    await load();
    setBusy(false);
  }

  if (notFound) return <p className="empty">Project not found.</p>;
  if (!detail) return <p className="empty muted">Loading…</p>;

  const isOwner = detail.role === "owner";
  const running = detail.status === "running";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{detail.name}</h1>
          {detail.description && <p className="muted">{detail.description}</p>}
        </div>
        <span className={`pill pill-${detail.status}`}>{detail.status_label}</span>
      </div>

      <div className="two-col">
        <div>
          <div className="card">
            <h3>Application</h3>
            <p className="app-url">
              {running
                ? <a href={detail.app_path} target="_blank">{detail.app_path}</a>
                : <span className="muted">{detail.app_path} — not running yet</span>}
            </p>
            <div className="card-actions">
              {isOwner && (
                <button className="btn btn-primary" disabled={busy || detail.status === "building"}
                  onClick={() => act(`/api/projects/${projectId}/deploy`)}>
                  {detail.status === "building" ? "Building…" : "Deploy"}
                </button>
              )}
              {isOwner && running && (
                <button className="btn" disabled={busy}
                  onClick={() => act(`/api/projects/${projectId}/stop`)}>Stop</button>
              )}
              {running && <a className="btn" href={detail.app_path} target="_blank">Open</a>}
            </div>
          </div>

          <div className="card">
            <h3>Deployment log</h3>
            <pre className="logs" ref={logsRef}>
              {detail.latest_deployment?.logs || "Not deployed yet."}
            </pre>
          </div>

          {isOwner && <CodeCard detail={detail} onChanged={load} />}
          {isOwner && <EnvVarsCard projectId={projectId} />}
        </div>

        <div>
          <SharingCard detail={detail} isOwner={isOwner} onChanged={load} />
          {isOwner && (
            <div className="card danger">
              <h3>Delete</h3>
              <button className="btn btn-danger" disabled={busy}
                onClick={async () => {
                  if (!confirm(`Delete ${detail.name}? This cannot be undone.`)) return;
                  await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
                  router.push("/");
                }}>
                Delete this app
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CodeCard({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sourceText =
    detail.source_kind === "git" ? `Deploys from ${detail.repository_url}` :
    detail.source_kind === "upload" ? "Deploys from your uploaded zip." :
    detail.source_kind === "sample" ? `Deploys from the "${detail.sample}" sample.` :
    "No code connected yet — add a repository or upload a zip.";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const zip = fd.get("code_zip") as File | null;
    const repo = (fd.get("repository_url") as string | null)?.trim();

    if (zip && zip.size > 0) {
      const upload = new FormData();
      upload.append("code_zip", zip);
      const res = await fetch(`/api/projects/${detail.id}/code`, { method: "POST", body: upload });
      setMessage(res.ok ? "Code uploaded. Click Deploy to ship it." : (await res.json()).error);
    } else if (repo) {
      const res = await fetch(`/api/projects/${detail.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository_url: repo }),
      });
      setMessage(res.ok ? "Repository saved. Click Deploy to ship it." : (await res.json()).error);
    } else {
      setMessage("Enter a repository URL or choose a zip file.");
    }
    form.reset();
    setBusy(false);
    onChanged();
  }

  return (
    <div className="card">
      <h3>Code</h3>
      <p className="muted">{sourceText}</p>
      {message && <p className="muted"><em>{message}</em></p>}
      <form onSubmit={submit} className="stack">
        <label>Git repository <input name="repository_url" placeholder="https://github.com/you/your-app" /></label>
        <label>…or upload a zip <input type="file" name="code_zip" accept=".zip" /></label>
        <button className="btn" type="submit" disabled={busy}>Save code source</button>
      </form>
    </div>
  );
}

function EnvVarsCard({ projectId }: { projectId: string }) {
  const [vars, setVars] = useState<{ key: string; value: string }[]>([]);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/env`, { cache: "no-store" });
    if (res.ok) setVars((await res.json()).env);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    await fetch(`/api/projects/${projectId}/env`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: fd.get("key"), value: fd.get("value") }),
    });
    form.reset();
    setBusy(false);
    load();
  }

  async function remove(key: string) {
    await fetch(`/api/projects/${projectId}/env`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    load();
  }

  return (
    <div className="card">
      <h3>Environment variables</h3>
      <p className="muted">
        Secrets and config passed to your app at startup. Redeploy or restart to apply.
        Your app also gets a durable storage folder at <code>SCLOUD_DATA_DIR</code> that
        survives redeploys.
      </p>
      {vars.length > 0 && (
        <ul className="members">
          {vars.map((v) => (
            <li key={v.key}>
              <span className="app-url">
                {v.key}=<span className="muted">{reveal ? v.value : "••••••"}</span>
              </span>
              <button className="link-btn" onClick={() => remove(v.key)}>remove</button>
            </li>
          ))}
        </ul>
      )}
      {vars.length > 0 && (
        <button className="link-like" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}
          onClick={() => setReveal((r) => !r)}>
          {reveal ? "Hide values" : "Show values"}
        </button>
      )}
      <form onSubmit={add} className="share-form">
        <input name="key" placeholder="API_KEY" pattern="[A-Za-z_][A-Za-z0-9_]*" required
          style={{ flex: "0 0 40%" }} />
        <input name="value" placeholder="value" required />
        <button className="btn btn-primary" type="submit" disabled={busy}>Add</button>
      </form>
    </div>
  );
}

function SharingCard({ detail, isOwner, onChanged }:
  { detail: Detail; isOwner: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function share(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = e.currentTarget;
    const email = (new FormData(form).get("email") as string).trim();
    await fetch(`/api/projects/${detail.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    form.reset();
    setBusy(false);
    onChanged();
  }

  async function remove(body: Record<string, string>) {
    await fetch(`/api/projects/${detail.id}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    onChanged();
  }

  return (
    <div className="card">
      <h3>Sharing</h3>
      <ul className="members">
        {detail.members.map((m) => (
          <li key={m.user_id}>
            <span>{m.name} <span className="muted">({m.email})</span></span>
            <span className="pill pill-role">{m.role}</span>
            {isOwner && m.role !== "owner" && (
              <button className="link-btn" onClick={() => remove({ user_id: m.user_id })}>remove</button>
            )}
          </li>
        ))}
        {detail.pending_invites.map((i) => (
          <li key={i.email}>
            <span>{i.email} <span className="muted">(invited — gets access when they sign up)</span></span>
            {isOwner && (
              <button className="link-btn" onClick={() => remove({ email: i.email })}>remove</button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form className="share-form" onSubmit={share}>
          <input name="email" type="email" required placeholder="teammate@example.com" />
          <button className="btn btn-primary" type="submit" disabled={busy}>Share</button>
        </form>
      )}
    </div>
  );
}
