"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppMenu from "./AppMenu";
import Modal from "./Modal";

interface Member { user_id: string; name: string; email: string; role: string }
interface Detail {
  id: string; name: string; description: string; slug: string;
  status: string; status_label: string; url: string | null; app_path: string;
  source_kind: string; repository_url: string; sample: string;
  role: string; owner_id?: string;
  members: Member[];
  pending_invites: { email: string; role: string }[];
  latest_deployment: { id: string; status: string; logs: string } | null;
}

function statusLine(status: string): { cls: string; text: string } {
  switch (status) {
    case "running": return { cls: "live", text: "Running — open it below, or share the link." };
    case "stopped": return { cls: "idle", text: "Paused to save resources. It wakes up the moment someone opens it." };
    case "building": return { cls: "busy", text: "Publishing… this takes a few seconds." };
    case "failed": return { cls: "fail", text: "The last publish didn’t finish. Open Advanced → Activity to see why." };
    default: return { cls: "idle", text: "Not online yet — press Deploy to publish it." };
  }
}

export default function ProjectView({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.status === 401) { window.location.href = `/login?next=/projects/${projectId}`; return; }
    if (!res.ok) { setNotFound(true); return; }
    setDetail(await res.json());
  }, [projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function act(path: string) {
    setBusy(true);
    await fetch(path, { method: "POST" });
    await load();
    setBusy(false);
  }

  if (notFound) return <p className="empty">This app doesn’t exist, or you no longer have access.</p>;
  if (!detail) return <p className="empty muted">Loading…</p>;

  const canEdit = detail.role === "owner" || detail.role === "editor";
  const canManage = detail.role === "owner";
  const running = detail.status === "running";
  const s = statusLine(detail.status);
  const prettyUrl = detail.app_path.replace(/\/$/, "");

  return (
    <>
      <div className="proj-head">
        <div className="proj-title">
          <h1>{detail.name}</h1>
          <span className={`pill pill-${detail.status}`}>{detail.status_label}</span>
        </div>
        <div className="proj-head-actions">
          {canEdit && (
            <button className="icon-btn" title="Edit name & description" aria-label="Edit name & description"
              onClick={() => setEditing(true)}>✎</button>
          )}
          <AppMenu projectId={projectId} projectName={detail.name} isOwner={canManage} onDone="home" />
        </div>
      </div>
      {detail.description && <p className="muted proj-desc">{detail.description}</p>}

      {/* The app itself — status, address, and the main actions. */}
      <section className="card app-hero">
        <div className="status-line">
          <span className={`sdot sdot-${s.cls}`} aria-hidden="true"></span>
          <span>{s.text}</span>
        </div>
        <div className="hero-url">
          {running
            ? <a href={detail.app_path} target="_blank" rel="noreferrer">{prettyUrl}</a>
            : <span className="muted">{prettyUrl}</span>}
          <CopyLinkButton url={prettyUrl} />
        </div>
        <div className="hero-actions">
          {running && (
            <a className="btn btn-primary btn-lg" href={detail.app_path} target="_blank" rel="noreferrer">Open app ↗</a>
          )}
          {canEdit && (
            <button className="btn btn-lg" disabled={busy || detail.status === "building"}
              onClick={() => act(`/api/projects/${projectId}/deploy`)}>
              {detail.status === "building" ? "Publishing…" : detail.status === "not_deployed" ? "Deploy" : "Redeploy"}
            </button>
          )}
          {canEdit && running && (
            <button className="btn btn-lg" disabled={busy}
              onClick={() => act(`/api/projects/${projectId}/stop`)}>Pause</button>
          )}
        </div>
      </section>

      <SharingCard detail={detail} canManage={canManage} onChanged={load} />

      {canEdit && (
        <details className="advanced">
          <summary>Advanced settings</summary>
          <div className="advanced-body">
            <CodeCard detail={detail} onChanged={load} />
            <EnvVarsCard projectId={projectId} />
            <DatabaseCard projectId={projectId} />
            <div className="card">
              <h3>Activity</h3>
              <pre className="logs">{detail.latest_deployment?.logs || "Nothing deployed yet."}</pre>
            </div>
          </div>
        </details>
      )}

      {editing && <EditModal detail={detail} onClose={() => setEditing(false)} onSaved={load} />}
    </>
  );
}

function EditModal({ detail, onClose, onSaved }: { detail: Detail; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    await fetch(`/api/projects/${detail.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fd.get("name"), description: fd.get("description") }),
    });
    setBusy(false);
    onSaved();
    onClose();
  }
  return (
    <Modal title="Edit app" onClose={onClose} width={440}>
      <form onSubmit={submit} className="stack">
        <label>Name <input name="name" defaultValue={detail.name} required autoFocus /></label>
        <label>Description
          <input name="description" defaultValue={detail.description ?? ""} placeholder="What does it do?" />
        </label>
        <p className="muted" style={{ fontSize: "0.82rem" }}>Renaming won’t change the app’s web address.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-sm" onClick={async () => {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* clipboard blocked */ }
    }}>
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

function CodeCard({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sourceText =
    detail.source_kind === "git" ? `Deploys from ${detail.repository_url}` :
    detail.source_kind === "upload" ? "Deploys from your uploaded zip." :
    detail.source_kind === "sample" ? `Deploys from the “${detail.sample}” sample.` :
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
      setMessage(res.ok ? "Code uploaded. Press Deploy to ship it." : (await res.json()).error);
    } else if (repo) {
      const res = await fetch(`/api/projects/${detail.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository_url: repo }),
      });
      setMessage(res.ok ? "Repository saved. Press Deploy to ship it." : (await res.json()).error);
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DatabaseCard({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<{ attached: boolean; url: string | null; size: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/database`, { cache: "no-store" });
    if (res.ok) setInfo(await res.json());
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function attach() {
    setBusy(true);
    await fetch(`/api/projects/${projectId}/database`, { method: "POST" });
    setBusy(false);
    load();
  }
  async function detach() {
    if (!confirm("Remove this database? Its data will be permanently deleted.")) return;
    setBusy(true);
    await fetch(`/api/projects/${projectId}/database`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  return (
    <div className="card">
      <h3>Database</h3>
      {!info ? (
        <p className="muted">Loading…</p>
      ) : info.attached ? (
        <>
          <p className="muted">
            SQLite · {fmtBytes(info.size)}. Your app connects via <code>DATABASE_URL</code>. Persists across redeploys.
          </p>
          <p className="app-url"><code>{info.url}</code></p>
          <button className="link-btn" onClick={detach} disabled={busy}>Remove database</button>
        </>
      ) : (
        <>
          <p className="muted">Add a managed SQLite database — no server to run. It’s injected as <code>DATABASE_URL</code>.</p>
          <button className="btn" onClick={attach} disabled={busy}>Add a database</button>
        </>
      )}
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
      <p className="muted">Secrets and config for your app. Redeploy to apply.</p>
      {vars.length > 0 && (
        <ul className="members">
          {vars.map((v) => (
            <li key={v.key}>
              <span className="app-url">{v.key}=<span className="muted">{reveal ? v.value : "••••••"}</span></span>
              <button className="link-btn" onClick={() => remove(v.key)}>remove</button>
            </li>
          ))}
        </ul>
      )}
      {vars.length > 0 && (
        <button className="link-btn" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}
          onClick={() => setReveal((r) => !r)}>{reveal ? "Hide values" : "Show values"}</button>
      )}
      <form onSubmit={add} className="share-form">
        <input name="key" placeholder="API_KEY" pattern="[A-Za-z_][A-Za-z0-9_]*" required style={{ flex: "0 0 40%" }} />
        <input name="value" placeholder="value" required />
        <button className="btn btn-primary" type="submit" disabled={busy}>Add</button>
      </form>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: "owner", editor: "can edit", collaborator: "can use" };

function LinkShareBlock({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{ enabled: boolean; url: string | null }>({ enabled: false, url: null });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/link`, { cache: "no-store" });
    if (r.ok) setState(await r.json());
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function toggle() {
    await fetch(`/api/projects/${projectId}/link`, state.enabled
      ? { method: "DELETE" }
      : { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    load();
  }
  async function reset() {
    await fetch(`/api/projects/${projectId}/link`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rotate: true }),
    });
    setCopied(false);
    load();
  }
  async function copy() {
    if (!state.url) return;
    try { await navigator.clipboard.writeText(state.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  return (
    <div className="link-share">
      <label className="link-toggle">
        <input type="checkbox" checked={state.enabled} onChange={toggle} />
        <span><b>Anyone with the link</b> can open and use this app — no account needed.</span>
      </label>
      {state.enabled && state.url && (
        <>
          <div className="share-form" style={{ marginTop: "0.5rem" }}>
            <input readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn btn-sm" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
            <button className="link-btn" onClick={reset}>revoke</button>
          </div>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
            Link users can’t edit or deploy. “Revoke” turns off the current link for everyone.
          </p>
        </>
      )}
    </div>
  );
}

function SharingCard({ detail, canManage, onChanged }:
  { detail: Detail; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function shareWith(email: string, role: string): Promise<{ emailed?: boolean }> {
    const res = await fetch(`/api/projects/${detail.id}/members`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }),
    });
    onChanged();
    return res.ok ? res.json() : {};
  }
  async function share(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = (fd.get("email") as string).trim();
    const r = await shareWith(email, fd.get("role") as string);
    setMsg(r.emailed ? `Invite emailed to ${email}.` : `${email} added.`);
    form.reset();
    setBusy(false);
  }
  async function removeMember(body: Record<string, string>) {
    await fetch(`/api/projects/${detail.id}/members`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    onChanged();
  }

  return (
    <section className="card sharing">
      <h3>Who can use this app</h3>

      {canManage && <LinkShareBlock projectId={detail.id} />}

      <ul className="people">
        {detail.members.map((m) => (
          <li key={m.user_id}>
            <span className="who"><b>{m.name}</b><span className="muted">{m.email}</span></span>
            {canManage && m.role !== "owner" ? (
              <select className="role-select" value={m.role} onChange={(e) => shareWith(m.email, e.target.value)}>
                <option value="collaborator">can use</option>
                <option value="editor">can edit</option>
              </select>
            ) : (
              <span className="pill pill-role">{ROLE_LABEL[m.role] ?? m.role}</span>
            )}
            {canManage && m.role !== "owner" && (
              <button className="link-btn" onClick={() => removeMember({ user_id: m.user_id })}>remove</button>
            )}
          </li>
        ))}
        {detail.pending_invites.map((i) => (
          <li key={i.email}>
            <span className="who"><b>{i.email}</b><span className="muted">invited · {ROLE_LABEL[i.role] ?? i.role}</span></span>
            {canManage && <button className="link-btn" onClick={() => removeMember({ email: i.email })}>remove</button>}
          </li>
        ))}
      </ul>

      {canManage ? (
        <>
          <form className="share-form" onSubmit={share}>
            <input name="email" type="email" required placeholder="teammate@example.com" />
            <select name="role" defaultValue="collaborator" className="role-select">
              <option value="collaborator">can use</option>
              <option value="editor">can edit</option>
            </select>
            <button className="btn btn-primary" type="submit" disabled={busy}>Invite</button>
          </form>
          {msg && <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{msg}</p>}
        </>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem" }}>Only the owner can change who has access.</p>
      )}
    </section>
  );
}
