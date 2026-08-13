import { SignInButton, SignUpButton } from "@clerk/nextjs";

export default function LoginPage() {
  return <main className="work-surface">
    <header className="app-header">
      <div>
        <p className="brand">ChicagoHealthMap</p>
        <p className="brand-sub">CBO verification</p>
      </div>
    </header>
    <section className="page-intro">
      <h1>Reviewer sign-in</h1>
      <p>Use your Clerk account to access the review workspace.</p>
    </section>
    <div className="actions">
      <SignInButton mode="modal"><button type="button" className="primary-button">Sign in</button></SignInButton>
      <SignUpButton mode="modal"><button type="button">Create account</button></SignUpButton>
      <a href="/sign-in">Open full sign-in page</a>
    </div>
  </main>;
}
