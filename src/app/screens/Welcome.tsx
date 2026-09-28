import { useState } from "react";
import { api, ApiError } from "../api";

export function Welcome({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/session", { display_name: name });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form className="page" onSubmit={submit}>
      <h1>Campus Carbon</h1>
      <p className="muted">Earn points for low-carbon meals and bringing your own cup. What should we call you?</p>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" maxLength={30} autoFocus />
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy || name.trim() === ""}>Continue</button>
    </form>
  );
}
