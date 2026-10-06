import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { navigate } from "../router";

export function Admin({ isAdmin }: { isAdmin: boolean }) {
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

  async function stopSwitching() {
    try {
      await api("/session/stop-switching", {});
      location.href = "/";
    } catch {
      setError("Couldn't stop switching. Try again.");
    }
  }

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>{isAdmin ? "Admin" : "Switch persona"}</h1>
      </div>
      {isAdmin && (
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => navigate("/admin/stalls")}>Stalls and items</button>
          <button className="btn btn-secondary" onClick={() => navigate("/admin/menu")}>Import a menu from a photo</button>
          <button className="btn btn-secondary" onClick={() => navigate("/admin/settings")}>Points and limits</button>
          <a className="btn btn-secondary" style={{ textAlign: "center", textDecoration: "none" }} href="/api/admin/export.csv" download>Export activities (CSV)</a>
        </div>
      )}
      {!isAdmin && (
        <>
          <button className="btn btn-secondary" onClick={stopSwitching}>Stop switching on this device</button>
          <p className="muted" style={{ marginTop: -12 }}>Keeps you as the current persona. Do this before handing the phone to someone else.</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="section-head">Switch persona</div>
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
