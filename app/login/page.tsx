import AuthForm from "@/components/AuthForm";
import { googleConfigured } from "@/lib/oauth";

export default function LoginPage() {
  return <AuthForm mode="login" googleEnabled={googleConfigured()} />;
}
