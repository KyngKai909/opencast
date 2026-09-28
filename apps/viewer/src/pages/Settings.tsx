// Settings (you 05.1 web, 06.3 phone): eight sections. On the web a rail and one pane; on the
// phone a list of the eight, each a screen with a back arrow, never a modal. /settings shows
// Account on the web and the list on the phone; /settings/:section opens one.

import { Navigate, useNavigate, useParams } from "react-router";
import { SettingsLayout, type SettingsSection } from "@opencast/ui";
import { useAuth } from "../auth/AuthProvider";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { SECTIONS, SectionPane, sectionLede, type SectionId } from "../components/settings/panes";
import "../components/settings/Settings.css";
import "./Settings.css";

export default function SettingsPage() {
  const phone = useIsPhone();
  const auth = useAuth();
  const navigate = useNavigate();
  const { section } = useParams();
  const known = SECTIONS.find((s) => s.id === section);
  const active: SectionId | null = known ? known.id : phone ? null : "account";
  // The phone's settings draw their own back bar; a section screen hides the tabs and the player.
  useShellOptions(phone ? { top: null, padded: false, tabs: active === null, player: active === null } : { padded: false });

  if (section && !known) return <Navigate to="/settings" replace />;

  const sections: SettingsSection[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    href: `/settings/${s.id}`,
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(`/settings/${s.id}`);
    }
  }));

  return (
    <SettingsLayout
      className="vw-settings"
      variant="viewer"
      form={phone ? "phone" : "web"}
      sections={sections}
      active={active}
      description={active ? sectionLede(active, auth.signedIn) : undefined}
      backHref="/settings"
      onBack={() => navigate("/settings")}
    >
      {active && <SectionPane id={active} phone={phone} />}
    </SettingsLayout>
  );
}
