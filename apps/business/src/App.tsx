import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { GroundProvider, ToastProvider } from "@opencast/ui";
import { AuthProvider } from "./auth/AuthProvider";
import { ShellOptionsProvider } from "./layout/shell";
import { AppRoutes } from "./routes";
import { InviteGate } from "./invites/InviteGate";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <ShellOptionsProvider>
                {/* Added 2026-10-07: signed in but not let in yet, the invite code comes first. */}
                <InviteGate>
                  <AppRoutes />
                </InviteGate>
              </ShellOptionsProvider>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}
