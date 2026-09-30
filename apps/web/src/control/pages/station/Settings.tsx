// station-settings: Identity, Breaks, Sponsorship, Translators, Team (+ invite), Notifications,
// Station account, Ownership (/settings/:section). On the web a sub-rail and a pane; on the phone
// the list of sections, each its own screen with a back arrow. Hosts never get here (the layout
// sends them to their live blocks); operators see what they can't change as read-only.

import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { SettingsLayout, type SettingsSection } from "@opencast/ui";
import SponsorshipSettings, { sponsorshipDescription } from "../../components/spots/SponsorshipSettings";
import StationAccount from "../../components/earnings/StationAccount";
import { BreaksSection } from "../../components/station/settings/BreaksSection";
import { IdentitySection } from "../../components/station/settings/IdentitySection";
import { InviteModal } from "../../components/station/settings/InviteModal";
import { NotificationsSection } from "../../components/station/settings/NotificationsSection";
import { OwnershipSection } from "../../components/station/settings/OwnershipSection";
import { TeamLede, TeamSection } from "../../components/station/settings/TeamSection";
import { RelayBackground } from "../../components/station/RelayBackground";
import { TranslatorsPanel } from "../../components/station/TranslatorsPanel";
import { relayStopsNote, translatorsLede } from "../../components/station/relayWords";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation, type StationState } from "../../station/StationContext";
import { NotFound } from "../common";
import "./Settings.css";

interface Section {
  id: string;
  label: string;
  danger?: boolean;
  /** Stations only: a studio has no dial, breaks or translators. */
  station?: boolean;
}

export const SECTIONS: Section[] = [
  { id: "identity", label: "Identity" },
  { id: "breaks", label: "Breaks", station: true },
  { id: "sponsorship", label: "Sponsorship", station: true },
  { id: "translators", label: "Translators", station: true },
  { id: "team", label: "Team" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Station account" },
  { id: "ownership", label: "Ownership", danger: true }
];

function lede(id: string, s: StationState, phone: boolean) {
  const cs = s.station.callSign ?? s.station.name;
  switch (id) {
    case "identity":
      return `How ${cs} appears on the dial, in the guide and on its own picture.`;
    case "breaks":
      return `Applied to every break ${cs} airs, including breaks inside carried programs where ${cs} sells the time.`;
    case "sponsorship":
      return sponsorshipDescription(cs);
    case "translators":
      return translatorsLede(cs);
    case "team":
      return <TeamLede s={s} />;
    case "notifications":
      return phone ? undefined : s.studio ? `What you hear about ${cs}. Each person on the team sets their own.` : `What you hear about ${cs}. Each person on the team sets their own. Dead-air warnings are always on.`;
    case "account":
      return s.studio
        ? `${cs} pays only for what it uses past the free allowance, mostly storage, from its earnings first.`
        : `Being on air is free. ${cs} pays only for storage, relays of everything it airs and live hours, from its earnings first.`;
    case "ownership":
      return `Hand ${cs} to someone on the team, or sign it off for good.`;
    default:
      return undefined;
  }
}

function Body({ id, s, phone }: { id: string; s: StationState; phone: boolean }) {
  switch (id) {
    case "identity":
      return <IdentitySection s={s} />;
    case "breaks":
      return <BreaksSection s={s} />;
    case "sponsorship":
      return <SponsorshipSettings />;
    case "translators":
      return (
        <div className="cc-settings__translators">
          <TranslatorsPanel stationId={s.id} callSign={s.station.callSign ?? s.station.name} owner={s.role === "owner"} accountHref={`${s.base}/settings/account`} phone={phone} />
          <p className="cc-settings__note">{relayStopsNote(s.station.callSign ?? s.station.name)}</p>
          {s.station.band === "radio" && <RelayBackground stationId={s.id} callSign={s.station.callSign ?? s.station.name} channel={s.station.channel} colour={s.station.colour} canEdit={s.can("programming")} />}
        </div>
      );
    case "team":
      return <TeamSection s={s} phone={phone} />;
    case "notifications":
      return <NotificationsSection s={s} />;
    case "account":
      return <StationAccount />;
    case "ownership":
      return <OwnershipSection s={s} />;
    default:
      return null;
  }
}

export default function Settings() {
  const s = useStation();
  const { section } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const inviting = /\/settings\/team\/invite\/?$/.test(loc.pathname);
  const active = inviting ? "team" : (section ?? null);
  useShellOptions({ flush: true, context: "Settings" });

  const available = SECTIONS.filter((x) => !x.station || !s.studio);
  if (!active && !phone) return <Navigate to={`${s.base}/settings/identity`} replace />;
  if (active && !available.some((x) => x.id === active)) return <NotFound />;
  // Only owners invite.
  if (inviting && !s.can("manage")) return <Navigate to={`${s.base}/settings/team`} replace />;

  const sections: SettingsSection[] = available.map((x) => ({ id: x.id, label: x.label, danger: x.danger, href: `${s.base}/settings/${x.id}` }));
  const cs = s.station.callSign ?? s.station.name;
  const heading = phone && active === "notifications" ? `${cs} notifications` : undefined;

  return (
    <>
      <SettingsLayout
        className="cc-settings"
        sections={sections}
        active={active}
        heading={heading}
        description={active ? lede(active, s, phone) : undefined}
        form={phone ? "phone" : "web"}
        backHref={`${s.base}/settings`}
      >
        {active && <Body id={active} s={s} phone={phone} />}
      </SettingsLayout>
      {active === "team" && s.can("manage") && <InviteModal s={s} phone={phone} open={inviting} onClose={() => navigate(`${s.base}/settings/team`)} />}
    </>
  );
}
