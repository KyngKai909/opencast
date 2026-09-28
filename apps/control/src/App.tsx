import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { GroundProvider, ToastProvider } from "@opencast/ui";
import { AuthProvider } from "./auth/AuthProvider";
import { ShellOptionsProvider } from "./layout/shell";
import { AppRoutes } from "./routes";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <ShellOptionsProvider>
                <AppRoutes />
              </ShellOptionsProvider>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}
