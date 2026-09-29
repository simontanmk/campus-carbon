import { navigate } from "../router";

const TABS = [
  { path: "/", label: "Today" },
  { path: "/log", label: "Log" },
];

export function TabBar({ path }: { path: string }) {
  return (
    <nav className="tabbar glass" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.path} aria-current={path === t.path ? "page" : undefined} onClick={() => navigate(t.path)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
