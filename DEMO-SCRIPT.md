# YC demo video — shot-by-shot script

Target: **~90 seconds**, screen recording of the real product on taskicloud.com.
Well under the 3 min / 100 MB limit (see recording settings at the bottom).

The whole point of the video: **it's real, it's live, and sharing needs no account.**
Don't explain the architecture — show the loop.

Before you hit record:
- Sign in to `https://taskicloud.com` in a normal browser window.
- Open a **second, incognito/private** window (this is your "colleague" — it has no session). Put the two windows side by side, or be ready to Alt-Tab.
- Have the app you'll deploy ready: the built-in **sample** is the safe choice (zero chance of a build failure on camera).

---

## The shots

**[0:00–0:12] The hook — say this over the dashboard**
> "Teams build little internal tools all the time now, especially with AI. They're easy to make and still annoying to share. This is Small Software Cloud — watch me take one live and share it in under a minute."
Screen: your dashboard at taskicloud.com.

**[0:12–0:35] Deploy**
- Click **New app** → pick the sample (or paste a repo URL) → **Create** → **Deploy**.
- Let the deploy log stream. Narrate while it runs:
> "No servers, no Docker, no config. It detects the app, builds it in an isolated sandbox, and gives it its own URL."
- Land on `✓ Health check passed → Running`.

**[0:35–0:50] It's live**
- Click the app's URL. It opens, running, on its own `*.taskicloud.com` subdomain with HTTPS.
> "That's it — live on the internet, behind a login wall the app itself never had to write."

**[0:50–1:12] Share it — the point of the whole thing**
- Back on the project page, flip **"Anyone with the link can use this."**
- Click **Copy**.
> "Now the part everyone gets wrong. Sharing. I turn on a link — like a Google Doc."
- Switch to the **incognito window**. Paste the link. **It opens the app immediately — no login, no signup.**
> "That's a brand-new person. No account, nothing. They just use it. And I can revoke this link in one click."

**[1:12–1:25] Close**
> "Build a tool, click deploy, share the link. That's the whole thing — and it's live today at taskicloud.com."
Screen: the shared app running in the incognito window.

---

## Optional stronger open (only if your MCP client is wired up)
Replace shot [0:12–0:35] with: ask Claude in your editor to "build and deploy a
<simple tool>", show it call `deploy_new_app`, and cut to the running URL. More
on-thesis, but only do this live if you've tested it end-to-end first — a stall
on camera costs more than the flash is worth. Otherwise deploy the sample.

## Recording on Windows (no install)
- Press **Win + Alt + R** (Xbox Game Bar) to start/stop recording the active window.
  Or **Win + G** for the overlay. Output lands in `Videos/Captures` as MP4.
- Record at 1080p. ~90 seconds of screen capture is ~15–40 MB — nowhere near 100 MB.
- If a raw file is too big: it's fine to trim in the Photos app, or the online tool
  of your choice. Keep it one continuous take if you can — cuts read as "hiding something."

## Delivery tips
- **One take, real product.** The credibility *is* the demo. Small stumbles are fine;
  a fake/polished mockup is worse than a real rough one.
- **No music, no intro card.** Start on the dashboard, talk immediately.
- Speak to *what the viewer sees*, in plain words — never "the gateway mints a
  signed token," always "they just open it, no account."
- The artifact explainer page can be the thumbnail/backdrop or a follow-up link,
  but the attached file should be the **live screen recording**.
