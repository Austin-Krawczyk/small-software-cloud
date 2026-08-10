import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import TokensPanel from "@/components/TokensPanel";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");
  return (
    <div className="card auth-card">
      <h2>{user.name}</h2>
      <p className="muted">{user.email}</p>
      <TokensPanel />
    </div>
  );
}
