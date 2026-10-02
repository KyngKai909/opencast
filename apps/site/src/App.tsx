import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroundProvider } from "@opencast/ui";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { Faq } from "./components/Faq";
import { Waitlist } from "./components/Waitlist";
import {
  BusinessesSection,
  DialSection,
  Hero,
  JoinIntro,
  LocalSection,
  MoneySection,
  OpenSection,
  ProducersSection,
  RemoteSection,
  StationsSection
} from "./components/Sections";
import type { Role } from "./lib/waitlist";

export function App({ client }: { client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  const [role, setRole] = useState<Role>("viewer");
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <div className="st-page">
          <SiteHeader />
          <main id="top">
            <Hero />
            <DialSection />
            <RemoteSection />
            <StationsSection />
            <ProducersSection onListPrograms={() => setRole("producer")} />
            <BusinessesSection />
            <MoneySection />
            <LocalSection />
            <OpenSection />
            <section className="st-s" id="join">
              <div className="st-wrap st-join">
                <JoinIntro />
                <div>
                  <Waitlist role={role} onRoleChange={setRole} />
                </div>
              </div>
            </section>
            <Faq />
          </main>
          <SiteFooter />
        </div>
      </GroundProvider>
    </QueryClientProvider>
  );
}
