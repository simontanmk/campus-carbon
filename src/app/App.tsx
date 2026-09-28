import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { navigate, usePath } from "./router";
import { Home } from "./screens/Home";
import { Stall } from "./screens/Stall";
import { Welcome } from "./screens/Welcome";

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => api<Me>("/me").then(setMe), []);
  useEffect(() => {
    load().catch(() => setMe({ user: null, can_switch: false }));
  }, [load]);

  if (!me) return null;
  if (!me.user) return <Welcome onDone={load} />;

  return (
    <div className="page">
      {me.can_switch && (
        <div className="topbar">
          <span className="muted">{me.user.display_name} · {me.user.role}</span>
          <button className="pill" onClick={() => navigate("/admin")}>Switch</button>
        </div>
      )}
      {me.user.role === "seller" && (path === "/" || path === "/stall") && <Stall />}
      {me.user.role === "student" && path === "/" && <Home user={me.user} />}
    </div>
  );
}
