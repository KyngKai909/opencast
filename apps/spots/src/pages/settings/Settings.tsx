// biz-settings: Business (01.1), Team (02.1; Add someone as ?modal=invite, and 05.2 ?sheet=invite
// on the phone), Money and receipts (03.1), Notifications and Connections (04.1, one frame with both
// panes), Close account (not drawn; the owner's). /:businessId/settings/:section. On the web a
// sub-rail and a pane; on the phone the list of sections, each its own screen with a back arrow.

import type { ReactNode } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { SettingsLayout, cx, type SettingsSection } from "@opencast/ui";
import { useBusiness, useMe } from "../../business/BusinessContext";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { CloseSection } from "../../components/settings/CloseSection";
import { ConnectionsSection } from "../../components/settings/ConnectionsSection";
import { firstName } from "../../components/settings/format";
import { InviteModal } from "../../components/settings/InviteModal";
import { LocationModal } from "../../components/settings/LocationModal";
import { MoneySection } from "../../components/settings/MoneySection";
import { NotificationsSection } from "../../components/settings/NotificationsSection";
import { ProfileSection } from "../../components/settings/ProfileSection";
import { accessFor, sectionsFor, type SectionId } from "../../components/settings/rules";
import { TeamLede, TeamSection } from "../../components/settings/TeamSection";
import { useApi } from "../../api/hooks";
import { spotsApi } from "@opencast/contracts";
import { NotFound } from "../common";
import "./Settings.css";

export default function Settings() {
  const b = useBusiness();
  const { section } = useParams();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const profile = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { enabled: section === "business" });
  // On the phone the settings list and each section carry their own back bar; the phone bar keeps the business name.
  useShellOptions({ flush: true });

  const sections = sectionsFor(b.role);
  if (!section && !phone) return <Navigate to={`${b.base}/settings/business`} replace />;
  if (section && !sections.some((s) => s.id === section)) return section === "close" ? <Navigate to={`${b.base}/settings/business`} replace /> : <NotFound />;
  const active = (section ?? null) as SectionId | null;
  const access = accessFor(b.role);

  // Overlays: ?modal= on the web, ?sheet= on the phone; either opens the right one at either width.
  const overlay = params.get("modal") ?? params.get("sheet");
  const openOverlay = (name: string) =>
    setParams((p) => {
      p.set(phone ? "sheet" : "modal", name);
      return p;
    });
  const closeOverlay = () =>
    setParams(
      (p) => {
        p.delete("modal");
        p.delete("sheet");
        return p;
      },
      { replace: true }
    );

  // Notifications and connections share one frame on the web.
  const both = !phone && (active === "notifications" || active === "connections");
  const you = firstName(me.data?.displayName);
  const notifLede = you ? `For you, ${you}. Each person sets their own.` : "For you. Each person sets their own.";

  const lede = (): ReactNode => {
    switch (active) {
      case "business":
        return "Changes show everywhere at once: in stations' spot markets, on sponsor credits, and on saved offers.";
      case "team":
        return <TeamLede b={b} />;
      case "money":
        return "Only the owner can change where money comes from or take it out.";
      case "notifications":
        return notifLede;
      case "connections":
        return both ? notifLede : "Optional. Opencast works without them.";
      case "close":
        return `Close ${b.business.name}'s account for good.`;
      default:
        return undefined;
    }
  };

  const body = () => {
    switch (active) {
      case "business":
        return <ProfileSection b={b} onAddLocation={() => openOverlay("location")} />;
      case "team":
        return <TeamSection b={b} phone={phone} onInvite={() => openOverlay("invite")} />;
      case "money":
        return <MoneySection b={b} />;
      case "notifications":
      case "connections":
        if (both)
          return (
            <>
              <NotificationsSection b={b} />
              <ConnectionsSection b={b} heading />
            </>
          );
        return active === "notifications" ? <NotificationsSection b={b} /> : <ConnectionsSection b={b} heading={false} />;
      case "close":
        return <CloseSection b={b} />;
      default:
        return null;
    }
  };

  const items: SettingsSection[] = sections.map((s) => ({ id: s.id, label: s.label, danger: s.danger, href: `${b.base}/settings/${s.id}` }));

  return (
    <>
      <SettingsLayout
        className={cx("bz-settings", both && "bz-settings--both", active === "team" && !phone && access.team === "edit" && "bz-settings--team")}
        sections={items}
        active={active}
        heading={both ? "Notifications" : undefined}
        description={active ? lede() : undefined}
        form={phone ? "phone" : "web"}
        backHref={`${b.base}/settings`}
      >
        {body()}
      </SettingsLayout>
      {active === "team" && access.team === "edit" && <InviteModal businessId={b.id} phone={phone} open={overlay === "invite"} onClose={closeOverlay} />}
      {active === "business" && access.profile === "edit" && (
        <LocationModal businessId={b.id} where={profile.data?.customersWhere ?? "location"} phone={phone} open={overlay === "location"} onClose={closeOverlay} />
      )}
    </>
  );
}
