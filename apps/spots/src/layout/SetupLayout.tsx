// Getting started (biz-funding 01, 02; the first spot): "Your business", "Fund your balance",
// "Your first spot" in the setup shell. Step 1 runs at /start, before the business exists; the
// rest under /:businessId/start/<step>.

import { Outlet, useLocation, useNavigate } from "react-router";
import { BusinessSetupShell } from "@opencast/ui";
import { useInAppLinks } from "./links";
import { useShellState } from "./shell";

const STEPS = ["business", "fund", "spot"];

export function SetupLayout() {
  useInAppLinks();
  const loc = useLocation();
  const navigate = useNavigate();
  const opts = useShellState();
  const parts = loc.pathname.split("/").filter(Boolean);
  const step = parts[0] === "start" ? 1 : STEPS.indexOf(parts[2] ?? "business") + 1 || 1;
  return (
    <BusinessSetupShell step={step} onFinishLater={() => navigate("/")} flush={opts.flush}>
      <Outlet />
    </BusinessSetupShell>
  );
}
