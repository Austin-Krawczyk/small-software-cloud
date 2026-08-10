"use client";

import { useEffect, useState } from "react";

export default function TokensPanel() {
  const [tokens, setTokens] = useState<{ label: string; created_at: number }[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/tokens");
    if (res.ok) setTokens((await res.json()).tokens);
  };
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const label = (new FormData(form).get("label") as string).trim() || "CLI";
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (res.ok) setNewToken((await res.json()).token);
    form.reset();
    load();
  }

  return (
    <>
      <h3>API tokens</h3>
      <p className="muted">
        For the <code>smallsoftware</code> CLI and AI agents.
        Use as <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      {newToken && (
        <div className="token-reveal">
          <p><strong>Copy this token now — it won&apos;t be shown again:</strong></p>
          <pre>{newToken}</pre>
        </div>
      )}
      <ul className="members">
        {tokens.map((t, i) => (
          <li key={i}>
            <span>{t.label}</span>
            <span className="muted">{new Date(t.created_at).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
      <form className="share-form" onSubmit={create}>
        <input name="label" placeholder="Token name (e.g. CLI)" />
        <button className="btn btn-primary" type="submit">Create token</button>
      </form>
    </>
  );
}
