// Mock mode only: master control's side of a sponsorship or an order, so the business's flow can be
// walked end to end in `dev:mock`. Each button calls the station's (or Opencast's) own contract
// endpoint, answered by the mock: the answer arrives the way it would from master control. Never
// shown against the real API.

import { useState } from "react";
import { Button } from "@opencast/ui";
import { config } from "../../config";
import { errorText } from "./data";
import "./MockStation.css";

export interface MockAction {
  label: string;
  run: () => Promise<unknown>;
}

export function MockStation({ who, actions }: { who: string; actions: MockAction[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!config.mock || actions.length === 0) return null;
  return (
    <aside className="bz-mock" aria-label="Mock only">
      <p className="bz-mock__p">
        <b>Mock only.</b> {who}
      </p>
      <div className="bz-mock__actions">
        {actions.map((a) => (
          <Button
            key={a.label}
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setBusy(a.label);
              setError(null);
              a.run()
                .catch((e) => setError(errorText(e)))
                .finally(() => setBusy(null));
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {error && (
        <p className="bz-mock__p" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
