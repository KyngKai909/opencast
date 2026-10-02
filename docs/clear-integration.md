# Clear integration

The `clear` payments adapter ([apps/api/src/v1/payments/clear.ts](../apps/api/src/v1/payments/clear.ts)) is written against `ClearClient`: the calls Opencast needs from Clear, in Opencast's words. It is **not** Clear's API. Until a real client is written against Clear's endpoints, `PAYMENTS_PROVIDER=clear` runs against `fakeClear()`, which is in memory and moves nothing.

This page lists each call, what Opencast does with it, and what Clear's stack is known to have for it. The knowledge column comes from the Clear app's own integration notes (Protocol-Contracts), not from a Clear API spec.

## Accounts: Clear's, not Opencast's

Opencast has **its own Privy app**, separate from Clear's. Its ID and secret come from configuration (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`), never hard-coded, so anyone self-hosting Opencast uses their own Privy app. Clear's app ID is never used for sign-in, and the API refuses to start if `PRIVY_APP_ID` is Clear's. The API verifies only tokens issued to Opencast's app. Embedded wallets are created only for people who sign in; a station's team reaches the station's money through their roles, never a shared wallet or login.

Every advertiser and every station gets a **Clear business account** holding USDC, with bank deposits and withdrawals through Clear's own stack. That account lives in Clear's own systems and Clear's own Privy app. Opencast reaches it only through Clear's API (`ClearClient`, below) and through the global wallet a person links (next section). Whether Opencast can open a Clear business account on someone's behalf during sign-up, or they must open it in Clear first, is open (docs/open-decisions.md); the safe default is that they open it in Clear first.

Opencast has two Clear accounts of its own: a **settlement** wallet (claimable stations' earnings until the weekly escrow deposit) and a **treasury** (Opencast's share, the pool, absorbed gaps, card money).

## Clear as a Privy global wallet

Clear's Privy app is the **provider** and Opencast's is the **requester** (Privy's cross-app accounts, "global wallets").

1. "Connect Clear", in the business app and in station settings, calls Privy's cross-app linking: `linkCrossAppAccount({ appId })` (React: `useCrossAppAccounts`) with Clear's provider app ID from configuration (`VITE_CLEAR_PRIVY_PROVIDER_APP_ID` in the apps, `CLEAR_PRIVY_PROVIDER_APP_ID` in the API).
2. The person approves on a **page Clear hosts**. Their Clear wallet is attached to their Opencast Privy user as a linked account of type `cross_app`, carrying Clear's `provider_app_id`, the person's `subject` in Clear's app, and the Clear wallet in `embedded_wallets`.
3. The app then calls `POST /v1/me/clear`. The API reads the person's Privy user from Privy's REST API with Opencast's app secret, finds the `cross_app` account from Clear's provider app, and records its embedded wallet address, subject and access (`accounts.clear_links`). It answers **409 `clear_not_linked`** ("Clear isn't linked yet.") when Privy has none, and **409 `clear_not_configured`** when `CLEAR_PRIVY_PROVIDER_APP_ID` or `PRIVY_APP_SECRET` isn't set. `GET /v1/me` returns it as `clear` (`{ address, access, linkedAt }`, or null).
4. `DELETE /v1/me/clear` forgets it (the app also unlinks it in Privy). The row is kept with `unlinked_at`; funding sources and payout destinations that used it stop working.

**Nothing about a Clear account is visible to Opencast until the person links it.** Opencast never looks a Clear account up by email or any other identity.

**Read-only and full access.** Which one applies is Clear's setting for Opencast in Clear's Privy dashboard. The API can't detect it, so it's configuration: `CLEAR_WALLET_ACCESS` (`read_only`, the default, or `full`). Each link records the access at the time; a link counts as full only while the setting still says full.

| | Read-only | Full |
|---|---|---|
| Verify the address and show it | ✓ | ✓ |
| Pay a station out to its owner's Clear wallet (`PUT /stations/:id/payout-account` with `{ kind: "clear_wallet" }`, owner only) | ✓ | ✓ |
| A business's withdrawals to its owner's Clear wallet (`addFundingSource` with `{ kind: "clear_account", token: "linked" }`, owner only) | ✓ | ✓ |
| Fund a balance from the Clear wallet | inside Clear | quote, the person confirms on Clear's page, then confirm with the transaction hash |

**Funding from Clear (full access).** `POST /businesses/:id/deposits/clear-transfer/quote` (owner or manager, with their own link) returns where to send it: the business's balance account address (the adapter's `depositAddress`, from Clear's `accountAddress`), USDC on the configured chain (`CHAIN_ID`, `USDC_ADDRESS`), `amountUnits` (USDC has 6 decimals, so the same as micros) and `from`, the linked wallet. It answers 409 `clear_read_only` when the link is read-only, `clear_not_linked` when there's none, and `clear_unavailable` when the server has no Clear (Stripe-only) or no USDC configured. The app asks Clear to send it, the person confirms on Clear's page, and the app calls `POST /businesses/:id/deposits/clear-transfer` with the transaction hash. The adapter checks it: with `CHAIN_RPC_URL`, `CHAIN_ID` and `USDC_ADDRESS` set, it reads the receipt and the USDC `Transfer` log (from the linked wallet, to the business's account, at least the amount); without them the deposit stays `pending`, and the jobs tick checks pending ones again each minute. Once confirmed, the ledger credits it like any deposit ("Added from Clear"). Each transaction is used once: confirming it again returns the same deposit; for another business or another amount it's 409 `transfer_already_used`; a transfer that doesn't check out is 422 `transfer_not_valid`. It can't be undone from Opencast.

**A station's usage from Clear (full access; pay-as-you-go, 2026-09-29).** What a station's earnings don't cover at month end is paid from its owner's linked Clear wallet when Clear gave Opencast full access (before a card; the owners can choose the card instead). It's the same signed transfer, to Opencast's treasury account (`depositAddress` of `opencast:treasury`): `POST /stations/:id/account/clear-payment/quote` gives the address and what's due, the owner confirms the transfer on Clear's page, and `POST /stations/:id/account/clear-payment` with the transaction hash checks it on chain and pays the bill (a `usage_payment` entry from `external` `clear` to `opencast_usage`). Until the owner approves, the station is in its grace period (docs/pricing.md). A transfer not yet mined is checked again by the jobs tick.

**Payouts to a Clear wallet.** A station's owner can have it paid to their own linked Clear wallet instead of the station's Clear account (read-only is enough). Payouts wait (the payout account shows `needs_onboarding`) if that wallet is unlinked or its person no longer owns the station; they never go to a former owner.

**Clear must request global-wallet provider access in its own Privy dashboard** (and allow Opencast's app as a requester) before any of this works. Opencast can't do it for Clear.

## How the adapter uses Clear

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
| `accountAddress(accountId)` → address | A business's balance account on chain: where a transfer from its owner's linked Clear wallet is sent (`quoteClearTransfer`) | Each Clear account has a wallet address on Base | Is the business account's address stable, and does USDC sent straight to it on chain show in the account's balance? |
| `sendToWallet(accountId, address, amount)` → transfer ID | A station's payout, or a business's withdrawal, to the owner's linked Clear wallet | USDC transfers from a Clear account on Base | Gas, as for `transfer` |
| `parseWebhook(body, headers)` | Deposit arrived or failed, payout confirmed or returned, account verified | Bridge webhooks: RSA-signed (`X-Webhook-Signature`, `t=…,v0=…`), `event_category` + `event_type`, transfer `state` | Whether Clear forwards its providers' webhooks or sends its own |

Every write takes an idempotency key and must be safe to repeat with it. Bridge already requires `Idempotency-Key` on transfers and answers `409 resource_state_conflict` for a busy funding source, which should be retried with the same key.

## What Opencast needs that Clear may not have yet

1. **Encumbrances.** Without them, "a held airing always airs" is enforced only by Opencast's ledger.
2. **A bank pull** for the "Add money by bank" flow, or a decision to show deposit instructions instead.
3. **Business (KYB) accounts** for advertisers and stations, including claimable stations after handover.
4. **Opencast's own settlement wallet** able to call the escrow contract's `depositBatch`. It needs an allowance to the escrow and gas on Base. Today the chain job uses its own key (`SETTLEMENT_PRIVATE_KEY`).
5. **Global-wallet provider access** in Clear's own Privy dashboard, with Opencast's app allowed as a requester, and a decision on read-only or full access for Opencast.
6. **`accountAddress` and `sendToWallet`**: a business account's address on chain, and sending USDC from an account to a linked Clear wallet.
7. **Clear Pay's payment events** (added 2026-09-29, P20): a business can connect Clear Pay (`POST /v1/businesses/:businessId/connections/clear_pay`, the token Clear's own connect flow gives), but nothing counts its uses yet. Opencast needs a signed event when a customer pays with an offer's code (the code, the business's Clear Pay account, a customer reference that's stable per customer, and when), sent to an address Opencast gives, like the checkout webhooks (`/v1/webhooks/checkout/:hookToken`). Each counts as a `clear_pay` use (`spots.countUse`).

## Configuration

| Variable | |
|---|---|
| `PAYMENTS_PROVIDER` | `fake` (default), `clear`, or `stripe_only` |
| `STRIPE_SECRET_KEY` | Card top-ups and pledges. A live key outside production is refused |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /v1/webhooks/stripe` |
| `CLEAR_PRIVY_PROVIDER_APP_ID` | Clear's Privy app ID, as the global-wallet provider. Unset: "Connect Clear" answers 409 `clear_not_configured` |
| `CLEAR_WALLET_ACCESS` | `read_only` (default) or `full`: what Clear has granted Opencast in its Privy dashboard |
| `PRIVY_APP_SECRET` | Opencast's own app secret: reading a person's linked Clear account from Privy needs it |
| `CHAIN_RPC_URL`, `CHAIN_ID`, `USDC_ADDRESS` | USDC on Base (Base Sepolia on staging): the quote's token, and how transfers from Clear wallets are checked |
| `VITE_CLEAR_PRIVY_PROVIDER_APP_ID` | The apps (control, spots): Clear's provider app ID for `linkCrossAppAccount` |
| `CLEAR_…` (API) | To come with the real client |

Webhooks: `POST /v1/webhooks/stripe` and `POST /v1/webhooks/clear`.
