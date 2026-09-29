// Settings (a rail page no frame draws): the ground, and signing out. The ground follows the system
// with a manual override, as in master control (the choice is kept on this device, "oc-ground").
import { accountsApi } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Segmented, useGround, type GroundChoice } from "@opencast/ui";
import { useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { SecTop } from "./common";

export default function Settings() {
  const auth = useAuth();
  const { choice, setChoice } = useGround();
  const me = useApi(accountsApi.getMe);
  return (
    <>
      <ControlTitle title="Settings" description="Your own settings for Network desk, on this device." />
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
