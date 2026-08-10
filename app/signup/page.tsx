import AuthForm from "@/components/AuthForm";
import { googleConfigured } from "@/lib/oauth";

export default function SignupPage() {
  return <AuthForm mode="signup" googleEnabled={googleConfigured()} />;
}
