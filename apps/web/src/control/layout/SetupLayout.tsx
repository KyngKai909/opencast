// A new station's setup (master-control A.1 to A.6): "New station, step N of 5", the step rail,
// Save and finish later. Scoped by id until the first sign-on fixes the call sign.

import { Outlet, useLocation, useNavigate } from "react-router";
import { ControlSetupShell } from "@opencast/ui";
import { useInAppLinks } from "./links";
import { useShellState } from "./shell";
import { CONTROL } from "../../areas";

const STEPS = ["station", "library", "log", "translators", "sign-on"];

export function SetupLayout() {
  useInAppLinks();
  const loc = useLocation();
  const navigate = useNavigate();
  const opts = useShellState();
  const step = STEPS.indexOf(loc.pathname.slice(CONTROL.length).split("/").filter(Boolean)[2] ?? "station") + 1 || 1;
  return (
    <ControlSetupShell step={step} onFinishLater={() => navigate(CONTROL)} flush={opts.flush}>
      <Outlet />
    </ControlSetupShell>
  );
}
