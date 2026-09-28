// Getting started's later steps run in the setup shell, outside the business layout: this resolves
// `:businessId` for them the same way (the person's role on it), or says it isn't theirs.

import type { ReactNode } from "react";
import { BusinessProvider, useResolvedBusiness } from "../../business/BusinessContext";
import { NotYours, Quiet } from "../../pages/common";

export function SetupBusiness({ children }: { children: ReactNode }) {
  const { state, loading } = useResolvedBusiness();
  if (loading) return <Quiet />;
  if (!state) return <NotYours />;
  return <BusinessProvider value={state}>{children}</BusinessProvider>;
}
