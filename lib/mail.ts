// Email delivery.
//
// Configured via SMTP env vars (see deploy/small-software-cloud.env.example).
// When SMTP isn't configured, or a send fails, the message is written to a local
// outbox file instead — so the platform runs (and is testable) without email set
// up, and sharing never fails just because mail is down. Sending is best-effort
// and non-blocking; callers use `void sendInviteEmail(...)`.
import fs from "node:fs";
import path from "node:path";
import nodemailer, { Transporter } from "nodemailer";
import { DATA_DIR, ensureDirs, platformOrigin } from "./config";

const HOST = process.env.SCLOUD_SMTP_HOST;
const PORT = Number(process.env.SCLOUD_SMTP_PORT ?? 587);
const USER = process.env.SCLOUD_SMTP_USER;
const PASS = process.env.SCLOUD_SMTP_PASS;
const FROM = process.env.SCLOUD_SMTP_FROM || USER || "Small Software Cloud <no-reply@localhost>";
const SECURE = process.env.SCLOUD_SMTP_SECURE === "true" || PORT === 465;

export function mailConfigured(): boolean {
  return !!HOST;
}

let transporter: Transporter | null = null;
function tx(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST, port: PORT, secure: SECURE,
      auth: USER ? { user: USER, pass: PASS } : undefined,
    });
  }
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(m: Mail): Promise<void> {
  try {
    if (!mailConfigured()) return logOutbox(m, "smtp-not-configured");
    await tx().sendMail({ from: FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
  } catch (e: any) {
    logOutbox(m, `send-failed: ${e?.message ?? e}`);
  }
}

function logOutbox(m: Mail, note: string): void {
  try {
    ensureDirs();
    fs.appendFileSync(
      path.join(DATA_DIR, "mail-outbox.log"),
      `\n=== ${new Date().toISOString()} [${note}]\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`
    );
  } catch {
    // last resort — don't let logging failures surface
  }
}

// ---- invite email ----

export interface InviteOpts {
  to: string;
  projectName: string;
  appUrl: string;
  inviterName: string;
  role: "editor" | "collaborator";
  needsSignup: boolean;
}

export function sendInviteEmail(o: InviteOpts): Promise<void> {
  const verb = o.role === "editor" ? "edit" : "use";
  const subject = `${o.inviterName} shared "${o.projectName}" with you`;
  const signupLine = o.needsSignup
    ? "You'll create a quick Small Software Cloud account the first time you open it."
    : "It's now in your Small Software Cloud dashboard.";
  const text =
    `${o.inviterName} invited you to ${verb} "${o.projectName}" on Small Software Cloud.\n\n` +
    `Open it: ${o.appUrl}\n\n${signupLine}\n\nDashboard: ${platformOrigin()}\n`;
  const html =
    `<div style="font-family:system-ui;max-width:32rem">` +
    `<p><b>${escapeHtml(o.inviterName)}</b> invited you to ${verb} ` +
    `<b>${escapeHtml(o.projectName)}</b> on Small Software Cloud.</p>` +
    `<p><a href="${o.appUrl}" style="display:inline-block;background:#2c6bed;color:#fff;` +
    `padding:.5rem 1rem;border-radius:8px;text-decoration:none">Open ${escapeHtml(o.projectName)}</a></p>` +
    `<p style="color:#667">${signupLine}</p></div>`;
  return sendMail({ to: o.to, subject, text, html });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
