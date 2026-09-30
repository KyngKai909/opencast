# Stripe

Opencast is a ClearLabs Inc project and, for now, uses **ClearLabs Inc's existing Stripe account**, kept apart from Clear's own use of it. Everything below comes from configuration, so moving Opencast to its own Stripe account inside ClearLabs Inc's organization later is only a change of variables (and moving its customers' saved cards, below).

What Opencast uses Stripe for:

- **Businesses' card top-ups** (and, with `PAYMENTS_PROVIDER=stripe_only`, bank top-ups by ACH and withdrawals as refunds).
- **Viewers' pledges**, monthly or once, through Stripe Checkout; a monthly pledge's card is changed on a Checkout page in setup mode.
- **Stations' usage** (pay-as-you-go, follow-up Phase 2): a card saved with a SetupIntent, charged off-session at month end for what the station's earnings didn't cover.
- With `PAYMENTS_PROVIDER=stripe_only` only: **Stripe Connect Express** accounts to pay stations, and transfers to them.

## Kept apart from Clear

- **Its own restricted key.** `STRIPE_SECRET_KEY` holds a restricted key (`rk_test_…` or `rk_live_…`) made for Opencast alone, with only the permissions below. The API refuses to start with anything else: a secret key (`sk_…`, the account's own) is refused, and so is a live key outside production (`NODE_ENV` isn't `production`). Test-mode keys (`rk_test_…`) work anywhere else.
- **Its own webhook endpoint and signing secret.** `https://<api>/v1/webhooks/stripe`, with its own `STRIPE_WEBHOOK_SECRET`, separate from Clear's endpoints.
- **`app: opencast` in the metadata of every object Opencast creates**: customers, payment methods it attaches, PaymentIntents (top-ups, usage charges), Checkout Sessions and what they make (the pledge's PaymentIntent or subscription, the card page's SetupIntent), SetupIntents, refunds, Connect accounts and transfers. **Every webhook event whose object doesn't carry it is ignored** (answered 200, nothing done), so Clear's own payments on the account never reach Opencast's ledger. Refunds (Stripe-only withdrawals) only ever touch Opencast's own top-ups. The tag is `STRIPE_METADATA_APP` (default `opencast`).
- **"OPENCAST" on card statements.** Every card charge Opencast makes carries `statement_descriptor_suffix` from `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX` (default `OPENCAST`), so a business's top-up, a viewer's pledge and a station's usage charge read as the account's name followed by OPENCAST. A monthly pledge's renewals are Stripe Billing invoices, which Checkout can't give a suffix: Opencast sets it on each renewal's draft invoice when Stripe sends `invoice.created`. The first charge of a monthly pledge (made by Checkout itself) goes without it. Bank debits (ACH) aren't card charges and keep the account's own descriptor.

## Configuration

| Variable | What | Default |
|---|---|---|
| `STRIPE_SECRET_KEY` | Opencast's restricted key, `rk_test_…` (anywhere but production) or `rk_live_…` (production only). `sk_…` is refused | unset: cards are faked (`PAYMENTS_PROVIDER=fake`, or `clear` without Stripe) |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of Opencast's own webhook endpoint (`whsec_…`) | unset: Stripe's webhooks are refused (the API warns at start) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` / `pk_live_…`, for the card form in master control (sent with each SetupIntent, so the apps need no key of their own) | unset |
| `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX` | On every card charge. Up to 22 characters, at least one letter, no `< > \ ' " *` | `OPENCAST` |
| `STRIPE_METADATA_APP` | `metadata.app` on everything Opencast creates, and what webhook events must carry | `opencast` |
| `PAYMENTS_PROVIDER` | `fake`, `clear` (Stripe for cards when `STRIPE_SECRET_KEY` is set) or `stripe_only` | `fake` |

## The restricted key's permissions

In the Stripe Dashboard: Developers, API keys, **Create restricted key**, "Providing this key to another website" off, named **Opencast**. Set exactly these, and leave everything else **None**:

| Resource (as the Dashboard names it) | Permission | Why |
|---|---|---|
| Customers | **Write** | A customer for each business and each station, made the first time one saves a card |
| PaymentMethods | **Write** | Attach a business's card to its customer; tag it and a station's card with `metadata.app`; read a card's brand, last four and expiry; detach a station's old card |
| SetupIntents | **Write** | Save a station's card for usage (created, then read back when confirmed); read the SetupIntent behind a pledge's new card |
| PaymentIntents | **Write** | Card top-ups, usage charges (off-session), reading and cancelling a top-up that's undone; listing a customer's top-ups to refund them (Stripe-only) |
| Checkout Sessions | **Write** | Pledges (monthly and once) and a monthly pledge's card page |
| Refunds | **Write** | Stripe-only withdrawals, back to the top-ups they came from |
| Subscriptions | **Write** | Monthly pledges: stop at the end of the month, carry on, set the new card as the default |
| Invoices | **Write** | The statement suffix on each monthly pledge renewal's draft invoice |
| Events | **Read** | Reading its own events. The code doesn't call it today (webhooks are verified by their signature); it lets whoever holds the key look an event up by its ID |
| Webhook Endpoints | **None** | Set in the Dashboard, below |

Only with `PAYMENTS_PROVIDER=stripe_only` (anyone running Opencast without Clear), add:

| Resource | Permission | Why |
|---|---|---|
| Connect: Accounts | **Write** | A Stripe Connect Express account for each station |
| Connect: Account Links | **Write** | The onboarding link for a station's Express account |
| Transfers | **Write** | Payouts to stations' Express accounts |

Checkout makes a Price and a Product for each pledge's line item from its `price_data`; Stripe does that under the Checkout Sessions permission. Check this once in test mode when the key is made: if a pledge's Checkout Session is refused for Products or Prices, add **Products: Write** and **Prices: Write** and note it here.

## What to do in the Stripe Dashboard

1. **Create the restricted key** above, in test mode first (`rk_test_…`) for staging, then in live mode (`rk_live_…`) for production. Put it in `STRIPE_SECRET_KEY` on the API (Railway). Never the account's secret key.
2. **Add the webhook endpoint** (Developers, Webhooks, Add endpoint): `https://<api>/v1/webhooks/stripe` (the API's public address, e.g. `https://api.opencast.tv/v1/webhooks/stripe`), listening to events on **your account** (not connected accounts), with these events:
   - `payment_intent.succeeded`, `payment_intent.payment_failed` (top-ups, usage charges)
   - `setup_intent.succeeded` (a station's card saved)
   - `checkout.session.completed` (pledges and a pledge's new card)
   - `invoice.created`, `invoice.paid` (monthly pledges: the suffix on each renewal, and each payment)
   - `customer.subscription.deleted` (a monthly pledge ended)
   - `account.updated` (Stripe-only: a station's Express account finished)
3. **Copy its signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`. It's this endpoint's own; Clear's endpoints keep theirs.
4. **Copy the publishable key** (`pk_…`) into `STRIPE_PUBLISHABLE_KEY`.
5. Optionally set `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX` (default `OPENCAST`). The account's own statement descriptor (ClearLabs Inc's) stays as it is; the suffix follows it.
6. In test mode, run a top-up, a pledge and a station's card through the apps once, and check that each object in the Dashboard has `app: opencast` in its metadata and each charge ends in OPENCAST.

## Until Opencast has its own Stripe account

- Card statements read ClearLabs Inc's descriptor followed by OPENCAST.
- **The Stripe-only Connect fallback would show ClearLabs Inc's branding to stations**: Express onboarding, the Express dashboard and Stripe's emails carry the platform account's name, logo and colours, so a station setting up payouts through Stripe would see ClearLabs Inc, not Opencast. With `PAYMENTS_PROVIDER=clear` (the default in production) stations are paid through Clear and never see Stripe Connect.
- Moving to Opencast's own account is a change of variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`) plus moving the customers and their saved cards (Stripe copies them between accounts on request), and `ledger.provider_accounts` rows for `stripe_customer` pointing at the new customer IDs. Monthly pledges' subscriptions would have to be recreated in the new account.
- Objects made before `metadata.app` existed (staging ran with `PAYMENTS_PROVIDER=fake`, so there should be none) aren't recognised: a monthly pledge's subscription without the tag would stop being recorded. If any exist, add `app: opencast` to their metadata in the Dashboard.

## Tests

Nothing real is ever created. The API's tests use Stripe's official mock server (`stripe/stripe-mock`, started with Docker when it's not running; it checks every request against Stripe's API spec) and a recording transport that answers from canned objects (`apps/api/test/payments.test.ts`: `app: opencast` on every object, the suffix on every card charge, the key checks, and events without the tag ignored). Everything else runs on the fake provider (`apps/api/src/v1/payments/fake.ts`), whose station cards are named like Stripe's test cards (a SetupIntent with "declined" in it saves a card that's always declined).
