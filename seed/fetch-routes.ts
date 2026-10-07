import { writeFileSync } from "node:fs";
import { LOCATIONS } from "./data.ts";

const SHUTTLE_WAIT_MIN = 5; // assumption: average wait for the campus loop; stated in the spec
const UA = { "user-agent": "campus-carbon-prototype (NTU CC0006)" };

async function osrm(profile: "foot" | "car", a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const base = profile === "foot" ? "routed-foot/route/v1/foot" : "routed-car/route/v1/driving";
  const url = `https://routing.openstreetmap.de/${base}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${profile} ${res.status} for ${url}`);
  const r = ((await res.json()) as { routes: { distance: number; duration: number }[] }).routes[0];
  return { km: r.distance / 1000, min: r.duration / 60 };
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const sorted = [...LOCATIONS].sort((a, b) => a.id.localeCompare(b.id));
const out = [];
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length; j++) {
    const [a, b] = [sorted[i], sorted[j]];
    const walk = await osrm("foot", a, b);
    await new Promise((r) => setTimeout(r, 1100));
    const car = await osrm("car", a, b);
    await new Promise((r) => setTimeout(r, 1100));
    out.push({
      from_id: a.id,
      to_id: b.id,
      distance_km: round(walk.km, 2),
      walk_min: round(walk.min, 1),
      car_min: round(car.min, 1),
      shuttle_min: round(car.min + SHUTTLE_WAIT_MIN, 1),
    });
    console.error(`${a.id} → ${b.id}: ${round(walk.km, 2)} km`);
  }
}
writeFileSync(new URL("./routes.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
