"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeployButton({ projectId, small }: { projectId: string; small?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`btn btn-primary ${small ? "btn-sm" : ""}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/projects/${projectId}/deploy`, { method: "POST" });
        router.push(`/projects/${projectId}`);
        router.refresh();
      }}
    >
      {busy ? "Deploying…" : "Deploy"}
    </button>
  );
}
