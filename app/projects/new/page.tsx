import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listSamples } from "@/lib/projects";
import NewProjectForm from "@/components/NewProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/projects/new");
  return <NewProjectForm samples={listSamples()} />;
}
