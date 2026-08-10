import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Small Software Cloud",
  description: "Deploy and share small apps like documents.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">☁️ Small Software Cloud</Link>
          <nav>
            {user ? (
              <>
                <Link href="/projects/new" className="btn btn-primary btn-sm">+ New app</Link>
                <Link href="/account">{user.name}</Link>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link href="/signup" className="btn btn-primary btn-sm">Sign up</Link>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
