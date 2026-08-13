import { SignInButton } from "@clerk/nextjs";

export default function LoginPage() {
  return <main><h1>ChicagoHealthMap reviewer sign-in</h1><p>Use your Clerk account to access the review workspace.</p><SignInButton mode="modal"><button>Sign in</button></SignInButton></main>;
}
