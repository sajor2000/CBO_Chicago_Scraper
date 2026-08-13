import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="work-surface auth-surface">
      <header className="app-header">
        <div>
          <p className="brand">ChicagoHealthMap</p>
          <p className="brand-sub">CBO verification</p>
        </div>
      </header>
      <section className="page-intro">
        <h1>Sign in</h1>
        <p>Use your ChicagoHealthMap Clerk account to open the reviewer queue.</p>
      </section>
      <div className="clerk-embed">
        <SignIn />
      </div>
    </main>
  );
}
