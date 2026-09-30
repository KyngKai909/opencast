// Stripe.js, loaded from js.stripe.com: the only way master control collects a card (docs/stripe.md).
// The card number goes from Stripe's own form (the Payment Element, in Stripe's frame) to Stripe;
// Opencast gets the SetupIntent back and saves the card by it (billingApi.saveCard). Nothing here
// is bundled: Stripe requires Stripe.js to come from its own address, and it's loaded only when an
// owner opens "Add a card" on a server with a publishable key.

/** The parts of Stripe.js master control uses. */
export interface StripeElement {
  mount(el: HTMLElement): void;
  destroy(): void;
  on(event: "ready" | "change", handler: (e: { complete?: boolean }) => void): void;
}

export interface StripeElements {
  create(type: "payment", options?: Record<string, unknown>): StripeElement;
}

export interface StripeJs {
  elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements;
  confirmSetup(options: { elements: StripeElements; redirect: "if_required"; confirmParams?: { return_url?: string } }): Promise<{
    error?: { message?: string };
    setupIntent?: { id: string; status: string };
  }>;
}

type StripeFactory = (publishableKey: string) => StripeJs;

declare global {
  interface Window {
    Stripe?: StripeFactory;
  }
}

export const STRIPE_JS_URL = "https://js.stripe.com/v3/";

let loading: Promise<StripeFactory> | null = null;

function loadScript(): Promise<StripeFactory> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  loading ??= new Promise<StripeFactory>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS_URL}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: STRIPE_JS_URL, async: true });
    script.addEventListener("load", () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe's card form didn't load. Try again."))));
    script.addEventListener("error", () => {
      loading = null;
      reject(new Error("Stripe's card form didn't load. Check the connection and try again."));
    });
    if (!existing) document.head.appendChild(script);
  });
  return loading;
}

const instances = new Map<string, StripeJs>();

/** Stripe.js for a publishable key (one instance per key). */
export async function loadStripe(publishableKey: string): Promise<StripeJs> {
  const factory = await loadScript();
  let s = instances.get(publishableKey);
  if (!s) instances.set(publishableKey, (s = factory(publishableKey)));
  return s;
}
