import { describe, expect, it } from "vitest";
import { withIssued, type RewardsData } from "../src/app/rewardsState";

const data: RewardsData = {
  balance: 160, earned: 160, spent: 0, active: null, history: [],
  rewards: [{ id: "free-kopi", name: "Free kopi", cost: 150, stall_name: "Drinks", left_this_week: 3, affordable: true }],
};
const issued = { id: "r1", code: "ABCDEF", reward_name: "Free kopi", cost: 150, expires_at: 1_600_000, server_now: 1_000_000 };

describe("withIssued", () => {
  it("shows the new code straight from the redeem response, without waiting for a reload", () => {
    const d = withIssued(data, issued, "free-kopi");
    expect(d.active).toEqual(issued);
    expect(d).toMatchObject({ balance: 10, spent: 150 });
    expect(d.rewards[0]).toMatchObject({ left_this_week: 2, affordable: false });
  });
  it("leaves unstocked rewards' stock alone", () => {
    const d = withIssued({ ...data, rewards: [{ ...data.rewards[0], left_this_week: null }] }, issued, "free-kopi");
    expect(d.rewards[0].left_this_week).toBeNull();
  });
});
