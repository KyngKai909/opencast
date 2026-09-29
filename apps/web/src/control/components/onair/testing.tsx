// For the On air area's component tests: a screen rendered with the mock API (master control's
// MSW handlers), signed in as someone from the mock world, with a router, queries and toasts.
// Tests mock ../../../config first (mock mode, the reference Saturday's clock).

import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@opencast/ui";
import { setTokenSource } from "../../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../../auth/mockToken";

/** jsdom has no matchMedia: the web layout (not the phone's). */
export function stubMatchMedia() {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
}

export function signInAs(email: string) {
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}${email}`);
}

export function renderWithApi(ui: ReactNode, { path = "/" }: { path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
