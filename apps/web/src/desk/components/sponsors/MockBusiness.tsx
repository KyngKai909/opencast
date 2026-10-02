// Mock mode only (lazy-loaded behind VITE_MOCK, so it isn't in a production build): the business's
// side of an offer, which in the API it answers from its own account
// (`POST /businesses/:businessId/catalog-sponsorships/:id/answer`).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CatalogSponsorship } from "@opencast/contracts";
import { Button } from "@opencast/ui";
import { currentToken } from "../../../api/client";
import { config } from "../../../config";
import { seriesWords } from "./sponsors";
import "../pipeline/MockControls.css";

async function answer(id: string, decision: "accept" | "decline") {
  const token = await currentToken();
  const res = await fetch(`${config.apiBase}/v1/__mock/desk/catalog-sponsorships/${id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ decision })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? "The mock said no.");
}

export default function MockBusiness({ offers }: { offers: CatalogSponsorship[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!offers.length) return null;
  const run = async (id: string, decision: "accept" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      await answer(id, decision);
      await qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="nd-mock" aria-label="Mock mode: the business's side">
      <p className="nd-mock__h">Mock mode: the business's side</p>
      {offers.map((o) => (
        <div key={o.id} className="nd-mock__row">
          <span className="nd-mock__name">
            {o.business.name}: {seriesWords(o)}, {o.market.name}
          </span>
          <Button size="sm" variant="text" disabled={busy} onClick={() => void run(o.id, "accept")}>
            They say yes
          </Button>
          <Button size="sm" variant="text" disabled={busy} onClick={() => void run(o.id, "decline")}>
            They say no
          </Button>
        </div>
      ))}
      {error && <p className="nd-mock__error">{error}</p>}
    </section>
  );
}
