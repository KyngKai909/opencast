# Clear integration

The `clear` payments adapter ([apps/api/src/v1/payments/clear.ts](../apps/api/src/v1/payments/clear.ts)) is written against `ClearClient`: the calls Opencast needs from Clear, in Opencast's words. It is **not** Clear's API. Until a real client is written against Clear's endpoints, `PAYMENTS_PROVIDER=clear` runs against `fakeClear()`, which is in memory and moves nothing.

This page lists each call, what Opencast does with it, and what Clear's stack is known to have for it. The knowledge column comes from the Clear app's own integration notes (Protocol-Contracts), not from a Clear API spec.

## How the adapter uses Clear

- **Accounts.** Every advertiser and every station gets a Clear business account holding USDC. It lives in Clear's own systems and Clear's own Privy app, not Opencast's: Opencast has its own Privy app (`PRIVY_APP_ID`), never shares a wallet with Clear, and reaches a Clear account only through Clear's API and, for a person's own Clear wallet, the global wallet they link (below). Whether Opencast can open a Clear business account on someone's behalf is open (docs/open-decisions.md); until it's decided, they open it in Clear first. Opencast has two Clear accounts of its own: a **settlement** wallet (claimable stations' earnings until the weekly escrow deposit) and a **treasury** (Opencast's share, the pool, absorbed gaps, card money).
- **Holds.** A hold is an **encumbrance** on the advertiser's balance: the money stays in their account but can't be spent or withdrawn. Settling an airing releases the encumbrance and **transfers** the cost to the station's account (and Opencast's share and the pool to the treasury).
- **The outbox.** The ledger never calls Clear inside a database transaction. Each entry writes its moves (`ledger.provider_moves`); a job sends them in order, each with its own idempotency key, and retries failures. `deriveMoves` in [moves.ts](../apps/api/src/v1/modules/ledger/moves.ts) is the whole mapping.
- **Cards.** Stripe is the card on-ramp. The card charge lands in Opencast's Stripe balance, and the advertiser's Clear balance is credited **from the treasury**; Stripe payouts refill the treasury. Pledges work the same way into the station's account.

## The calls

| `ClearClient` call | Used for | Known in Clear's stack | Open question |
|---|---|---|---|
| `openAccount(owner, legalName)` → account ID, `active` or `needs_verification` + hosted link | First money for a business or station; a station's payout set-up. Under the safe default (they open it in Clear first) this finds the account instead of opening one | Clear business accounts in Clear's own Privy app; Bridge hosted KYC/KYB links | A **business** (KYB) account for a station or advertiser: which provider verifies businesses? Can Opencast open one on someone's behalf, or must they open it in Clear first (open decision)? |
| `linkBank(accountId, plaidPublicToken)` | "Link a bank" on the funding screen | Plaid Link exists, but **only to link and verify**. Bridge links through its own `plaid_link_requests` flow, not a processor token | Which of Clear's providers holds the linked bank |
| `pullFromBank(accountId, bankRef, amount)` → transfer ID | "Add money by bank transfer" (1 to 2 business days, with Undo) | **Bridge can't pull from banks.** Its inbound fiat is push-only (virtual account deposit instructions). Clear's decided fiat rail with pull is **Lithic** (ACH push and pull) | Does Clear expose a Lithic ACH debit into a business account? If not, the funding screen shows the account's **deposit instructions** (a Bridge virtual account) and deposits arrive by webhook, with no Undo |
| `cancelPull(transferId)` | Undo on a pending bank deposit | Depends on the rail | Can an ACH debit be cancelled before it settles? |
| `encumber(accountId, amount, reference)` | Every hold (airings, sponsorship months, production orders) | Nothing known. The prompt calls it "an encumbrance on that balance" | **The biggest gap.** Needs an on-ledger or on-chain lock that stops spending and withdrawal, released in part. Without it, holds live only in Opencast's ledger and the money stays spendable at Clear |
| `releaseEncumbrance(accountId, reference, amount)` | Settling, cancelling, and the unaired share returning | as above | Partial release by reference |
| `transfer(from, to, amount)` | Settlements, barter splits, carriage fees, card top-ups from the treasury | USDC transfers between Clear accounts on Base | Gas: sponsored? Batched? Clear's paymaster set-up (ZeroDev/Privy) is the likely path |
| `payout(accountId, bankRef, amount)` | Station payouts (weekly), advertiser withdrawals | Bridge off-ramp: `external_accounts` + a transfer; ACH (1 to 2 days) or same-day ACH (Bridge charges a developer fee). Lithic can push too | Which rail, and who pays the same-day fee |
| `parseWebhook(body, headers)` | Deposit arrived or failed, payout confirmed or returned, account verified | Bridge webhooks: RSA-signed (`X-Webhook-Signature`, `t=…,v0=…`), `event_category` + `event_type`, transfer `state` | Whether Clear forwards its providers' webhooks or sends its own |

Every write takes an idempotency key and must be safe to repeat with it. Bridge already requires `Idempotency-Key` on transfers and answers `409 resource_state_conflict` for a busy funding source, which should be retried with the same key.

## What Opencast needs that Clear may not have yet

1. **Encumbrances.** Without them, "a held airing always airs" is enforced only by Opencast's ledger.
2. **A bank pull** for the "Add money by bank" flow, or a decision to show deposit instructions instead.
3. **Business (KYB) accounts** for advertisers and stations, including claimable stations after handover.
4. **Opencast's own settlement wallet** able to call the escrow contract's `depositBatch`. It needs an allowance to the escrow and gas on Base. Today the chain job uses its own key (`SETTLEMENT_PRIVATE_KEY`).

## Configuration

| Variable | |
|---|---|
| `PAYMENTS_PROVIDER` | `fake` (default), `clear`, or `stripe_only` |
| `STRIPE_SECRET_KEY` | Card top-ups and pledges. A live key outside production is refused |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /v1/webhooks/stripe` |
| `CLEAR_…` | To come with the real client |

Webhooks: `POST /v1/webhooks/stripe` and `POST /v1/webhooks/clear`.
