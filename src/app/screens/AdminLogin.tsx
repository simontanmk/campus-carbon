import { useState } from "react";
import { api, ApiError } from "../api";

/** Demo-day bootstrap: sign this device in as the admin with the ADMIN_PASSCODE secret. */
export function AdminLogin() {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/login", { passcode });
      location.href = "/admin"; // full reload so every screen re-reads /api/me
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "Admin sign-in isn't set up on this server." : err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form className="page" onSubmit={submit} style={{ paddingTop: "18vh" }}>
      <div className="eyebrow">Campus Carbon · Admin</div>
      <h1 className="display">Sign this device in as admin.</h1>
      <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Passcode" autoComplete="current-password" aria-label="Admin passcode" autoFocus />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy || passcode === ""}>Sign in</button>
    </form>
  );
}
