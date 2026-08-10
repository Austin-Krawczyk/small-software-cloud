"use client";

export default function LogoutButton() {
  return (
    <button
      className="link-like"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
