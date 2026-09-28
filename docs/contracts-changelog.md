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
