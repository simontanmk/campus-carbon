import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { RecapData } from "../copy";
import { drawRecap } from "../recapImage";
import { navigate } from "../router";

type Week = "last" | "this";

export function Recap() {
  const [week, setWeek] = useState<Week | null>(null);
  const [data, setData] = useState<RecapData | null>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (w: Week) => api<RecapData>(`/me/recap?week=${w}`);

  // Open on last week; a student with nothing last week (first week) opens on this week.
  useEffect(() => {
    (async () => {
      const last = await load("last");
      if (!last.empty) return [last, "last"] as const;
      const cur = await load("this");
      return cur.empty ? ([last, "last"] as const) : ([cur, "this"] as const);
    })()
      .then(([d, w]) => {
        setData(d);
        setWeek(w);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your week."));
  }, []);

  useEffect(() => {
    setPng(null);
    if (!data || data.empty) return;
    let url = "";
    let gone = false;
    drawRecap(data, location.origin)
      .then((blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        setPng({ blob, url });
      })
      .catch(() => setError("Couldn't draw the card."));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  async function pick(w: Week) {
    if (w === week) return;
    setWeek(w);
    setError(null);
    try {
      setData(await load(w));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your week.");
    }
  }

  const file = png ? new File([png.blob], "campus-carbon-week.png", { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "My week on Campus Carbon" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Couldn't share. Use Download instead.");
    }
  }

  return (
    <>
      <div>
        <button className="link-btn" onClick={() => navigate("/")}>‹ Today</button>
        <h1 className="display" style={{ marginTop: 8 }}>Your week in review</h1>
      </div>
      <div className="segmented" role="group" aria-label="Which week">
        <button aria-pressed={week === "last"} onClick={() => pick("last")}>Last week</button>
        <button aria-pressed={week === "this"} onClick={() => pick("this")}>This week so far</button>
      </div>
      {error && <p className="error">{error}</p>}
      {data?.empty ? (
        <p className="body" style={{ textAlign: "center", padding: "48px 0" }}>Nothing logged that week.</p>
      ) : png ? (
        <>
          <img src={png.url} alt="Your week as a shareable card" style={{ width: "100%", borderRadius: 18, border: "0.5px solid var(--panel-strong)" }} />
          {canShare && <button className="btn" onClick={share}>Share</button>}
          <a className={canShare ? "btn btn-secondary" : "btn"} style={{ textAlign: "center", textDecoration: "none" }} href={png.url} download="campus-carbon-week.png">Download</a>
        </>
      ) : (
        !error && <p className="muted" style={{ textAlign: "center" }}>Drawing your card…</p>
      )}
    </>
  );
}
