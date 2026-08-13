import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="work-surface auth-surface">
      <header className="app-header">
        <div>
          <p className="brand">ChicagoHealthMap</p>
          <p className="brand-sub">CBO verification</p>
        </div>
      </header>
      <section className="page-intro">
        <h1>Create account</h1>
        <p>Invite-only ChicagoHealthMap reviewer access. After sign-up, an operator must grant your workspace role.</p>
      </section>
      <div className="clerk-embed">
        <SignUp />
      </div>
    </main>
  );
}
