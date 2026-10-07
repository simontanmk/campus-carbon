// @vitest-environment happy-dom
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { QrSheet } from "../src/app/screens/Stall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("a claimed sheet reports the claim once and closes itself, even when the parent re-renders with new callbacks", async () => {
  vi.useFakeTimers();
  const now = Date.now();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: "claimed", claimed_by: "Bea", pending_name: null, server_now: now, expires_at: now + 90_000 }), { status: 200 })));
  let claims = 0;
  let closes = 0;
  let renders = 0;
  function Parent() {
    const [, setN] = useState(0);
    renders++;
    // Inline callbacks: a new function every render, like the stall screen passes.
    return h(QrSheet, {
      active: { id: "t1", claim_url: "", expires_at: now + 90_000, method: "qr", server_now: now, item: { id: "i", name: "Veg noodles", kind: "meal", kg_co2e: 0.4, low_carbon: true }, qr: "data:,", local_expires_at: now + 90_000 },
      byo: false,
      onClose: () => closes++,
      onClaimed: () => {
        claims++;
        setN((x) => x + 1);
      },
      onRegenerate: () => {},
    });
  }
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => root.render(h(Parent)));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100); // first poll returns "claimed"
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100); // the sheet's auto-close
  });
  expect(claims).toBe(1);
  expect(closes).toBe(1);
  expect(renders).toBeLessThan(10);
  await act(async () => root.unmount());
}, 10_000);
