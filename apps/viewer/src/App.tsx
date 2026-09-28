import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { GroundProvider, ToastProvider } from "@opencast/ui";
import { AuthProvider } from "./auth/AuthProvider";
import { PlayerRoot } from "./player/PlayerRoot";
import { ShellOptionsProvider } from "./layout/shell";
import { AppRoutes } from "./routes";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <ToastProvider>
          <AuthProvider>
            <PlayerRoot>
              <BrowserRouter>
                <ShellOptionsProvider>
                  <AppRoutes />
                </ShellOptionsProvider>
              </BrowserRouter>
            </PlayerRoot>
          </AuthProvider>
        </ToastProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}
