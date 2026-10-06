import { useState } from "react";
import { api, ApiError } from "../api";

export function Welcome({ onDone }: { onDone: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/session", { display_name: name });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form className="page" onSubmit={submit} style={{ paddingTop: "18vh" }}>
      <div className="eyebrow">Campus Carbon</div>
      <h1 className="display">Eat a little lighter. Earn points for it.</h1>
      <p className="body">Scan the stall's code after a low-carbon meal or when you bring your own cup. What should we call you?</p>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={30} autoFocus />
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy || name.trim() === ""}>Continue</button>
    </form>
  );
}
