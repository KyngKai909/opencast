# Contracts changelog

Changes to `packages/contracts` once the apps prompt has started using it. Add a version or a new field; never change the shape of a published one.

## 2026-09-28: Clear as a Privy global wallet, and ads from partners (new fields and endpoints)

All additive; nothing existing changed shape.

- `Me.clear` (optional, nullable): the Clear account linked through Privy's cross-app linking, `{ address, access: "read_only" | "full", linkedAt }`. `accounts.linkClear` (`POST /me/clear`) records it after the app links it with Privy; `accounts.unlinkClear` (`DELETE /me/clear`) forgets it.
- `ledger.quoteClearTransfer` (`POST /businesses/:businessId/deposits/clear-transfer/quote`) and `ledger.confirmClearTransfer` (`POST /businesses/:businessId/deposits/clear-transfer`): funding a business from a linked Clear wallet with full access. The person confirms the transfer on Clear's page; the API checks it on chain before crediting.
- `ledger.getPayoutAccount` gains `destination` (optional); `ledger.setPayoutDestination` (`PUT /stations/:stationId/payout-account`) pays a station out to the owner's linked Clear wallet.
- `StationEarnings.lines.partnerAds` (optional): `{ on, micros, pendingMicros }`, "Ads from partners, paid when received".
- `BreakRule.adsFromPartners` (optional boolean, off by default): the station's switch. Only a flag until partner ads are built.
- `StationSetup.iabCategories` and `Program.iabCategories` (optional): IAB Content Taxonomy 3.0 ids. `Program.rating` (optional, `ContentRating`: TV-Y to TV-MA) and `Program.childDirected` (optional boolean), also accepted by `createProgram` and `updateProgram`.
- `updateSetup` and `updateProgram` accept `iabCategories` (optional; 1 to 10 IAB ids, or null to go back to the ones derived from the category), so the overrides can be set. Derived: the program's category, else its station's, else Entertainment (`JLBCU7`); the mapping is `packages/domain/src/ads.ts`.
- `createProgram` with a children's rating (TV-Y, TV-Y7) and no `childDirected` makes it child-directed; so does `updateProgram` setting one.

How the backend answers (no shape changes):

- `addFundingSource` with `{ kind: "clear_account", token: "linked" }` adds the caller's linked Clear wallet (owner only), labelled "Clear wallet 0x1234…abcd". Withdrawals can go to it; `addMoney` from it answers 409 `clear_transfer_needed` (money from a Clear wallet comes in by the transfer flow). It drops out of `fundingSources` once the wallet is unlinked.
- Errors, all `{ error: { code, message } }`: 409 `clear_not_linked` ("Clear isn't linked yet." from `linkClear`; "Clear isn't linked yet. Connect Clear first." elsewhere), 409 `clear_not_configured` (the server has no Clear provider app ID or Privy secret), 502 `privy_unavailable`, 409 `clear_read_only` (quote with a read-only link), 409 `clear_unavailable` (no Clear on this server, or no USDC configured), 409 `transfer_already_used` (the transaction was recorded for another business or amount), 422 `transfer_not_valid` (it didn't send at least the amount from the linked wallet to the business's account), 409 `clear_unlinked` (a withdrawal or payout to a wallet that's no longer linked), 422 `not_cancellable` (cancelling a transfer from Clear).
- `confirmClearTransfer` is idempotent on the transaction hash: the same hash again returns the same `depositId`. `status` is `pending` until the chain confirms it (the jobs tick checks again each minute).
- `getPayoutAccount.destination`: `{ kind: "clear_account", label: "The station's Clear account" }`, `{ kind: "stripe_connect", label: "Stripe" }`, or `{ kind: "clear_wallet", label: "Clear wallet 0x1234…abcd", address }`. A Clear wallet that's unlinked, or whose person no longer owns the station, shows `status: "needs_onboarding"` and payouts wait. `StationEarnings.nextPayout.destination` uses the same label.

## 2026-09-28: claims on-chain

`POST /v1/admin/handovers/:handoverId/approve` now records the desk's check of the claimant. When the escrow contract is live it also returns `onChain`: `{ contract, escrowStationId, payee, kind, calldata }`, which is what each verifier signs from their own wallet. The chain starts the 72 hours, and the claim's state follows the chain. `payableAfter` is the earliest it could be paid.

## 2026-09-28: the station's payout account

- `GET /v1/stations/:stationId/payout-account` (owner only): `{ status: "active" | "needs_onboarding", url }`. Where the station is paid (its Clear account, or Stripe Connect Express in the Stripe-only setup). When `needs_onboarding`, send the owner to `url` to finish it.
- Adding money by card may now answer `status: "pending"` while Stripe confirms; the balance updates when it arrives. Pledges return a Stripe Checkout `checkoutUrl` when real payments are on.

## 2026-09-28: storage by content ID (new fields and one endpoint)

- `LibraryItem.storage` (optional, nullable): `{ contentId, bytes, sharedWith, locked, ipfs }`. `sharedWith` counts other items pointing at the same file; `locked` means a rights claim is open against it; `ipfs` is set once it's been published (catalog or Export to IPFS).
- `POST /v1/library/:itemId/export-ipfs` (owner only). Body `{ understandPublicAndPermanent: true }`: the app shows the warning that IPFS files are public and can't be taken back, and sends this only after the owner accepts it. Answers `{ contentId, ipfsCid, url }`. Refused (422) for link imports and creator works.
- `previewUrl` (optional, nullable) on an offer's `episodes[]`, on `Spot.file`, and on `ProductionOrder.deliveries[]`: a low-bitrate HLS preview, there while the item is offered, the spot is in review, or the order is open.
- `NoticeKind` gains `file_not_ready`: a file due within the hour isn't on the playout server yet, or one was missing at air.
- `url` on spot files, order briefs and deliveries is now a storage URL (presigned or the bucket's public domain), not a server path.

## 2026-09-27: added `orders` to station setup

`StationSetup.orders` (`takesOrders`, `turnaround`, `fromMicros`) and the same, optional, on `updateSetup`. A station that takes orders appears in `listMakers`.

## 2026-09-27: added `ledger.addFundingSource`

`POST /v1/businesses/:businessId/funding-sources` links a bank (Clear), a card (Stripe) or a Clear business account. Missing from the first publish; nothing else changed.

## 2026-09-27: v1 published

Every endpoint the designs need, under `/v1`, in thirteen modules: accounts, stations, library, log, playout, catalog, spots, ledger, audience, trust, notifications, waitlist, network.

- Each `*Api` object maps names to `endpoint({ method, path, auth, params, query, body, response })`. `api` in `index.ts` holds them all; `buildPath` fills a path.
- `auth` is `public`, `optional`, `user` (a Privy access token, as `Authorization: Bearer` or the `privy-token` cookie) or `admin`.
- Errors are always `{ error: { code, message, fields? } }` (`ErrorResponse`).
- Money is integer micro-dollars (`*Micros`); durations are milliseconds (`*Ms`); times are ISO 8601 with offset.
- `states.ts` holds the states both sides of a transaction see, with each side's display strings (spot, sponsorship, production order, carriage request, rights claim, creator stage). Use it on both sides.
- Responses are validated against the contract by the API, so a field that isn't in the contract never arrives.

The accounts module is implemented; the others land module by module. Until then an endpoint answers 404, so build against mocks.
