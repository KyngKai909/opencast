// Offering 02.1 Offer a program (/market/offered/:programId/offer). A program offered before (and
// withdrawn) opens with its last terms.

import { useParams } from "react-router";
import { useBrowse, useOffer } from "../../components/market/api";
import { OfferForm } from "../../components/market/OfferForm";
import { Quietly } from "../../components/market/parts";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";

export default function OfferProgram() {
  const s = useStation();
  const { programId = "" } = useParams();
  const mine = useBrowse({ maker: s.id });
  const existing = mine.data?.find((o) => o.program.id === programId) ?? null;
  const detail = useOffer(existing?.id, null);
  if (mine.isLoading || (existing && detail.isLoading)) return <Quiet />;
  if (mine.error) return <Quietly role="alert">{mine.error.message}</Quietly>;
  return <OfferForm key={existing?.id ?? programId} programId={programId} offer={existing ? detail.data ?? null : null} />;
}
