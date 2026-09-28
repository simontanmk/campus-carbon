import { useEffect, useState } from "react";

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
