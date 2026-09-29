// Fields master control's screens need that the contracts don't have yet, as optional
// extensions of the contract schemas. Each names its request in docs/contract-requests.md.
// The mocks fill them in; against the real API they're absent until the request lands, and the
// screens hide what depends on them. When a request lands in @opencast/contracts, delete its
// extension here. Each area keeps its own in api/ext/<area>.ts; what's left after 2026-09-29 is
// the market's `speech` (C5) and the Rights page's T1 and T4. The contracts' own shapes, named for
// the screens, are in api/types.ts.

export {};
