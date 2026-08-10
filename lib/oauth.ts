// Google OAuth 2.0 (authorization-code flow). Configured via env; when unset,
// googleConfigured() is false and the UI hides the button. The pure helpers
// (googleAuthUrl, decodeIdToken) are unit-tested; exchangeGoogleCode does the
// server-to-server token request.
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, platformOrigin } from "./config";

export function googleConfigured(): boolean {
  return !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET;
}

export function googleRedirectUri(): string {
  return `${platformOrigin()}/api/auth/google/callback`;
}

// Build the consent-screen URL. Pure (takes its inputs) so it's testable.
export function googleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleProfile {
  email: string;
  name: string;
  emailVerified: boolean;
}

// Decode the profile from an ID token's payload. The token comes straight from
// Google's token endpoint over TLS, so we read (not cryptographically verify) it.
export function decodeIdToken(idToken: string): GoogleProfile | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!payload.email) return null;
    return {
      email: String(payload.email),
      name: String(payload.name || payload.email.split("@")[0]),
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
    };
  } catch {
    return null;
  }
}

// Exchange an authorization code for the signed-in user's profile.
export async function exchangeGoogleCode(code: string): Promise<GoogleProfile | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.id_token ? decodeIdToken(data.id_token) : null;
  } catch {
    return null;
  }
}
