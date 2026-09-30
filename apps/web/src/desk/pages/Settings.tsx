// desk-pages 04, Settings: the team with its roles, and every rule Opencast runs on (prices, shares,
// rights dates, platform limits), each set from a date with the old value kept in the change log;
// each market's numbering; the escrow's signers. "You" keeps this device's ground and signing out.
//   /desk/settings/:section   team, rules (the frame's selected tab), markets, signers, log, you
import { Navigate, useParams } from "react-router";
import { accountsApi } from "@opencast/contracts";
import { Button, KeyValueList, Segmented, SettingsLayout, useGround, type GroundChoice } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthProvider";
import { ChangeLogSection, MarketsSection, RulesSection, SignersSection, TeamSection } from "../components/settings/SettingsSections";
import { deskPath } from "../../areas";
import { SecTop } from "./common";
import "./Catalog.css";
import "./Settings.css";

const SECTIONS = [
  { id: "team", label: "Team", description: "Who's on the Opencast team, and what each role can do." },
  { id: "rules", label: "Rules", description: "Set once, read everywhere. A change takes effect from the date you choose; the old value stays in the change log." },
  { id: "markets", label: "Markets", description: "Each market's numbering ranges." },
  { id: "signers", label: "Escrow signers", description: "The keys that approve a creator's claim on held earnings." },
  { id: "log", label: "Change log", description: "Every change made here, newest first." },
  { id: "you", label: "You", description: "Your own settings for Network desk, on this device." }
] as const;

function You() {
  const auth = useAuth();
  const { choice, setChoice } = useGround();
  const me = useApi(accountsApi.getMe);
  return (
    <>
      <SecTop title="Appearance" first />
      <KeyValueList
        variant="rows"
        items={[
          {
            title: "Ground",
            detail: "Dark is the default. The system setting decides unless you choose here.",
            actions: (
              <Segmented<GroundChoice>
                label="Ground"
                size="sm"
                value={choice}
                onChange={setChoice}
                options={[
                  { value: "system", label: "System" },
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" }
                ]}
              />
            )
          }
        ]}
      />
      <SecTop title="You" />
      <KeyValueList
        variant="rows"
        items={[
          {
            title: me.data?.displayName ?? me.data?.email ?? "Signed in",
            detail: me.data?.email ? `Signed in as ${me.data.email}. On the Opencast team.` : "On the Opencast team.",
            actions: (
              <Button size="sm" onClick={() => void auth.signOut()}>
                Sign out
              </Button>
            )
          }
        ]}
      />
    </>
  );
}

export default function Settings() {
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.id === section);
  if (!current) return <Navigate to={deskPath("/settings/rules")} replace />;
  return (
    <SettingsLayout
      className="nd-settings"
      sections={SECTIONS.map((s) => ({ id: s.id, label: s.label, href: deskPath(`/settings/${s.id}`) }))}
      active={current.id}
      description={current.description}
    >
      {current.id === "team" && <TeamSection />}
      {current.id === "rules" && <RulesSection />}
      {current.id === "markets" && <MarketsSection />}
      {current.id === "signers" && <SignersSection />}
      {current.id === "log" && <ChangeLogSection />}
      {current.id === "you" && <You />}
    </SettingsLayout>
  );
}
