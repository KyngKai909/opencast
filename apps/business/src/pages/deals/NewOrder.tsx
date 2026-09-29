// production-orders 02.1 order a spot: the brief (/orders/new). What it's called, its length, what
// it's about, what it must say, files to use, when it's needed, and who makes it (listMakers, with
// turnaround, history or specialty, samples and "From $"). "Ask BEAT for a quote" sends the brief
// (orderSpot), then attaches the files (attachBriefFile, multipart; P18 asks for files with the
// brief). `?from=<orderId>` starts from an earlier brief, after a maker passed, offering the others.
// Owners and managers.

import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { spotsApi, type ProductionOrder } from "@opencast/contracts";
import { Button, Field, Icon, Segmented, TextAreaField, money, useToast } from "@opencast/ui";
import { call } from "../../api/client";
import { useBusiness } from "../../business/BusinessContext";
import { errorText, useMakers, useOrder, useProfile, useRefresh } from "../../components/deals/data";
import { callSign, marketDate, stationLabel } from "../../components/deals/format";
import { PickRows } from "../../components/deals/PickRows";
import { ErrorLine, NoAccess, PageHead } from "../../components/deals/parts";
import { useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import "./NewOrder.css";

/** Who owns the finished spot (Open, production orders 02): one line, easy to change. */
export const OWNERSHIP_TERMS = "Stations that make spots are paid for the work even if the spot never airs on their station. You'll own the finished spot and can list it anywhere on Opencast.";

type Length = "15" | "30" | "60";

export default function NewOrder() {
  const b = useBusiness();
  useShellOptions({ title: "Order a spot" });
  if (!b.can("advertise")) return <NoAccess base={b.base} />;
  return <NewOrderPage />;
}

function NewOrderPage() {
  const b = useBusiness();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const [params] = useSearchParams();
  const today = marketDate(useNow(60_000));
  const profile = useProfile(b);
  const makers = useMakers(b, profile.data?.marketIds[0]);
  const from = useOrder(b, params.get("from") ?? undefined);
  const files = useRef<HTMLInputElement>(null);
  const filesId = useId();

  const [title, setTitle] = useState("");
  const [length, setLength] = useState<Length>("30");
  const [about, setAbout] = useState("");
  const [mustSay, setMustSay] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [chosen, setChosen] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Starting again after a maker passed: the same brief, and the other makers.
  const prior: ProductionOrder | undefined = from.data;
  useEffect(() => {
    if (!prior) return;
    setTitle(prior.title);
    setLength(String(prior.lengthSec) as Length);
    setAbout(prior.about);
    setMustSay(prior.mustSay ?? "");
    setNeededBy(prior.neededBy > today ? prior.neededBy : "");
  }, [prior, today]);

  const list = (makers.data ?? []).filter((m) => !prior || m.station.id !== prior.maker.id);
  const maker = list.find((m) => m.station.id === picked) ?? list[0] ?? null;

  const problems = {
    title: !title.trim() ? "Give it a name." : null,
    about: !about.trim() ? "Say what it's about." : null,
    neededBy: !neededBy ? "Pick a date." : neededBy <= today ? "Pick a date after today." : null
  };
  const ok = !problems.title && !problems.about && !problems.neededBy && !!maker;

  const send = async () => {
    setTried(true);
    if (!ok || !maker) return;
    setSending(true);
    setError(null);
    try {
      const order = await call(spotsApi.orderSpot, {
        params: { businessId: b.id },
        body: { makerStationId: maker.station.id, title: title.trim(), lengthSec: Number(length) as 15 | 30 | 60, about: about.trim(), mustSay: mustSay.trim() || undefined, neededBy }
      });
      for (const file of chosen) await call(spotsApi.attachBriefFile, { params: { orderId: order.id }, body: { file } });
      await refresh();
      toast.show({ message: `Sent to ${callSign(maker.station)} for a quote.` });
      navigate(`${b.base}/orders/${order.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bz-no">
      <PageHead trail="Made for you / New order" title="Order a spot" />
      <div className="bz-no__grid">
        <div className="bz-no__brief">
          <div className="bz-no__sec">
            <h2>The brief</h2>
          </div>
          <Field className="bz-no__fld bz-no__fld--first" label="Call it" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} error={tried ? problems.title : null} />
          <div className="bz-no__fld">
            <span className="bz-no__lb">Length</span>
            <Segmented
              label="Length"
              value={length}
              onChange={setLength}
              options={[
                { value: "15", label: ":15" },
                { value: "30", label: ":30" },
                { value: "60", label: ":60" }
              ]}
            />
          </div>
          <TextAreaField className="bz-no__fld" label="What it's about" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={1000} error={tried ? problems.about : null} />
          <TextAreaField className="bz-no__fld bz-no__fld--short" label="It must say" value={mustSay} onChange={(e) => setMustSay(e.target.value)} maxLength={500} />
          <div className="bz-no__fld">
            <span className="bz-no__lb">Files to use</span>
            <div className="bz-no__assets">
              {chosen.map((f, i) => (
                <span key={`${f.name}-${i}`} className="bz-no__asset">
                  {f.name}
                  <button type="button" className="bz-no__x" aria-label={`Remove ${f.name}`} onClick={() => setChosen((c) => c.filter((_, j) => j !== i))}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
              <button type="button" className="bz-no__asset bz-no__asset--add" onClick={() => files.current?.click()}>
                Add files
              </button>
              <input
                ref={files}
                id={filesId}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const picked_ = Array.from(e.target.files ?? []);
                  setChosen((c) => [...c, ...picked_]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <Field className="bz-no__fld bz-no__date" label="Needed by" type="date" min={today} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} error={tried ? problems.neededBy : null} />
        </div>

        <div>
          <div className="bz-no__sec">
            <h2>Who makes it</h2>
            <span className="bz-no__sub">They'll quote before anything is paid</span>
          </div>
          {prior && prior.state === "passed" && <p className="bz-no__passed">{stationLabel(prior.maker)} passed on this one. Ask another maker.</p>}
          <div className="bz-no__makers">
            {makers.isLoading ? null : makers.error ? (
              <ErrorLine>{errorText(makers.error)}</ErrorLine>
            ) : (
              <PickRows
                label="Who makes it"
                value={maker?.station.id ?? null}
                onChange={setPicked}
                options={list.map((m) => ({
                  value: m.station.id,
                  colour: m.station.colour,
                  title: stationLabel(m.station),
                  line: [m.turnaround, m.history ?? m.specialty, m.samples > 0 && `${m.samples} ${m.samples === 1 ? "sample" : "samples"}`].filter(Boolean).join(". "),
                  end: m.fromMicros !== null ? `From ${money(m.fromMicros, { trimCents: true })}` : undefined
                }))}
              />
            )}
          </div>
          <p className="bz-no__terms">{OWNERSHIP_TERMS}</p>
          <Button variant="primary" block className="bz-no__send" disabled={sending || !maker} onClick={send}>
            {maker ? `Ask ${callSign(maker.station)} for a quote` : "Ask for a quote"}
          </Button>
          <ErrorLine>{error}</ErrorLine>
        </div>
      </div>
    </div>
  );
}
