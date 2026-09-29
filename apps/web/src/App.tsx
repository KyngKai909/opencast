import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { GroundProvider, ToastProvider } from "@opencast/ui";
import { AuthProvider } from "./auth/AuthProvider";
import { SettingsSync } from "./viewer/layout/SettingsSync";
import { AppRoutes } from "./routes";

// One QueryClient for the three areas: an answer read in one (the account, a station) is there in the others.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <ToastProvider>
          <AuthProvider>
            {/* The account's ground and "Reduce motion", in every area: one setting. */}
            <SettingsSync />
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}
