"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const email = new FormData(e.currentTarget).get("email");
    const res = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) setSent(true);
    else setError((await res.json()).error ?? "Something went wrong.");
    setBusy(false);
  }

  return (
    <div className="card auth-card">
      <h2>Reset your password</h2>
      {sent ? (
        <>
          <p>If an account exists for that email, we've sent a reset link. Check your inbox.</p>
          <p className="muted"><Link href="/login">Back to sign in</Link></p>
        </>
      ) : (
        <>
          {error && <p className="error">{error}</p>}
          <form onSubmit={submit}>
            <label>Email <input name="email" type="email" required autoFocus /></label>
            <button className="btn btn-primary" type="submit" disabled={busy}>Send reset link</button>
          </form>
          <p className="muted"><Link href="/login">Back to sign in</Link></p>
        </>
      )}
    </div>
  );
}
