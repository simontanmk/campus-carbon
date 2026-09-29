import { useEffect, useState } from "react";
import { api, type User } from "../api";

export function Admin() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ users: User[] }>("/admin/users").then((d) => setUsers(d.users)).catch(() => setUsers([]));
  }, []);

  async function become(id: string) {
    try {
      await api("/admin/impersonate", { user_id: id });
      location.href = "/"; // full reload so every screen re-reads /api/me
    } catch {
      setError("Couldn't switch. Try again.");
    }
  }

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Switch persona</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="list">
        {users?.map((u) => (
          <button key={u.id} className="row" style={{ background: "none", border: 0, borderBottom: "0.5px solid var(--line)", textAlign: "left", cursor: "pointer" }} onClick={() => become(u.id)}>
            <span className="what">{u.display_name}</span>
            <span className="muted">{u.role}</span>
          </button>
        ))}
      </div>
    </>
  );
}
