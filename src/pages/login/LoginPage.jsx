export default function LoginPage({ error, busy, onSubmit }) {
  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand">
        <div className="brand-mark">M</div>
        <div><strong>MAK Pharma USA</strong><span>Inventory Management</span></div>
      </div>
      <div className="eyebrow">SECURE WORKSPACE</div>
      <h1 id="login-title">Sign in to your account</h1>
      <p className="login-subtitle">Enter your account details to open the inventory dashboard.</p>
      {error && <div className="login-error" role="alert">{error}</div>}
      <form onSubmit={onSubmit}>
        <label htmlFor="login-username">Username</label>
        <input id="login-username" name="username" type="text" autoComplete="username"
          required maxLength={100} autoFocus />
        <label htmlFor="login-password">Password</label>
        <input id="login-password" name="password" type="password" autoComplete="current-password"
          required maxLength={256} />
        <button className="button primary login-button" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="login-footer">MAK Pharma USA · Inventory Management</div>
    </section>
  </main>;
}
