"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const password = new FormData(e.currentTarget).get("password");
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } else {
      setError((await res.json()).error ?? "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <h2>Choose a new password</h2>
      {done ? (
        <p>Password updated. Redirecting you to sign in…</p>
      ) : !token ? (
        <p className="error">This reset link is missing its token. <Link href="/forgot">Request a new one</Link>.</p>
      ) : (
        <>
          {error && <p className="error">{error}</p>}
          <form onSubmit={submit}>
            <label>New password <input name="password" type="password" required minLength={8} autoFocus /></label>
            <button className="btn btn-primary" type="submit" disabled={busy}>Update password</button>
          </form>
          <p className="muted"><Link href="/login">Back to sign in</Link></p>
        </>
      )}
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
