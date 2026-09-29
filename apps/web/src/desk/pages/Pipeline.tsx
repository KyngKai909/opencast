// 02.1 The creator pipeline: every creator in the market, where they are, where their work lives,
// and the next thing to do. A to-do list, not a funnel: sorted by what needs doing first
// (components/pipeline/stages.ts). The strip's counts filter the list.

import { lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { type Creator, CreatorStage, networkApi } from "@opencast/contracts";
import { Button, ControlTitle, Lines, Table, useToast, type Column } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi, useApiMutation } from "../../api/hooks";
import { AddCreator } from "../components/pipeline/AddCreator";
import { StageStrip } from "../components/pipeline/StageStrip";
import { StageTag } from "../components/pipeline/StageTag";
import { actionFor, nextLine, pipelineOrder, PLATFORM_LABELS, stageCounts, stationCell, type Ctx } from "../components/pipeline/stages";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ, now } from "../../lib/clock";
import { ErrorLine, errorText, NotFound, Quiet } from "./common";
import "./Pipeline.css";
import { deskPath } from "../../areas";

// Mock mode only, and out of the production build: the creator's side of the flow.
const MockControls = import.meta.env.VITE_MOCK === "true" ? lazy(() => import("../components/pipeline/MockControls")) : null;

export default function Pipeline() {
  const { market, loading } = useMarket();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const creators = useApi(networkApi.listCreators, { query: { marketId: market?.id } }, { enabled: !!market });
  // The waitlist's holds, for "95.6, held" and "Waitlist holds 95.6; pick another".
  const tv = useApi(networkApi.getBoard, { params: { marketSlug: market?.slug ?? "" }, query: { band: "tv" } }, { enabled: !!market });
  const radio = useApi(networkApi.getBoard, { params: { marketSlug: market?.slug ?? "" }, query: { band: "radio" } }, { enabled: !!market });
  const remind = useApiMutation(networkApi.remindCreator, { invalidates: [networkApi.listCreators] });
  const update = useApiMutation(networkApi.updateCreator, { invalidates: [networkApi.listCreators, networkApi.getBoard] });

  if (loading || creators.isLoading) return <Quiet />;
  if (!market) return <NotFound />;
  if (creators.error) return <ErrorLine error={creators.error} />;

  const held = new Map<string, string>();
  for (const [b, band] of [[tv.data, "tv"], [radio.data, "radio"]] as const)
    for (const s of b?.slots ?? []) if (s.state === "held" && s.heldFor) held.set(band === "tv" ? `${s.major}.1` : (s.major / 10).toFixed(1), s.heldFor);
  const ctx: Ctx = { now: now(), timeZone: market.timezone || DEFAULT_TZ, held };
  const all = creators.data ?? [];
  const stageParam = CreatorStage.safeParse(params.get("stage"));
  const stage = stageParam.success ? stageParam.data : null;
  const rows = pipelineOrder(stage ? all.filter((c) => c.stage === stage) : all, ctx);
  const base = deskPath(`/markets/${market.slug}/pipeline`);

  const act = async (c: Creator) => {
    const a = actionFor(c, ctx);
    if (!a) return;
    try {
      if (a.kind === "ask") navigate(`${base}/${c.id}/ask`);
      else if (a.kind === "set-up" || a.kind === "open-setup") navigate(`${base}/${c.id}/setup`);
      else if (a.kind === "open-station") navigate(deskPath(`/markets/${market.slug}/board?ch=${c.station?.band === "radio" ? c.station.channel : (c.station?.channel ?? "").split(".")[0]}`));
      else if (a.kind === "remind") {
        await remind.mutateAsync({ params: { creatorId: c.id } });
        toast.show({ message: `Reminded ${c.displayName}. That's their one reminder.` });
      } else if (a.kind === "no-answer") {
        await update.mutateAsync({ params: { creatorId: c.id }, body: { stage: "no_answer" } });
        toast.show({
          message: `${c.displayName}: No answer. Nobody will ask again.`,
          onUndo: () => void call(networkApi.updateCreator, { params: { creatorId: c.id }, body: { stage: "asked" } }).then(() => creators.refetch())
        });
      }
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };

  const columns: Column<Creator>[] = [
    { key: "creator", header: "Creator", width: "minmax(0,1.2fr)", cell: (c) => <Lines title={c.displayName} detail={c.description} /> },
    { key: "platform", header: "Their work lives on", width: "150px", cell: (c) => PLATFORM_LABELS[c.sourcePlatform] },
    { key: "stage", header: "Stage", width: "130px", cell: (c) => <StageTag stage={c.stage} /> },
    { key: "station", header: "Station", width: "150px", kind: "mono", cell: (c) => stationCell(c, held) },
    {
      key: "next",
      header: "Next",
      cell: (c) => {
        const n = nextLine(c, ctx);
        return <span className={n.due ? "nd-pp__next nd-pp__next--due" : "nd-pp__next"}>{n.text}</span>;
      }
    },
    {
      key: "action",
      header: <span className="oc-sr-only">Action</span>,
      width: "110px",
      align: "end",
      cell: (c) => {
        const a = actionFor(c, ctx);
        return a ? (
          <Button size="sm" onClick={() => void act(c)} disabled={remind.isPending || update.isPending} aria-label={`${a.label}: ${c.displayName}`}>
            {a.label}
          </Button>
        ) : null;
      }
    }
  ];

  const setStage = (s: CreatorStage | null) => setParams((p) => (s ? p.set("stage", s) : p.delete("stage"), p), { replace: true });
  const adding = params.get("add") === "1";
  const closeAdd = () => setParams((p) => (p.delete("add"), p), { replace: true });

  return (
    <>
      <ControlTitle
        title="Creator pipeline"
        description={`${market.name}. Sorted by what needs doing first.`}
        end={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setParams((p) => (p.set("add", "1"), p))}>
            Add a creator
          </Button>
        }
      />
      <StageStrip counts={stageCounts(all)} selected={stage} onSelect={setStage} />
      {rows.length ? (
        <Table label="Creators" columns={columns} rows={rows} rowKey={(c) => c.id} rowPadding={11} className="nd-pp" />
      ) : (
        <p className="nd-pp__empty">{stage ? "Nobody at this stage." : `No creators in the ${market.name} yet. Add the first one you find.`}</p>
      )}
      {MockControls && (
        <Suspense fallback={null}>
          <MockControls creators={all} marketSlug={market.slug} onChanged={() => void creators.refetch()} />
        </Suspense>
      )}
      {adding && <AddCreator market={market} onClose={closeAdd} />}
    </>
  );
}
