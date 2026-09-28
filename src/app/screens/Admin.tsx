import { useEffect, useState } from "react";
import { api, type User } from "../api";

export function Admin() {
  const [users, setUsers] = useState<User[] | null>(null);
  useEffect(() => {
    api<{ users: User[] }>("/admin/users").then((d) => setUsers(d.users)).catch(() => setUsers([]));
  }, []);

  async function become(id: string) {
    await api("/admin/impersonate", { user_id: id });
    location.href = "/"; // full reload so every screen re-reads /api/me
  }

  return (
    <>
      <h1>Switch persona</h1>
      <div className="card list">
        {users?.map((u) => (
          <button key={u.id} className="row" style={{ background: "none", border: 0, font: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => become(u.id)}>
            <span>{u.display_name}</span>
            <span className="pill">{u.role}</span>
          </button>
        ))}
      </div>
    </>
  );
}
