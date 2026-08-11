import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { appOriginFor } from "@/lib/config";
import { initPlatform } from "@/lib/deploy";
import { projectsForUser } from "@/lib/projects";
import AppMenu from "@/components/AppMenu";

export const dynamic = "force-dynamic";

function ago(ms?: number | null): string {
  if (!ms) return "";
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}
function statusOf(status: string): { cls: string; label: string } {
  if (status === "running" || status === "stopped") return { cls: "live", label: "Live" };
  if (status === "building") return { cls: "busy", label: "Building" };
  if (status === "failed") return { cls: "fail", label: "Build failed" };
  return { cls: "idle", label: "Not published" };
}

export default async function Home() {
  initPlatform();
  const user = await currentUser();
  if (!user) return <Landing />;

  const projects = projectsForUser(user.id);
  return (
    <>
      <div className="page-head">
        <h1>My apps</h1>
        <Link className="btn btn-primary" href="/projects/new">＋ New app</Link>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <p>You don’t have any apps yet.</p>
          <p><Link className="btn btn-primary btn-lg" href="/projects/new">＋ Create your first app</Link></p>
        </div>
      ) : (
        <div className="apps-grid">
          {projects.map((p) => {
            const s = statusOf(p.status);
            const live = p.status === "running" || p.status === "stopped";
            const updated = ago(p.last_deployed_at ?? p.updated_at);
            return (
              <div className="app-card" key={p.id}>
                <div className="app-card-head">
                  <Link href={`/projects/${p.id}`} className="app-card-name">{p.name}</Link>
                  <AppMenu projectId={p.id} projectName={p.name} isOwner={p.role === "owner"} onDone="refresh" />
                </div>
                {p.description ? <p className="app-card-desc">{p.description}</p> : <p className="app-card-desc muted">No description</p>}
                <div className="app-card-status">
                  <span className={`cdot status-${s.cls}`} aria-hidden="true"></span>
                  <span>{s.label}</span>
                  {updated && <span className="muted">· {updated}</span>}
                </div>
                <div className="app-card-actions">
                  {live && <a className="btn btn-sm btn-primary" href={appOriginFor(p.slug)} target="_blank">Open</a>}
                  <Link className="btn btn-sm" href={`/projects/${p.id}`}>{p.role === "owner" ? "Share" : "Open page"}</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Landing() {
  return (
    <section className="hero">
      <h1>Share software like a document.</h1>
      <p className="lede">
        Build a tool → publish it → share the link.<br />
        No servers, no setup, no cloud console.
      </p>
      <p>
        <Link className="btn btn-primary btn-lg" href="/signup">Get started</Link>{" "}
        <Link className="btn btn-lg" href="/login">Sign in</Link>
      </p>
      <div className="hero-steps">
        <div><span>1</span> Create an app</div>
        <div><span>2</span> Publish</div>
        <div><span>3</span> Share the link</div>
      </div>
    </section>
  );
}
