# Catch-up report (follow-up prompt, Phase 0)

The repo on branch `follow-up` (from `dev` at e8ba662), checked against the latest prompts and reference files from handoff 6 (copied in at bd587b2). The platform prompt keeps the user's 2026-09-29 decisions: the radio band in even tenths, and station IDs and spots following each station's cadence.

| # | Item | State | Effort to close |
|---|---|---|---|
| 1 | Four apps, one session | Done, with leftovers | Small |
| 2 | Prepare once, then assemble | Partly done | Medium |
| 3 | Off air hours and day templates | Done | None |
| 4 | Storage | Partly done | Medium |
| 5 | Sign-in (Privy, Connect Clear) | Done, one risk | Small |
| 6 | Money (holds, escrow, share) | Done | None |
| 7 | Business roles | Partly done | Small to medium |
| 8 | Partner ads, prepared for later | Done | Small (reference) |
| 9 | Master control rail | Done | None |
| 10 | Network desk, Catalog | Not started | Large |
| 11 | Network desk, remaining pages | Partly done (mostly not started) | Large |
| 12 | Changed reference files | Mixed, see below | Small to large |

## Closing the gaps (after the report)

Everything in the proposed order below is closed on `follow-up`, except the parts left to their phases (the Translators redraw goes to Phase 3, changing channel to Phase 5, External sources to Phase 6) and Clear Pay code events, which wait on Clear.

| Gap | Closed in |
|---|---|
| 2, 4: prepare from originals, previews from prepared segments, delete on GC and takedown, Infrequent Access kept, Pinata and location relinks, CIDv1 checked | f46a091 |
| 5: a creator's wallet at claim | f46a091 |
| 7: invites through Resend with accept pages, resend and the email check; Online markets; strict viewers | f46a091 |
| 8: the break order in the reference | f46a091 |
| 12: "External" copy; Tuning sound stored | f46a091 |
| 1, 2: the old `/api` routes, the worker's old loop, lockfile, stale docs | 31af9fe |
| 10: the desk Catalog; 11: desk Settings (roles, the rules registry, numbering, escrow signers) | 56f67e5 |
| 11: Rights claims, Reserved call signs, Catalog sponsors | the commit after 56f67e5 |

Also built on the way, at the user's request: program log edit mode (ad64f1b), and log edits moving or cancelling viewers' reminders (18b22fc).

## 1. Four apps, one session: done

`apps/web` serves the viewer at `/`, master control at `/control` and Network desk at `/desk`, with one Privy root and one query client. Control and desk load lazily. The desk is gated on `isAdmin` in the app and on every desk endpoint. `apps/business`, `apps/tv` (with the Cast receiver and Android) and `apps/site` exist. No separate control or desk app is left.

**Leftovers (small):**
- `package-lock.json` still lists `apps/control` and `apps/desk` as extraneous. Regenerate it.
- Stale docs:
  - `docs/architecture.md` still says "apps/control stays";
  - the staging table in `docs/deploy.md` lists separate web services;
  - the cutover step still gives the worker 100 GB (it's 20 GB).

**Differs from the prompt; to be recorded in `docs/open-decisions.md`:**
- The four web apps are on Vercel, not Railway (the user's decision, handoff 4).
- `apps/tv` shares `ui`, `player` and the contracts, not the viewer area's code.
- `apps/business` has its own copy of the auth code. Nothing documents how a sign-in on the web carries over to business across two origins; that would need Privy cookies on a shared parent domain once the real domain exists.

## 2. Prepare once, then assemble: partly done

**Done:**
- The fixed ladder (TV 1080/720/480/360 plus audio-only; radio 128k/64k), with 4 s aligned segments and loudness levelled.
- Segments are stored under the item's key.
- Rolling playlists with discontinuities, program date-times, DATERANGE tags and ENDLIST.
- TV live blocks go through Livepeer. Radio live goes through the worker's own RTMP ingest, by the user's decision.
- The player draws the bug, lower thirds and codes from the DATERANGE tags, and breaks carry SCTE-35 cues.
- The hourly readiness check over 48 hours, with warnings. There's no download cache.

**Gaps:**
1. **Items are prepared from a 720p copy, not the original (medium).**
   - At upload, the library (and spots) still make a copy capped at 1280 px wide, store it as the item's content, and playout prepares from that copy.
   - So every item is encoded twice, and the 1080p rendition is upscaled from 720p.
   - Spot uploads never keep their original.
   - The fix: prepare from `originalContentId`, stop making the copy, and prepare existing items again.
2. **Prepared segments are never deleted (small).** Garbage collection and takedowns remove the original and the preview, but not `prepared/<key>/…` or its rows.
3. **Items from before content IDs are keyed by location (`loc-…`), not content ID (medium).** This is tied to item 4's Pinata links.
4. **Old code still present (medium, cleanup):**
   - the old `/api` routes in `apps/api/src/server.ts`, which no app calls;
   - the worker's old queue loop (`legacy.ts`, behind `LEGACY_PLAYOUT=on`).
5. **Stale docs (small):** `docs/architecture.md` still describes the continuous muxer and the worker cache.

## 3. Off air hours and day templates: done

Scheduled off air isn't dead air: the log, dead-air check, auto-fill, dial and guide, heartbeats and pre-flight all tell them apart. Planned off air plays the sign-off slate, ends the playlist, and restarts from the station ID.

Day templates:
- They repeat every day, on weekdays, on a given weekday, or once, by broadcast day (6:00 am to 6:00 am).
- Hand-edited dates are kept as exceptions.
- Stopping a template leaves edited dates as they are.

Master control has the off air hours setting, "Repeat this day" with all four options, and a one-off sign-off.

## 4. Storage: partly done

**Done:**
- **Content IDs are real CIDv1:** version 1, the raw codec, a sha2-256 multihash, base32 (`bafkrei…`). One small hardening: `sha256FromCid` doesn't check the prefix.
- **Originals in Infrequent Access:** library originals, claim attachments, order briefs and proof frames go to Infrequent Access (`STANDARD_IA` on R2).
- **IPFS only for the catalog and "Export to IPFS":** the export is owner-only and warns before it runs.
- **The move off Pinata:** the script (`storage:move-off-pinata`, report / copy / unpin) is built. It has only run in report mode locally (1 file, 0.1 GB).

**Gaps:**
1. **Spot originals** aren't kept (see 2.1). And storing the same bytes as Standard moves an Infrequent Access object to Standard (small).
2. **The Pinata move doesn't relink items (medium, before cutover).** It copies each pin under a new content ID but doesn't point old items (`storage='ipfs'`) at it. After unpinning, those items would stop resolving.
3. **Previews are still made as separate 360p renditions** for catalog offers, spot review and order delivery (medium). The prompt says previews play the prepared segments.
4. **Two notes to record, not fix:**
   - IPFS gives files over about 1 MiB a chunked CID that differs from the raw CID, which is why `ipfs_cid` is stored separately.
   - The catalog pins the 720p copy; this goes away with 2.1.
5. **Stale doc:** `docs/technical-implementation-guide.md` still describes Pinata as the main store.

## 5. Sign-in: done, one risk

Opencast's own Privy app is read from configuration, and the API refuses to start with Clear's app ID. "Connect Clear" works through Privy's cross-app linking:
- a read-only link can be a payout destination, but can't fund;
- a full link can fund, with a signed transfer;
- this works on both the station side and the business side, and `docs/clear-integration.md` covers it.

**Risk (small to medium):**
- Both apps set `createOnLogin: "off"`, so no embedded wallet is ever made.
- But approving a claim needs the creator's wallet (`no_wallet` otherwise), and the open decision assumes Privy makes one at sign-in.
- So a creator who signs in by email can't be paid their claim. The fix: create a wallet for creators at claim time, or at sign-in for everyone.

## 6. Money: done

**Prepaid holds:**
- A hold is made for each airing, settled from the as-run log.
- The rest is released, partly aired spots are charged pro rata, and unaired holds come back.
- Listing needs a day of budget.
- The database enforces it: the ledger is append-only, entries must balance with no negative balances, holds must be funded, and no airing exists without a hold.

**The escrow contract:**
- `CreatorEscrow` handles claims and stops: a verifier threshold plus 72 hours, release to the fund after the unclaimed period, and flush.
- It has unit, fuzz, invariant and gas tests.
- The weekly batch and the chain sync are in the ledger.
- It's upgradeable behind a 7-day timelock by the user's decision; that departs from the prompt and is recorded.

**Opencast's share** is taken from the station's side, from dated rates (default 0).

## 7. Business roles: partly done

**Done:**
- The roles are owner, manager and viewer, with no counter staff. The API and the app both check them.
- "Where your customers are" offers a location, a service area or online.
- Online businesses target markets from the spot's rate step.
- Codes can be marked as used, counted from an online checkout (Shopify, Stripe and Square, with verified webhooks), or counted from Clear Pay.

**Gaps:**
1. **Invites don't reach anyone (medium).**
   - Email only goes to the log; there's no email provider.
   - The link points at the web app's `/invites/:id`, which doesn't exist. Business invites need the business origin, and station invites have no accept page.
   - "Resend" doesn't send.
   - Accepting doesn't check the signed-in email. That's optional, and worth deciding.
2. **Settings' "Online" option** saves no markets and has a hard-coded market name (small).
3. **The viewer role** can see the balance and spot lists; the prompt says results, airings and statements only (small, if strict).
4. **Clear Pay code uses** can be connected, but nothing receives Clear Pay's events, so the count stays 0. This is blocked on Clear (medium).

## 8. Partner ads, prepared for later: done

These are in place:
- SCTE-35 break markers;
- IAB content categories and blocked ad products per station;
- program ratings and the child-directed flag;
- the "Ads from partners" switch, stored as a flag;
- the Breaks settings section, with the reference's copy word for word;
- the earnings line under "From your breaks" (always $0 for now).

**Differences:**
- The reference draws partner ads as step 3 of 5 in the break order. The code shows step 4 of 6, because a bumper now opens the break (the user's 2026-09-29 change). The reference needs updating.
- Master control has no screen for a program's rating, child-directed flag or IAB categories; they can only be set through the API.

## 9. Master control rail: done

The rail groups and items match the reference exactly: On air, Market, Programming, Money (Spot market, Sponsors, Earnings), Station (Translators, Rights, Settings). The counts match too.

## 10. Network desk, Catalog: not started (large)

The route shows a placeholder. None of the three frames exists:
- **The shelf.**
- **Series, items and per-item rights records.** There are no series or item tables; the `catalog` schema is the syndication market.
- **Adding an item with the two-person rights check.** There's no evidence checklist, and no reviewer roles either: desk access is a single admin flag.

Also missing:
- rebuilding episodes when an item fails (pull it from every episode, re-prepare only what changed);
- the public-domain rules in configuration (a cut-off year that moves each January 1, sound recordings, US only).

## 11. Network desk, remaining pages: partly done, mostly not started (large)

**Rights claims:** not started (medium).
- The API lists claims per station only. Missing:
  - the list across all stations, with its stats;
  - the Open / Closed / By station tabs;
  - each claim's timeline and carrier count;
  - a kind for privacy complaints.

**Reserved call signs:** done 2026-09-29 (migration 0029; docs/contracts-changelog.md).
- End dates from the registry's `call_signs.hold` (120 days), a reminder 14 days before and release after (with the channel); Extend and Release.
- The same name twice: allowed (the index isn't unique), and "Decide" keeps one and holds a suggestion for the other in their place in line.
- Refused names in the registry (`call_signs.refused`: K or W and three letters, brands and stations, a denylist), refused on the waitlist and at station setup, with "Suggest"; stations already on the dial are flagged, not changed.
- The State column, the row actions, "Invite the next 10", the market switcher, market leads kept to their markets.

**Catalog sponsors:** not started (medium to large).
- There's no model for selling the catalog credit by series and market, and nothing that has Clear fill the gaps.

**Settings:** partly done (large). It has only Appearance and Sign out. Missing:
- **Team roles:** admin, rights reviewer, market lead.
- **A rules registry** with effective dates and a change log. It covers prices, shares, rights dates, the repeat limit, platform limits, numbering and escrow signers.
- **Per-market numbering.**
- **Escrow signer changes** that need the others' approval.

Partial backend:
- `ledger.revenue_config` has dated shares, but nothing writes to it.
- `trust.policy` has no dates or log.
- The frame says radio numbering runs 88.1–107.9, which conflicts with the user's even-tenths decision; the code follows the decision.

## 12. Reference files that changed

| File | Change | State |
|---|---|---|
| `control/opencast-master-control.html` A3 | Off air hours, Weekdays | Done |
| `control/opencast-master-control.html` A4 | Translators redrawn: connected platforms, relay mode, one break setting, bug toggle, relay hours | Not started. The UI and contract fields are medium; the work behind them is Phase 3 |
| `control/opencast-live-listings.html` | Storage lines, Export to IPFS | Done. "Ready for tonight: Cached on the playout server" is deliberately "For air: Prepared for air / Being prepared / Couldn't be prepared" (readiness, no cache; in new copy) |
| `brand/opencast-style.html` | Changing channel, Tuning the radio band | Not started (Phase 5) |
| `viewer/opencast-you.html`, `tv/opencast-tv-update.html` | "Tuning sound" setting | Not started (small; the sound itself is Phase 5) |
| `viewer/opencast-tuning.html` | New | Not built (Phase 5) |
| `desk/opencast-network-desk.html` | External sources, reworked for external stations | "Listed sources" exists. Renaming it is small; the rework is Phase 6 |
| `viewer/opencast-home.html`, `opencast-station-pages.html`, `opencast-you.html`, `tv/opencast-tv.html` | "Listed" → "External" in tags, guide cells and station lines | Not started (small copy change; the internal names can stay) |

## Proposed order to close the gaps

Close these before Phase 1, in this order:

1. **Playout and storage correctness** (medium):
   - prepare from the original and stop the 720p copy, which also keeps spot originals and fixes the upscaled 1080p;
   - delete prepared segments on garbage collection and takedown;
   - keep Infrequent Access objects from being moved to Standard;
   - play previews from the prepared segments;
   - relink the Pinata copies and older items to content IDs.
2. **Small fixes across the apps** (small):
   - "Listed" → "External" copy everywhere, and the desk's External sources rename;
   - the "Tuning sound" setting (stored now; used in Phase 5);
   - the business settings' Online markets;
   - the viewer role, kept to results, airings and statements;
   - a wallet for creators before a claim is approved;
   - the reference's break order.
3. **Invites that reach people** (medium): an email provider (**Open**: which one; Resend or Postmark suggested), accept pages at the right origin, a real resend, and an email match on accept.
4. **Cleanup** (medium):
   - remove the old `/api` routes and the worker's old loop;
   - regenerate the lockfile;
   - update `docs/architecture.md`, `docs/deploy.md` and `docs/technical-implementation-guide.md`;
   - record the Vercel, TV-code and auth decisions in `docs/open-decisions.md`.
5. **Network desk** (large):
   - the Catalog: shelf, series and items, the two-person rights check, rebuilding episodes, and the public-domain rules in configuration;
   - Settings: team roles, and the rules registry with effective dates and a change log. The rights check and other pages depend on these.
   - then Rights claims, Reserved call signs and Catalog sponsors.

Left to their phases:
- the Translators redraw (A4) goes with Phase 3's multistreaming;
- changing channel and tuning, with "Tuning sound" put to use, is Phase 5;
- the External sources rework is Phase 6.

Blocked outside Opencast: Clear Pay code events (Clear has to send them).
