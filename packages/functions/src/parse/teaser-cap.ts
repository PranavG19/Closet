// The hard per-user cap on teaser (unentitled) parse jobs — the server guarantee
// against paid-provider cost abuse (docs/06 §4). A single named constant so the
// handler and its integration/mutation oracle read the SAME value, and so the
// Tier-0 mutation battery has one target to widen (10 -> 1000). No other logic.
export const TEASER_JOB_CAP = 10;
