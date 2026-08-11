import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { appOriginFor } from "@/lib/config";
import { STATUS_LABELS } from "@/lib/db";
import { initPlatform } from "@/lib/deploy";
import { projectsForUser } from "@/lib/projects";
import DeployButton from "@/components/DeployButton";
import AppMenu from "@/components/AppMenu";

export const dynamic = "force-dynamic";

export default async function Home() {
  initPlatform();
  const user = await currentUser();
  if (!user) return <Landing />;

  const projects = projectsForUser(user.id);
  return (
    <>
      <div className="page-head">
        <h1>My Software</h1>
        <Link className="btn btn-primary" href="/projects/new">+ New app</Link>
      </div>

      {projects.length === 0 && (
        <div className="empty">
          <p>Nothing here yet.</p>
          <p><Link className="btn btn-primary" href="/projects/new">Create your first app</Link></p>
        </div>
      )}

      <div className="grid">
        {projects.map((p) => (
          <div className="card project-card" key={p.id}>
            <div className="card-top">
              <h3><Link href={`/projects/${p.id}`}>{p.name}</Link></h3>
              <div className="card-top-right">
                <span className={`pill pill-${p.status}`}>{STATUS_LABELS[p.status]}</span>
                <AppMenu projectId={p.id} projectName={p.name} isOwner={p.role === "owner"} onDone="refresh" />
              </div>
            </div>
            {p.description ? <p className="muted">{p.description}</p> : null}
            <p className="app-url">
              {p.status === "running"
                ? <a href={appOriginFor(p.slug)} target="_blank">{appOriginFor(p.slug)}</a>
                : <span className="muted">{appOriginFor(p.slug)}</span>}
            </p>
            <div className="card-actions">
              {p.status === "running" && (
                <a className="btn btn-sm btn-primary" href={appOriginFor(p.slug)} target="_blank">Open</a>
              )}
              {(p.role === "owner" || p.role === "editor") && <DeployButton projectId={p.id} small />}
              <Link className="btn btn-sm" href={`/projects/${p.id}`}>
                {p.role === "owner" ? "Manage" : "Details"}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Landing() {
  return (
    <section className="hero">
      <h1>Share software like a document.</h1>
      <p className="lede">
        Build a tool → click <strong>Deploy</strong> → share the link.<br />
        No servers, no containers, no cloud consoles.
      </p>
      <p>
        <Link className="btn btn-primary btn-lg" href="/signup">Get started</Link>{" "}
        <Link className="btn btn-lg" href="/login">Sign in</Link>
      </p>
      <div className="hero-steps">
        <div><span>1</span> Create a project</div>
        <div><span>2</span> Click Deploy</div>
        <div><span>3</span> Share with a teammate</div>
      </div>
    </section>
  );
}
