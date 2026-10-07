export type Reward = { id: string; name: string; cost: number; stall_name: string | null; left_this_week: number | null; affordable: boolean };
export type Active = { id: string; code: string; reward_name: string; cost: number; expires_at: number; server_now: number };
export type RewardsData = {
  balance: number; earned: number; spent: number; rewards: Reward[]; active: Active | null;
  history: { reward_name: string; cost: number; redeemed_at: number; stall_name: string | null }[];
};

/** The screen after a successful redeem, from the response alone: the code shows even if the follow-up reload fails. */
export function withIssued(d: RewardsData, a: Active, rewardId: string): RewardsData {
  const balance = Math.max(0, d.balance - a.cost);
  return {
    ...d,
    active: a,
    balance,
    spent: d.spent + a.cost,
    rewards: d.rewards.map((r) => ({
      ...r,
      left_this_week: r.id === rewardId && r.left_this_week != null ? Math.max(0, r.left_this_week - 1) : r.left_this_week,
      affordable: balance >= r.cost,
    })),
  };
}
