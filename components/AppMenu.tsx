"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";

// The "⋯" overflow menu on an app card / project header. Owners can delete the
// app; everyone else can leave it. Used on the dashboard and the project page.
export default function AppMenu({
  projectId, projectName, isOwner, onDone,
}: {
  projectId: string;
  projectName: string;
  isOwner: boolean;
  onDone?: "home" | "refresh";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "leave">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function after() {
    if (onDone === "home") router.push("/");
    else router.refresh();
  }

  async function run() {
    setBusy(true);
    setErr(null);
    const res = confirm === "delete"
      ? await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
      : await fetch(`/api/projects/${projectId}/members`, {
          method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ self: true }),
        });
    setBusy(false);
    if (res.ok) { setConfirm(null); after(); }
    else setErr((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
  }

  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="icon-btn" aria-label="More actions" aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <div className="menu" role="menu">
          {isOwner ? (
            <button role="menuitem" className="menu-item danger"
              onClick={() => { setOpen(false); setConfirm("delete"); }}>Delete app…</button>
          ) : (
            <button role="menuitem" className="menu-item danger"
              onClick={() => { setOpen(false); setConfirm("leave"); }}>Leave app…</button>
          )}
        </div>
      )}

      {confirm && (
        <Modal title={confirm === "delete" ? "Delete this app?" : "Leave this app?"} onClose={() => setConfirm(null)} width={400}>
          <p className="muted">
            {confirm === "delete"
              ? <>“{projectName}” and all its data will be permanently removed. This can’t be undone.</>
              : <>You’ll lose access to “{projectName}”. The owner can share it with you again later.</>}
          </p>
          {err && <p className="error">{err}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-danger" onClick={run} disabled={busy}>
              {busy ? "Working…" : confirm === "delete" ? "Delete app" : "Leave app"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
