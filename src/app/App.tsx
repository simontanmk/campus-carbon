import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { navigate, usePath } from "./router";
import { Home } from "./screens/Home";
import { Stall } from "./screens/Stall";
import { Claim } from "./screens/Claim";
import { Tap } from "./screens/Tap";
import { Admin } from "./screens/Admin";
import { MenuImport } from "./screens/MenuImport";
import { AdminStalls } from "./screens/AdminStalls";
import { AdminSettings } from "./screens/AdminSettings";
import { AdminInsights } from "./screens/AdminInsights";
import { Welcome } from "./screens/Welcome";
import { Impact } from "./screens/Impact";
import { AdminLogin } from "./screens/AdminLogin";
import { Recap } from "./screens/Recap";
import { Rewards } from "./screens/Rewards";
import { AdminRewards } from "./screens/AdminRewards";
import { Log } from "./screens/Log";
import { Missions } from "./screens/Missions";
import { Ranks } from "./screens/Ranks";
import { TabBar } from "./components/TabBar";

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => api<Me>("/me").then(setMe), []);
  useEffect(() => {
    load().catch(() => setMe({ user: null, can_switch: false }));
  }, [load]);

  // Public projector page: no session, no Welcome prompt.
  if (path === "/impact") return <Impact />;
  if (path === "/admin/login") return <AdminLogin />;
  if (!me) return null;
  // Welcome keeps the current URL (including /claim?t=...), so the claim resumes after onboarding.
  if (!me.user) return <Welcome onDone={load} />;
  const role = me.user.role;

  const student = role === "student";
  const main = path !== "/claim" && path !== "/tap" && !(student && path === "/recap") && !path.startsWith("/admin");
  return (
    <div className={student && main ? "page has-tabs" : "page"}>
      {me.can_switch && path !== "/admin" && (
        <div className="topbar">
          <span>Viewing as {me.user.display_name} · {role}</span>
          <button className="link-btn" onClick={() => navigate("/admin")}>Switch</button>
        </div>
      )}
      {path === "/claim" && <Claim />}
      {path === "/tap" && <Tap />}
      {path === "/recap" && student && <Recap />}
      {path === "/admin/menu" && role === "admin" && <MenuImport />}
      {path === "/admin/stalls" && role === "admin" && <AdminStalls />}
      {path === "/admin/settings" && role === "admin" && <AdminSettings />}
      {path === "/admin/insights" && role === "admin" && <AdminInsights />}
      {path === "/admin/rewards" && role === "admin" && <AdminRewards />}
      {path === "/admin" && me.can_switch && <Admin isAdmin={role === "admin"} />}
      {((path.startsWith("/admin/") && role !== "admin") || (path === "/admin" && !me.can_switch)) && (
        <div className="result">
          <h1 className="title">Admins only</h1>
          <p className="body">{me.can_switch ? "Switch back to the admin account to open this." : "This page is for the pilot team."}</p>
          <div style={{ width: "100%", marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => navigate(me.can_switch ? "/admin" : "/")}>{me.can_switch ? "Switch persona" : "Go home"}</button>
          </div>
        </div>
      )}
      {main && role === "seller" && <Stall />}
      {main && student && path === "/log" && <Log />}
      {main && student && path === "/missions" && <Missions />}
      {main && student && path === "/ranks" && <Ranks />}
      {main && student && path === "/rewards" && <Rewards />}
      {main && student && !["/log", "/missions", "/ranks", "/rewards"].includes(path) && <Home user={me.user} />}
      {main && role === "admin" && <Admin isAdmin={role === "admin"} />}
      {student && main && <TabBar path={path} />}
    </div>
  );
}
