"use client";

/*
 * App page — a three-state experience (ADD → PUBLISH → SHARE):
 *   NEW/unpublished  → goal is getting the app onto TaskiCloud. Hierarchy:
 *                      header + "Publish", "Add your app" is the main content,
 *                      a short secondary preview, advanced collapsed.
 *   BUILDING         → a simple "Getting your app ready…" progress state; no
 *                      technical logs by default.
 *   LIVE             → share-first. "Your app is live", prominent URL + Copy,
 *                      "Who can use this app?" as the dominant section, and the
 *                      running-app preview becomes prominent.
 * Advanced settings (secrets, storage, runtime) stay progressively disclosed.
 * No functionality removed — only reordered/relabelled per state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AppMenu from "./AppMenu";
import Modal from "./Modal";

interface Member { user_id: string; name: string; email: string; role: string }
interface EnvVar { key: string; value: string }
interface Detail {
  id: string; name: string; description: string; slug: string;
  status: string; status_label: string; url: string | null; app_path: string;
  source_kind: string; repository_url: string; sample: string;
  role: string; owner_id?: string; last_deployed_at?: number | null;
  members: Member[];
  pending_invites: { email: string; role: string }[];
  latest_deployment: { id: string; status: string; logs: string; completed_at?: number | null } | null;
}

const ROLE_LABEL: Record<string, string> = { owner: "owner", editor: "can edit", collaborator: "can use" };

function ago(ms?: number | null): string {
  if (!ms) return "";
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} minute${m > 1 ? "s" : ""} ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24); return `${d} day${d > 1 ? "s" : ""} ago`;
}

export default function ProjectView({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [env, setEnv] = useState<EnvVar[]>([]);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = !!detail && (detail.role === "owner" || detail.role === "editor");
  const canManage = !!detail && detail.role === "owner";

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.status === 401) { window.location.href = `/login?next=/projects/${projectId}`; return; }
    if (!res.ok) { setNotFound(true); return; }
    setDetail(await res.json());
  }, [projectId]);

  const loadEnv = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/env`, { cache: "no-store" });
    if (res.ok) setEnv((await res.json()).env ?? []);
  }, [projectId]);

  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (canEdit) loadEnv(); }, [canEdit, loadEnv]);

  function flash(msg: string) {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 2400);
  }
  async function publish() {
    flash("Publishing…");
    await fetch(`/api/projects/${projectId}/deploy`, { method: "POST" });
    await load();
  }

  if (notFound) return <p className="empty">This app doesn’t exist, or you no longer have access.</p>;
  if (!detail) return <p className="empty muted">Loading…</p>;

  const isLive = detail.status === "running" || detail.status === "stopped";
  const building = detail.status === "building";
  const failed = detail.status === "failed";
  const hasSource = detail.source_kind !== "none";
  const chip =
    isLive ? { cls: "live", label: "Live" } :
    building ? { cls: "busy", label: "Building" } :
    failed ? { cls: "fail", label: "Build failed" } :
    { cls: "idle", label: "Not published" };
  const prettyUrl = detail.app_path.replace(/\/$/, "");

  return (
    <article className="app-page">
      {/* HEADER — name, description, then status + state-dependent actions */}
      <header className="app-header">
        <InlineText value={detail.name} canEdit={canEdit} className="app-name" as="h1"
          placeholder="Untitled app" onSave={(v) => { flash("Saved"); patch(projectId, { name: v }, load); }} />
        <InlineText value={detail.description} canEdit={canEdit} className="app-tagline"
          placeholder={canEdit ? "Add a description" : ""} onSave={(v) => { flash("Saved"); patch(projectId, { description: v }, load); }} />
        <div className="header-bottom">
          <div className="header-status">
            <span className={`status-chip status-${chip.cls}`}><span className="cdot" aria-hidden="true"></span>{chip.label}</span>
            {flashMsg && <span className="flash" aria-live="polite">{flashMsg}</span>}
          </div>
          <div className="app-actions">
            {isLive ? (
              <>
                <a className="btn btn-primary" href={detail.app_path} target="_blank" rel="noreferrer">Open app ↗</a>
                {canManage && <button className="btn" onClick={() => document.getElementById("share")?.scrollIntoView({ behavior: "smooth" })}>Share</button>}
                <AppMenu projectId={projectId} projectName={detail.name} isOwner={canManage} onDone="home" />
              </>
            ) : (
              <>
                {canEdit && (
                  <button className="btn btn-primary" disabled={building || !hasSource} onClick={publish}
                    title={!hasSource ? "Add your app below first" : undefined}>
                    {building ? "Publishing…" : "Publish"}
                  </button>
                )}
                <AppMenu projectId={projectId} projectName={detail.name} isOwner={canManage} onDone="home" />
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- LIVE: share-first ---------- */}
      {isLive && (
        <>
          <section id="share" className="panel share-panel">
            <div className="live-headline">🎉 Your app is live</div>
            <p className="panel-sub">Share this link — it opens the running app.</p>
            <UrlRow url={prettyUrl} />
            {canManage
              ? <AccessControl detail={detail} secrets={env.map((e) => e.key)} onChanged={load} />
              : <p className="muted tiny">The owner controls who can use this app.</p>}
          </section>

          <AppWindow prettyUrl={prettyUrl} appPath={detail.app_path} live prominent />

          {canEdit && <AppSource detail={detail} live onSaved={() => flash("Saved — press Update to apply.")} />}
        </>
      )}

      {/* ---------- BUILDING: simple progress ---------- */}
      {building && (
        <section className="panel building-panel">
          <div className="spinner" aria-hidden="true"></div>
          <h2>Getting your app ready…</h2>
          <p className="panel-sub">TaskiCloud is building and starting your app. This usually takes a few seconds.</p>
        </section>
      )}

      {/* ---------- NEW / FAILED: add-your-app-first ---------- */}
      {!isLive && !building && canEdit && (
        <>
          <AppSource detail={detail} live={false} onSaved={() => flash("Added — press Publish to go live.")} />
          {failed && <p className="fail-hint">The last publish didn’t finish. Check your app above, then Publish again — open Activity for details.</p>}
          <AppWindow prettyUrl={prettyUrl} appPath={detail.app_path} live={false} prominent={false} />
        </>
      )}

      {/* ADVANCED — always secondary, closed */}
      {canEdit && (
        <details className="advanced-panel">
          <summary>Advanced settings <span className="tag">optional</span></summary>
          <div className="advanced-body">
            <p className="muted dev-intro">Only configure these if your app needs them. TaskiCloud handles everything else automatically.</p>
            <EnvCard projectId={projectId} vars={env} onChanged={loadEnv} />
            <DatabaseCard projectId={projectId} />
            <div className="mini-note"><b>Runtime &amp; compute</b> — detected and managed automatically (Node, Python, or a static site). Nothing to configure.</div>
          </div>
        </details>
      )}

      {/* ACTIVITY — lightweight, logs on request */}
      {canEdit && (detail.latest_deployment || isLive) && <Activity detail={detail} />}
    </article>
  );
}

async function patch(projectId: string, fields: Record<string, string>, reload: () => void) {
  await fetch(`/api/projects/${projectId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(fields),
  });
  reload();
}

/* ---------- inline-editable text ---------- */
function InlineText({ value, canEdit, className, placeholder, onSave, as = "p" }:
  { value: string; canEdit: boolean; className: string; placeholder: string; onSave: (v: string) => void; as?: "h1" | "p" }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);
  const commit = () => { setEditing(false); const v = val.trim(); if (v !== (value ?? "").trim()) onSave(v); };
  if (editing) {
    return <input className={`${className} inline-input`} value={val} autoFocus placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setVal(value); setEditing(false); } }} />;
  }
  const Tag = as;
  const show = value || (canEdit ? placeholder : "");
  if (!show) return null;
  return (
    <Tag className={`${className}${canEdit ? " editable" : ""}${!value ? " is-placeholder" : ""}`}
      onClick={canEdit ? () => setEditing(true) : undefined} title={canEdit ? "Click to edit" : undefined}>
      {show}{canEdit && <span className="edit-hint" aria-hidden="true"> ✎</span>}
    </Tag>
  );
}

/* ---------- url + copy ---------- */
function UrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="url-row">
      <a className="url-text" href={url} target="_blank" rel="noreferrer">{url}</a>
      <button className="btn btn-primary btn-copy" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      }}>{copied ? "Copied!" : "Copy"}</button>
    </div>
  );
}

/* ---------- app window (short when unpublished, prominent when live) ---------- */
function AppWindow({ prettyUrl, appPath, live, prominent }:
  { prettyUrl: string; appPath: string; live: boolean; prominent: boolean }) {
  return (
    <section className={`panel preview-panel${prominent ? " prominent" : " compact"}`}>
      <div className="win-bar">
        <span className={`win-dot ${live ? "on" : ""}`} aria-hidden="true"></span>
        <span className="win-url">{prettyUrl}</span>
      </div>
      <div className="preview-empty">
        {live ? (
          <>
            <div className="preview-emoji" aria-hidden="true">🚀</div>
            <p><b>Your app is running.</b> TaskiCloud keeps it online for you.</p>
            <a className="btn" href={appPath} target="_blank" rel="noreferrer">Open app ↗</a>
          </>
        ) : (
          <p className="muted"><b>App preview</b> — publish your app to see it here.</p>
        )}
      </div>
    </section>
  );
}

/* ---------- access control (3 modes + people + secrets safety) ---------- */
function avatarColor(seed: string): string { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; }
function initials(name: string, email: string): string {
  const b = (name || email || "?").trim(); const p = b.split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[1][0] : "")).toUpperCase() || "?";
}
function Avatar({ name, email }: { name: string; email: string }) {
  return <span className="avatar" style={{ background: avatarColor(email || name) }} aria-hidden="true">{initials(name, email)}</span>;
}
const MODES: { key: "me" | "invite" | "anyone"; label: string; hint: string }[] = [
  { key: "me", label: "Only me", hint: "Just you can open it." },
  { key: "invite", label: "People I invite", hint: "Only people you add by email." },
  { key: "anyone", label: "Anyone with the link", hint: "No sign-in — anyone with the link can use it." },
];

function AccessControl({ detail, secrets, onChanged }:
  { detail: Detail; secrets: string[]; onChanged: () => void }) {
  const [link, setLink] = useState<{ enabled: boolean; url: string | null }>({ enabled: false, url: null });
  const [userMode, setUserMode] = useState<"me" | "invite" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const others = detail.members.filter((m) => m.role !== "owner").length + detail.pending_invites.length;
  const eff: "me" | "invite" | "anyone" = link.enabled ? "anyone" : (userMode ?? (others > 0 ? "invite" : "me"));

  const loadLink = useCallback(async () => {
    const r = await fetch(`/api/projects/${detail.id}/link`, { cache: "no-store" });
    if (r.ok) setLink(await r.json());
  }, [detail.id]);
  useEffect(() => { loadLink(); }, [loadLink]);

  async function enableLink() {
    await fetch(`/api/projects/${detail.id}/link`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    setConfirming(false); loadLink();
  }
  async function disableLink() { await fetch(`/api/projects/${detail.id}/link`, { method: "DELETE" }); loadLink(); }
  async function select(m: "me" | "invite" | "anyone") {
    if (m === "anyone") { if (secrets.length > 0) { setConfirming(true); return; } await enableLink(); }
    else { setUserMode(m); if (link.enabled) await disableLink(); }
  }
  async function shareWith(email: string, role: string) {
    const r = await fetch(`/api/projects/${detail.id}/members`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }),
    });
    onChanged();
    return r.ok ? r.json() : {};
  }
  async function removeMember(body: Record<string, string>) {
    await fetch(`/api/projects/${detail.id}/members`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    onChanged();
  }
  async function copyLink() {
    if (!link.url) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string).trim();
    const r = await shareWith(email, fd.get("role") as string);
    e.currentTarget.reset();
    setInviteMsg((r as { emailed?: boolean }).emailed ? `Invite emailed to ${email}.` : `${email} added.`);
  }

  return (
    <div className="access">
      <div className="access-label">Who can use this app?</div>
      <div className="access-seg" role="radiogroup" aria-label="Who can use this app">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={eff === m.key}
            className={`seg${eff === m.key ? " on" : ""}`} onClick={() => select(m.key)}>{m.label}</button>
        ))}
      </div>
      <p className="access-hint tiny">{MODES.find((m) => m.key === eff)!.hint}</p>

      {eff === "anyone" && link.url && (
        <div className="link-row">
          <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
          <button className="btn btn-sm" onClick={copyLink}>{copied ? "Copied!" : "Copy"}</button>
        </div>
      )}
      {eff === "anyone" && secrets.length > 0 && (
        <p className="secrets-note tiny">This app has secrets ({secrets.join(", ")}) — link visitors can trigger anything the app does with them.</p>
      )}

      {eff !== "anyone" && (
        <div className="people-block">
          <ul className="people-list">
            {detail.members.map((m) => (
              <li key={m.user_id} className="person">
                <Avatar name={m.name} email={m.email} />
                <span className="person-id"><b>{m.name}</b><span className="muted">{m.email}</span></span>
                {m.role !== "owner"
                  ? <select className="role-select" value={m.role} aria-label={`Role for ${m.email}`}
                      onChange={(e) => shareWith(m.email, e.target.value)}>
                      <option value="collaborator">can use</option><option value="editor">can edit</option>
                    </select>
                  : <span className="pill pill-role">{ROLE_LABEL[m.role]}</span>}
                {m.role !== "owner" && <button className="link-btn" onClick={() => removeMember({ user_id: m.user_id })}>remove</button>}
              </li>
            ))}
            {detail.pending_invites.map((i) => (
              <li key={i.email} className="person pending">
                <Avatar name="" email={i.email} />
                <span className="person-id"><b>{i.email}</b><span className="muted">invited · {ROLE_LABEL[i.role] ?? i.role}</span></span>
                <button className="link-btn" onClick={() => removeMember({ email: i.email })}>remove</button>
              </li>
            ))}
          </ul>
          {eff === "invite"
            ? (
              <>
                <form className="invite-row" onSubmit={invite}>
                  <input name="email" type="email" required placeholder="Add someone by email…" aria-label="Email to invite" />
                  <select name="role" defaultValue="collaborator" className="role-select" aria-label="Access level">
                    <option value="collaborator">can use</option><option value="editor">can edit</option>
                  </select>
                  <button className="btn btn-primary" type="submit">Invite</button>
                </form>
                {inviteMsg && <p className="muted tiny">{inviteMsg}</p>}
              </>
            )
            : <button className="link-add" onClick={() => setUserMode("invite")}>＋ Invite specific people</button>}
        </div>
      )}

      {confirming && (
        <Modal title="Make this app public?" onClose={() => setConfirming(false)} width={440}>
          <p>Anyone with the link will be able to open and use this app with <b>no sign-in</b>.</p>
          <p className="muted">It has these saved secrets, which the running app can use — so link visitors can trigger anything the app does with them:</p>
          <ul className="secret-list">{secrets.map((k) => <li key={k}><code>{k}</code></li>)}</ul>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={enableLink}>Make public anyway</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- add your app / app source ---------- */
function AppSource({ detail, live, onSaved }: { detail: Detail; live: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const source =
    detail.source_kind === "git" ? `Connected to ${detail.repository_url}` :
    detail.source_kind === "upload" ? "Using your uploaded zip." :
    detail.source_kind === "sample" ? `Started from the “${detail.sample}” template.` :
    "No app added yet.";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const form = e.currentTarget; const fd = new FormData(form);
    const zip = fd.get("code_zip") as File | null;
    const repo = (fd.get("repository_url") as string | null)?.trim();
    let ok = false;
    if (zip && zip.size > 0) {
      const up = new FormData(); up.append("code_zip", zip);
      const res = await fetch(`/api/projects/${detail.id}/code`, { method: "POST", body: up });
      ok = res.ok; if (!ok) setMessage((await res.json()).error);
    } else if (repo) {
      const res = await fetch(`/api/projects/${detail.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository_url: repo }) });
      ok = res.ok; if (!ok) setMessage((await res.json()).error);
    } else { setMessage("Add a GitHub link or choose a zip file first."); }
    form.reset(); setBusy(false); if (ok) onSaved();
  }

  return (
    <section className={`panel source-panel${live ? "" : " primary-step"}`}>
      <h2>{live ? "App source" : "Add your app"}</h2>
      <p className="panel-sub">Connect a GitHub repository or upload your app.</p>
      <p className="muted tiny">{source}</p>
      {message && <p className="error tiny">{message}</p>}
      <form onSubmit={submit} className="stack">
        <label>GitHub repository <input name="repository_url" placeholder="https://github.com/you/your-app" /></label>
        <label>…or upload a zip <input type="file" name="code_zip" accept=".zip" /></label>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : live ? "Save" : "Add app"}</button>
      </form>
    </section>
  );
}

/* ---------- advanced: env + storage ---------- */
function EnvCard({ projectId, vars, onChanged }: { projectId: string; vars: EnvVar[]; onChanged: () => void }) {
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const form = e.currentTarget; const fd = new FormData(form);
    await fetch(`/api/projects/${projectId}/env`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: fd.get("key"), value: fd.get("value") }) });
    form.reset(); setBusy(false); onChanged();
  }
  async function remove(key: string) {
    await fetch(`/api/projects/${projectId}/env`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    onChanged();
  }
  return (
    <div className="adv-card">
      <h3>Secrets &amp; settings</h3>
      <p className="muted tiny">Private keys your app needs, like an API key. Press <b>Update</b> after changing.</p>
      {vars.length > 0 && (
        <>
          <ul className="members">
            {vars.map((v) => (
              <li key={v.key}>
                <span className="app-url">{v.key}=<span className="muted">{reveal ? v.value : "••••••"}</span></span>
                <button className="link-btn" onClick={() => remove(v.key)}>remove</button>
              </li>
            ))}
          </ul>
          <button className="link-btn" style={{ color: "var(--accent)", marginBottom: "0.5rem" }} onClick={() => setReveal((r) => !r)}>{reveal ? "Hide values" : "Show values"}</button>
        </>
      )}
      <form onSubmit={add} className="share-form">
        <input name="key" placeholder="NAME" pattern="[A-Za-z_][A-Za-z0-9_]*" required style={{ flex: "0 0 38%" }} aria-label="Secret name" />
        <input name="value" placeholder="value" required aria-label="Secret value" />
        <button className="btn btn-sm" type="submit" disabled={busy}>Add</button>
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
  async function attach() { setBusy(true); await fetch(`/api/projects/${projectId}/database`, { method: "POST" }); setBusy(false); load(); }
  async function detach() {
    if (!confirm("Remove this storage? Its data will be permanently deleted.")) return;
    setBusy(true); await fetch(`/api/projects/${projectId}/database`, { method: "DELETE" }); setBusy(false); load();
  }
  return (
    <div className="adv-card">
      <h3>Storage</h3>
      <p className="muted tiny">A place for your app to save data between visits. Add it only if your app needs to remember things.</p>
      {!info ? <p className="muted tiny">Loading…</p> : info.attached ? (
        <><p className="muted tiny">On · {fmtBytes(info.size)} used.</p><button className="link-btn" onClick={detach} disabled={busy}>Remove storage</button></>
      ) : <button className="btn btn-sm" onClick={attach} disabled={busy}>Add storage</button>}
    </div>
  );
}

/* ---------- activity ---------- */
function Activity({ detail }: { detail: Detail }) {
  const [showLogs, setShowLogs] = useState(false);
  const dep = detail.latest_deployment;
  const when = ago(detail.last_deployed_at ?? dep?.completed_at ?? null);
  const line =
    detail.status === "building" ? "Publishing now…" :
    detail.status === "failed" ? "Last publish failed." :
    dep && when ? `Published ${when} · Build successful` :
    "Not published yet.";
  return (
    <section className="panel activity-panel">
      <div className="activity-row">
        <div>
          <div className="activity-line">{line}</div>
          <div className="muted tiny">TaskiCloud builds, runs, and keeps your app online automatically.</div>
        </div>
        {dep && <button className="link-btn view-logs" onClick={() => setShowLogs(true)}>View logs</button>}
      </div>
      {showLogs && (
        <Modal title="Build logs" onClose={() => setShowLogs(false)} width={640}>
          <pre className="logs">{dep?.logs || "No logs yet."}</pre>
        </Modal>
      )}
    </section>
  );
}
