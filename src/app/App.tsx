import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { navigate, usePath } from "./router";
import { Home } from "./screens/Home";
import { Stall } from "./screens/Stall";
import { Claim } from "./screens/Claim";
import { Tap } from "./screens/Tap";
import { Admin } from "./screens/Admin";
import { MenuImport } from "./screens/MenuImport";
import { Welcome } from "./screens/Welcome";
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

  if (!me) return null;
  // Welcome keeps the current URL (including /claim?t=...), so the claim resumes after onboarding.
  if (!me.user) return <Welcome onDone={load} />;
  const role = me.user.role;

  const student = role === "student";
  const main = path !== "/claim" && path !== "/tap" && !path.startsWith("/admin");
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
      {path === "/admin/menu" && role === "admin" && <MenuImport />}
      {path === "/admin" && me.can_switch && <Admin />}
      {main && role === "seller" && <Stall />}
      {main && student && path === "/log" && <Log />}
      {main && student && path === "/missions" && <Missions />}
      {main && student && path === "/ranks" && <Ranks />}
      {main && student && !["/log", "/missions", "/ranks"].includes(path) && <Home user={me.user} />}
      {main && role === "admin" && <Admin />}
      {student && main && <TabBar path={path} />}
    </div>
  );
}
