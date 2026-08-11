"use client";

/*
 * App page — reworked to feel like sharing a Google Doc, not operating a PaaS.
 * Changes (mapped to the brief):
 *  1. Killed the deploy mental model for the common case. No page-level Deploy
 *     button; the app is auto-live. A project that has code but isn't online yet
 *     publishes itself on open; saving code/settings republishes automatically.
 *     Status reads "Live" / "Publishing…" and a Doc-style "Saved" flash.
 *  2. IA/hierarchy: top = inline-editable name + live status + URL + Copy link
 *     (Copy disabled until live). "Who can use this app" is the centerpiece.
 *     Code / env / database live in a CLOSED "Developer settings" section.
 *  4. Safety: making the app public warns when secrets exist, names exactly which
 *     ones would be exposed, and requires an explicit confirm. The checkbox is a
 *     labelled, described control.
 *  5. Plain language + "most people can skip this" on every developer section;
 *     raw terms (DATABASE_URL, API_KEY) live only inside the collapsed section.
 *  6. Removed dead UI; scannable people list with avatars + empty state; Copy
 *     disabled until live.
 *  7. Hierarchy/emphasis: sharing is primary; developer settings are quiet.
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
  role: string; owner_id?: string;
  members: Member[];
  pending_invites: { email: string; role: string }[];
  latest_deployment: { id: string; status: string; logs: string } | null;
}

const ROLE_LABEL: Record<string, string> = { owner: "owner", editor: "can edit", collaborator: "can use" };

function liveState(status: string): { cls: string; label: string } {
  if (status === "running" || status === "stopped") return { cls: "live", label: "Live" };
  if (status === "building") return { cls: "busy", label: "Publishing…" };
  if (status === "failed") return { cls: "fail", label: "Needs attention" };
  return { cls: "idle", label: "Getting ready…" };
}

export default function ProjectView({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [env, setEnv] = useState<EnvVar[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const autoPublished = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { if (canEdit) loadEnv(); }, [canEdit, loadEnv]);

  function flash(msg: string) {
    setSaveMsg(msg);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveMsg(null), 2200);
  }

  // The auto-live model: any save republishes; nothing needs a manual "Deploy".
  const publish = useCallback(async (label = "Publishing…") => {
    flash(label);
    await fetch(`/api/projects/${projectId}/deploy`, { method: "POST" });
    await load();
  }, [projectId, load]);

  // A project that has code but was never put online publishes itself on open.
  useEffect(() => {
    if (!detail || autoPublished.current) return;
    if (canManage && detail.status === "not_deployed" && detail.source_kind !== "none") {
      autoPublished.current = true;
      publish("Getting your app online…");
    }
  }, [detail, canManage, publish]);

  async function patch(fields: Record<string, string>) {
    flash("Saving…");
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(fields),
    });
    flash("Saved");
    await load();
  }

  if (notFound) return <p className="empty">This app doesn’t exist, or you no longer have access.</p>;
  if (!detail) return <p className="empty muted">Loading…</p>;

  const st = liveState(detail.status);
  const isLive = detail.status === "running" || detail.status === "stopped";
  const prettyUrl = detail.app_path.replace(/\/$/, "");

  return (
    <>
      <header className="doc-head">
        <div className="doc-titles">
          <InlineText value={detail.name} canEdit={canEdit} className="proj-name" as="h1"
            placeholder="Untitled app" onSave={(v) => patch({ name: v })} />
          <InlineText value={detail.description} canEdit={canEdit} className="proj-desc"
            placeholder={canEdit ? "Add a description" : ""} onSave={(v) => patch({ description: v })} />
        </div>
        <div className="doc-status">
          <span className={`live-badge live-${st.cls}`}><span className="ldot" aria-hidden="true"></span>{st.label}</span>
          {saveMsg && <span className="save-msg" aria-live="polite">{saveMsg}</span>}
          <AppMenu projectId={projectId} projectName={detail.name} isOwner={canManage} onDone="home" />
        </div>
      </header>

      <div className="doc-url">
        {isLive
          ? <a href={detail.app_path} target="_blank" rel="noreferrer">{prettyUrl}</a>
          : <span className="muted">{prettyUrl}</span>}
        <CopyButton text={prettyUrl} disabled={!isLive}
          label={isLive ? "Copy link" : "Available once it’s live"} />
        {isLive && <a className="open-pill" href={detail.app_path} target="_blank" rel="noreferrer">Open ↗</a>}
      </div>

      {/* The centerpiece: this is the whole product. */}
      <section className="share-hub">
        <h2>Who can use this app</h2>
        <p className="muted hub-sub">Share it like a document — turn on a link, or invite people by email.</p>

        {canManage && <PublicShare projectId={projectId} secrets={env.map((e) => e.key)} isLive={isLive} />}

        <PeopleList detail={detail} canManage={canManage}
          onRole={(email, role) => shareEmail(projectId, email, role).then(load)}
          onRemove={(body) => removeMember(projectId, body).then(load)} />

        {canManage
          ? <InviteRow projectId={projectId} onInvited={(m) => { flash(m); load(); }} />
          : <p className="muted tiny">Only the owner can change who has access.</p>}
      </section>

      {canEdit && (
        <details className="dev">
          <summary>Developer settings <span className="tag">optional</span></summary>
          <div className="dev-body">
            <p className="muted dev-intro">
              For bringing your own code or configuration. <b>Most people can skip this</b> — your app already works.
            </p>
            <CodeCard detail={detail} onSaved={() => publish()} />
            <EnvCard projectId={projectId} vars={env} onChanged={() => { loadEnv(); publish("Applying…"); }} />
            <DatabaseCard projectId={projectId} onChanged={() => publish("Applying…")} />
            <ActivityCard detail={detail} />
          </div>
        </details>
      )}
    </>
  );
}

/* ---------- inline-editable text (name / description) ---------- */

function InlineText({ value, canEdit, className, placeholder, onSave, as = "p" }:
  { value: string; canEdit: boolean; className: string; placeholder: string;
    onSave: (v: string) => void; as?: "h1" | "p" }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);

  const commit = () => {
    setEditing(false);
    const v = val.trim();
    if (v !== (value ?? "").trim()) onSave(v);
  };

  if (editing) {
    return (
      <input className={`${className} inline-input`} value={val} autoFocus
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setVal(value); setEditing(false); }
        }} />
    );
  }
  const Tag = as;
  const show = value || (canEdit ? placeholder : "");
  if (!show) return null;
  return (
    <Tag className={`${className}${canEdit ? " editable" : ""}${!value ? " is-placeholder" : ""}`}
      onClick={canEdit ? () => setEditing(true) : undefined}
      title={canEdit ? "Click to edit" : undefined}>
      {show}{canEdit && <span className="edit-hint" aria-hidden="true"> ✎</span>}
    </Tag>
  );
}

/* ---------- copy button ---------- */

function CopyButton({ text, disabled, label }: { text: string; disabled?: boolean; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-sm" disabled={disabled} title={label}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      }}>
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

/* ---------- public link + secrets safety ---------- */

function PublicShare({ projectId, secrets, isLive }:
  { projectId: string; secrets: string[]; isLive: boolean }) {
  const [state, setState] = useState<{ enabled: boolean; url: string | null }>({ enabled: false, url: null });
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/link`, { cache: "no-store" });
    if (r.ok) setState(await r.json());
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function enable() {
    await fetch(`/api/projects/${projectId}/link`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    setConfirming(false);
    load();
  }
  async function disable() {
    await fetch(`/api/projects/${projectId}/link`, { method: "DELETE" });
    load();
  }
  function onToggle(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.checked) {
      if (secrets.length > 0) { setConfirming(true); return; } // needs an explicit confirm
      enable();
    } else {
      disable();
    }
  }
  async function copy() {
    if (!state.url) return;
    try { await navigator.clipboard.writeText(state.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  return (
    <div className={`public-share${state.enabled ? " on" : ""}`}>
      <label className="switch-row" htmlFor="pub-toggle">
        <input id="pub-toggle" type="checkbox" checked={state.enabled} onChange={onToggle}
          aria-describedby="pub-help" />
        <span className="switch-text">
          <b>Anyone with the link can use this app</b>
          <span id="pub-help" className="muted tiny">No account or sign-in needed. They can use it, but can’t edit it or see your settings.</span>
        </span>
      </label>

      {secrets.length > 0 && !state.enabled && (
        <p className="secrets-note tiny">
          ⚠️ This app has {secrets.length} saved secret{secrets.length > 1 ? "s" : ""}. Turning this on lets anyone
          with the link run code that uses {secrets.length > 1 ? "them" : "it"}.
        </p>
      )}

      {state.enabled && state.url && (
        <div className="link-row">
          <input readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
          <button className="btn btn-sm" onClick={copy} disabled={!isLive}>{copied ? "Copied!" : "Copy"}</button>
          <button className="link-btn" onClick={disable}>turn off</button>
        </div>
      )}

      {confirming && (
        <Modal title="Make this app public?" onClose={() => setConfirming(false)} width={440}>
          <p>Anyone with the link will be able to open and use this app with <b>no sign-in</b>.</p>
          <p className="muted">It has these saved secrets, which the running app can use — so link visitors can trigger anything the app does with them:</p>
          <ul className="secret-list">
            {secrets.map((k) => <li key={k}><code>{k}</code></li>)}
          </ul>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={enable}>Make public anyway</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- people list ---------- */

function avatarColor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
}
function initials(name: string, email: string): string {
  const base = (name || email || "?").trim();
  const parts = base.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase() || "?";
}
function Avatar({ name, email }: { name: string; email: string }) {
  return <span className="avatar" style={{ background: avatarColor(email || name) }} aria-hidden="true">{initials(name, email)}</span>;
}

function PeopleList({ detail, canManage, onRole, onRemove }:
  { detail: Detail; canManage: boolean; onRole: (email: string, role: string) => void; onRemove: (b: Record<string, string>) => void }) {
  const others = detail.members.filter((m) => m.role !== "owner").length + detail.pending_invites.length;
  return (
    <ul className="people-list">
      {detail.members.map((m) => (
        <li key={m.user_id} className="person">
          <Avatar name={m.name} email={m.email} />
          <span className="person-id"><b>{m.name}</b><span className="muted">{m.email}</span></span>
          {canManage && m.role !== "owner" ? (
            <select className="role-select" value={m.role} aria-label={`Role for ${m.email}`}
              onChange={(e) => onRole(m.email, e.target.value)}>
              <option value="collaborator">can use</option>
              <option value="editor">can edit</option>
            </select>
          ) : (
            <span className="pill pill-role">{ROLE_LABEL[m.role] ?? m.role}</span>
          )}
          {canManage && m.role !== "owner" &&
            <button className="link-btn" onClick={() => onRemove({ user_id: m.user_id })}>remove</button>}
        </li>
      ))}
      {detail.pending_invites.map((i) => (
        <li key={i.email} className="person pending">
          <Avatar name="" email={i.email} />
          <span className="person-id"><b>{i.email}</b><span className="muted">invited · {ROLE_LABEL[i.role] ?? i.role}</span></span>
          {canManage && <button className="link-btn" onClick={() => onRemove({ email: i.email })}>remove</button>}
        </li>
      ))}
      {others === 0 && <li className="people-empty">No one else has access yet.{canManage ? " Invite someone below, or turn on the link above." : ""}</li>}
    </ul>
  );
}

async function shareEmail(projectId: string, email: string, role: string): Promise<{ emailed?: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/members`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }),
  });
  return res.ok ? res.json() : {};
}
async function removeMember(projectId: string, body: Record<string, string>) {
  await fetch(`/api/projects/${projectId}/members`, {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function InviteRow({ projectId, onInvited }: { projectId: string; onInvited: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string).trim();
    const r = await shareEmail(projectId, email, fd.get("role") as string);
    e.currentTarget.reset();
    setBusy(false);
    onInvited(r.emailed ? `Invite emailed to ${email}.` : `${email} added.`);
  }
  return (
    <form className="invite-row" onSubmit={submit}>
      <input name="email" type="email" required placeholder="Add someone by email…" aria-label="Email to invite" />
      <select name="role" defaultValue="collaborator" className="role-select" aria-label="Access level">
        <option value="collaborator">can use</option>
        <option value="editor">can edit</option>
      </select>
      <button className="btn btn-primary" type="submit" disabled={busy}>Invite</button>
    </form>
  );
}

/* ---------- developer section ---------- */

function CodeCard({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sourceText =
    detail.source_kind === "git" ? `Currently deploys from ${detail.repository_url}` :
    detail.source_kind === "upload" ? "Currently deploys from your uploaded zip." :
    detail.source_kind === "sample" ? `Started from the “${detail.sample}” example.` :
    "No code connected yet.";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const zip = fd.get("code_zip") as File | null;
    const repo = (fd.get("repository_url") as string | null)?.trim();
    let ok = false;
    if (zip && zip.size > 0) {
      const upload = new FormData(); upload.append("code_zip", zip);
      const res = await fetch(`/api/projects/${detail.id}/code`, { method: "POST", body: upload });
      ok = res.ok; if (!ok) setMessage((await res.json()).error);
    } else if (repo) {
      const res = await fetch(`/api/projects/${detail.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository_url: repo }),
      });
      ok = res.ok; if (!ok) setMessage((await res.json()).error);
    } else {
      setMessage("Enter a repository link or choose a zip file first.");
    }
    form.reset(); setBusy(false);
    if (ok) onSaved(); // auto-publishes
  }

  return (
    <div className="card">
      <h3>Your code</h3>
      <p className="muted">Where the app’s code comes from. It already has code — you only need this to point it at your own GitHub repo or upload a zip. Saving publishes it automatically.</p>
      <p className="muted tiny">{sourceText}</p>
      {message && <p className="error tiny">{message}</p>}
      <form onSubmit={submit} className="stack">
        <label>GitHub repository <input name="repository_url" placeholder="https://github.com/you/your-app" /></label>
        <label>…or upload a zip <input type="file" name="code_zip" accept=".zip" /></label>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save & publish"}</button>
      </form>
    </div>
  );
}

function EnvCard({ projectId, vars, onChanged }: { projectId: string; vars: EnvVar[]; onChanged: () => void }) {
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    await fetch(`/api/projects/${projectId}/env`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: fd.get("key"), value: fd.get("value") }),
    });
    form.reset(); setBusy(false); onChanged();
  }
  async function remove(key: string) {
    await fetch(`/api/projects/${projectId}/env`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }),
    });
    onChanged();
  }

  return (
    <div className="card">
      <h3>Secrets &amp; settings</h3>
      <p className="muted">Private keys or settings your app needs (like an API key). <b>Most people can skip this.</b> Changes apply automatically.</p>
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
          <button className="link-btn" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}
            onClick={() => setReveal((r) => !r)}>{reveal ? "Hide values" : "Show values"}</button>
        </>
      )}
      <form onSubmit={add} className="share-form">
        <input name="key" placeholder="NAME" pattern="[A-Za-z_][A-Za-z0-9_]*" required style={{ flex: "0 0 38%" }} aria-label="Secret name" />
        <input name="value" placeholder="value" required aria-label="Secret value" />
        <button className="btn" type="submit" disabled={busy}>Add</button>
      </form>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DatabaseCard({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
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
    setBusy(false); load(); onChanged();
  }
  async function detach() {
    if (!confirm("Remove this database? Its data will be permanently deleted.")) return;
    setBusy(true);
    await fetch(`/api/projects/${projectId}/database`, { method: "DELETE" });
    setBusy(false); load(); onChanged();
  }

  return (
    <div className="card">
      <h3>Storage</h3>
      <p className="muted">A place for your app to save data that sticks around between visits. Add it only if your app needs to remember things.</p>
      {!info ? <p className="muted tiny">Loading…</p> : info.attached ? (
        <>
          <p className="muted tiny">On · {fmtBytes(info.size)} used. <code>{info.url}</code></p>
          <button className="link-btn" onClick={detach} disabled={busy}>Remove storage</button>
        </>
      ) : (
        <button className="btn" onClick={attach} disabled={busy}>Add storage</button>
      )}
    </div>
  );
}

function ActivityCard({ detail }: { detail: Detail }) {
  return (
    <div className="card">
      <h3>Activity log</h3>
      <p className="muted tiny">The technical record of the last publish — handy if something went wrong.</p>
      <pre className="logs">{detail.latest_deployment?.logs || "Nothing published yet."}</pre>
    </div>
  );
}
