import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { navigate, usePath } from "./router";
import { Home } from "./screens/Home";
import { Stall } from "./screens/Stall";
import { Claim } from "./screens/Claim";
import { Admin } from "./screens/Admin";
import { Welcome } from "./screens/Welcome";

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => api<Me>("/me").then(setMe), []);
  useEffect(() => {
    load().catch(() => setMe({ user: null, can_switch: false }));
  }, [load]);

  if (!me) return null;
  // Welcome keeps the current URL (including /claim?t=...), so the claim resumes after onboarding.
  if (!me.user) return <Welcome onDone={load} />;
  const role = me.user.role;

  return (
    <div className="page">
      {me.can_switch && path !== "/admin" && (
        <div className="topbar">
          <span className="muted">{me.user.display_name} · {role}</span>
          <button className="pill" onClick={() => navigate("/admin")}>Switch</button>
        </div>
      )}
      {path === "/claim" && <Claim />}
      {path === "/admin" && me.can_switch && <Admin />}
      {path !== "/claim" && path !== "/admin" && role === "seller" && <Stall />}
      {path !== "/claim" && path !== "/admin" && role === "student" && <Home user={me.user} />}
      {path !== "/claim" && path !== "/admin" && role === "admin" && <Admin />}
    </div>
  );
}
