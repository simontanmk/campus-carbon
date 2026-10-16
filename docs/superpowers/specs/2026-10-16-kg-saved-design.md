# kg saved, every band

Date: 2026-10-16. Status: approved in chat (option A).

- **Rule:** for every verified stall meal, whatever its band, kg saved = max(0, menu average − meal kg). The menu average is today's live meals at active stalls, as before.
- **What counts:** heavier-than-average meals count 0 and never subtract, so the figure can't go negative on `/impact` or the recap card. Photo meals still don't count.
- **Where:** `kgSaved` in `src/worker/lib/insights.ts`, used by `/impact`, Admin → Insights and the recap card. It's computed on read, so past weeks follow automatically.
- **Rejected:** a net figure (heavier meals subtract) can go negative; green-only ignores the amber meals the app now rewards.
