"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function Form({ mode, googleEnabled }: { mode: "login" | "signup"; googleEnabled: boolean }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      window.location.href = next.startsWith("/") ? next : "/";
    } else {
      setError((await res.json()).error ?? "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
      {error && <p className="error">{error}</p>}
      {googleEnabled && (
        <>
          <a className="btn btn-google" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
            Continue with Google
          </a>
          <div className="or-divider"><span>or</span></div>
        </>
      )}
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label>Name <input name="name" required autoFocus /></label>
        )}
        <label>Email <input name="email" type="email" required autoFocus={mode === "login"} /></label>
        <label>Password <input name="password" type="password" required minLength={8} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {mode === "signup" ? "Sign up" : "Sign in"}
        </button>
      </form>
      <p className="muted">
        {mode === "signup"
          ? <>Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>
          : <>New here? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
      </p>
      {mode === "login" && (
        <p className="muted"><Link href="/forgot">Forgot your password?</Link></p>
      )}
    </div>
  );
}

export default function AuthForm({ mode, googleEnabled }: { mode: "login" | "signup"; googleEnabled: boolean }) {
  return (
    <Suspense>
      <Form mode={mode} googleEnabled={googleEnabled} />
    </Suspense>
  );
}
