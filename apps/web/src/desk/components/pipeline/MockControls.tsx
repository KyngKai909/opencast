// Mock mode only (lazy-loaded behind VITE_MOCK, so it isn't in a production build): the other side
// of the pipeline, so a creator can go found → asked → said yes → set up → on air → claimed on
// mocks. The creator's answer (as the permission page would give it), the sign-on time arriving,
// the claim, and the verifiers' approval after 72 hours.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@opencast/ui";
import { currentToken } from "../../../api/client";
import { config } from "../../../config";
import "./MockControls.css";
import type { Creator } from "@opencast/contracts";

async function mockCall(path: string, body?: unknown): Promise<{ link?: string }> {
  const token = await currentToken();
  const res = await fetch(`${config.apiBase}/v1/__mock/desk${path}`, {
    method: body === undefined && path.endsWith("/link") ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? "The mock said no.");
  return json;
}

interface Row {
  creator: Creator;
  actions: Array<{ label: string; run: () => Promise<unknown> }>;
}

export default function MockControls({ creators, onChanged }: { creators: Creator[]; marketSlug: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows: Row[] = creators.flatMap((c) => {
    const id = c.id;
    const actions: Row["actions"] = [];
    if (c.stage === "asked") {
      actions.push({ label: "Open their permission page", run: async () => window.open((await mockCall(`/creators/${id}/link`)).link, "_blank", "noopener") });
      actions.push({ label: "They say yes", run: () => mockCall(`/creators/${id}/answer`, { answer: "yes" }) });
      actions.push({ label: "They say no", run: () => mockCall(`/creators/${id}/answer`, { answer: "no" }) });
    }
    if (c.stage === "setting_up") actions.push({ label: "Sign it on now", run: () => mockCall(`/creators/${id}/sign-on`, {}) });
    if ((c.stage === "on_air" || c.stage === "already_licensed") && c.station?.kind === "claimable") {
      actions.push({ label: "They start a claim", run: () => mockCall(`/creators/${id}/claim`, {}) });
      actions.push({ label: "Approved, and 72 hours pass", run: () => mockCall(`/creators/${id}/claim-complete`, {}) });
    }
    return actions.length ? [{ creator: c, actions }] : [];
  });
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await qc.invalidateQueries();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="nd-mock" aria-label="Mock mode: the creator's side">
      <p className="nd-mock__h">Mock mode: the creator's side</p>
      {rows.map((r) => (
        <div key={r.creator.id} className="nd-mock__row">
          <span className="nd-mock__name">{r.creator.displayName}</span>
          {r.actions.map((a) => (
            <Button key={a.label} size="sm" variant="text" disabled={busy} onClick={() => void run(a.run)}>
              {a.label}
            </Button>
          ))}
        </div>
      ))}
      <div className="nd-mock__row">
        <span className="nd-mock__name">All of it</span>
        <Button size="sm" variant="text" disabled={busy} onClick={() => void run(() => mockCall("/reset", {}))}>
          Start the mock again
        </Button>
      </div>
      {error && <p className="nd-mock__error">{error}</p>}
    </section>
  );
}
