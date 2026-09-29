export type MenuItem = { id: string; name: string; stall_id: string; kind: string; kg_co2e: number | null; low_carbon: number };
export type Swap = { from: string; to: string; saves_kg: number };

/**
 * Most frequent higher-carbon meal in the student's history, swapped for the
 * lightest low-carbon meal at the same stall (falling back to any stall).
 * Frequency ties go to the larger saving. Items with unknown kg are skipped.
 */
export function bestSwap(historyItemIds: string[], menu: MenuItem[]): Swap | null {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const lows = menu.filter((m) => m.kind === "meal" && m.low_carbon === 1 && m.kg_co2e != null);
  if (lows.length === 0) return null;
  const lightest = (items: MenuItem[]) => items.reduce((a, b) => (b.kg_co2e! < a.kg_co2e! ? b : a));

  const counts = new Map<string, number>();
  for (const id of historyItemIds) {
    const m = byId.get(id);
    if (!m || m.kind !== "meal" || m.low_carbon === 1 || m.kg_co2e == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  let best: (Swap & { n: number }) | null = null;
  for (const [id, n] of counts) {
    const from = byId.get(id)!;
    const sameStall = lows.filter((l) => l.stall_id === from.stall_id);
    const to = lightest(sameStall.length ? sameStall : lows);
    const saves = Math.round((from.kg_co2e! - to.kg_co2e!) * 100) / 100;
    if (saves <= 0) continue;
    if (!best || n > best.n || (n === best.n && saves > best.saves_kg)) best = { from: from.name, to: to.name, saves_kg: saves, n };
  }
  return best && { from: best.from, to: best.to, saves_kg: best.saves_kg };
}

