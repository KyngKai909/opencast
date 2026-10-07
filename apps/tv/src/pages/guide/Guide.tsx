// tv 03.1 the guide ("/guide"): the focused program at the top left, the channel you're watching
// still playing in a window at the top right, and six stations by two hours below. Arrows move
// through the grid (▲ ▼ keep the time), CH pages six stations, numbers jump to a channel, OK on
// what's on now tunes and closes, OK on a later program opens its options (nested, so Back comes
// back to the same cell), Back closes the guide. An external station's cells (follow-up Phase 6)
// say whose stream it is; its time with nothing listed tunes in, and has no options.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { clock, Kbd, LiveText } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import type { ApiError } from "../../api/client";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { useCommandLayer } from "../../tv/commands";
import { useSignedIn } from "../../tv/data";
import { getDevice } from "../../tv/device";
import { heldReminderKey } from "../../components/guide/optionsLogic";
import { useDescriptions, useGuideData } from "../../components/guide/data";
import {
  cellTitle,
  describe,
  externalLine,
  focusedCell,
  focusOn,
  guideCommand,
  identText,
  initialFocus,
  jump,
  offAirLine,
  okAction,
  okHint,
  rowForTyped,
  slotFloor,
  SPAN,
  typeKey,
  visibleRows,
  whenLine,
  blockLine,
  type Cell,
  type GuideFocus,
  type GuideModel
} from "../../components/guide/guideLogic";
import { TvGuideGrid, TvGuideGridPlaceholder } from "../../components/guide/TvGuideGrid";
import "./Guide.css";

/** What the options dialog reads from the guide (useOutletContext). */
export interface GuideOutlet {
  model: GuideModel | null;
  /** The cell and its station, by the route's id. */
  find(key: string): { cell: Cell; row: GuideModel["rows"][number] } | null;
}

function outletFind(model: GuideModel, key: string) {
  for (const r of model.rows) {
    const c = r.cells.find((x) => x.key === key);
    if (c) return { cell: c, row: r };
  }
  return null;
}

export default function Guide() {
  const loc = useLocation();
  const navigate = useNavigate();
  const optionsOpen = loc.pathname.startsWith("/guide/options");
  const [player, engine] = usePlayer();
  const now = useNow(10_000).getTime();
  const { model, loading, error } = useGuideData();
  const [focus, setFocus] = useState<GuideFocus | null>(null);

  // Opens on the channel you're watching, at the time it is now; or, coming back to a program's
  // options (from About), on that program.
  const optionsKey = optionsOpen ? decodeURIComponent(loc.pathname.split("/")[3] ?? "") : null;
  useEffect(() => {
    if (!model || focus || !model.rows.length) return;
    setFocus((optionsKey ? focusOn(model, optionsKey, now) : null) ?? initialFocus(model, player.currentId, now));
  }, [model, focus, optionsKey, player.currentId, now]);

  // A reminder asked for before signing in: once signed in, back to its options, where it's set.
  const signedIn = useSignedIn();
  useEffect(() => {
    const held = heldReminderKey();
    if (signedIn && model && held && !optionsOpen && outletFind(model, held)) navigate(`/guide/options/${encodeURIComponent(held)}`, { replace: true });
  }, [signedIn, model, optionsOpen, navigate]);

  // The window shows the picture alone: no banner over it while the guide is up. Tuning from the
  // guide closes it, and the new channel's banner stays for the picture ("every change shows the
  // banner").
  const leaving = useRef(false);
  useEffect(() => {
    if (player.banner && !leaving.current) engine.hideBanner();
  }, [player.banner, engine]);

  const cell = model && focus ? focusedCell(model, focus) : null;
  const row = model && focus ? model.rows[focus.row] : null;

  // Numbers jump to a channel: "1", "2" is 12.1. The digits are forgotten after the number wait.
  const typed = useRef({ text: "", at: 0 });
  const typeNumber = useCallback(
    (key: number | ".") => {
      if (!model) return;
      const wait = getDevice().settings.numberWaitSeconds * 1000;
      const t = Date.now();
      const text = t - typed.current.at > wait ? typeKey("", key) : typeKey(typed.current.text, key);
      typed.current = { text, at: t };
      const r = rowForTyped(model, text);
      if (r >= 0) setFocus((f) => (f ? jump(f, r) : f));
    },
    [model]
  );

  const choose = useCallback(
    (c: Cell | null) => {
      if (!c) return;
      const act = okAction(c, now);
      if (act === "tune") {
        leaving.current = true;
        if (c.stationId !== player.currentId) void engine.tune(c.stationId, { input: "app", via: "guide" });
        navigate("/", { replace: true });
      } else if (act === "options") navigate(`/guide/options/${encodeURIComponent(c.key)}`, { replace: true });
    },
    [engine, navigate, now, player.currentId]
  );

  useCommandLayer(
    (c) => {
      const r = guideCommand(c, model, focus);
      if (r.focus) setFocus(r.focus);
      if (r.choose) choose(cell);
      if (r.typed !== undefined) typeNumber(r.typed);
      return r.handled;
    },
    { active: !optionsOpen, keys: "overlay" }
  );

  const rows = model && focus ? visibleRows(model, focus) : [];
  const firstRow = focus ? focus.row - (focus.row % 6) : 0;
  const from = focus?.from ?? slotFloor(now);
  const onScreen = useMemo(() => {
    const ids: string[] = [];
    for (const r of rows) for (const c of r.cells) if (c.airing?.programId && c.airing.kind !== "listed" && c.end > from && c.start < from + SPAN) ids.push(c.airing.programId);
    return ids;
  }, [rows, from]);
  const descriptions = useDescriptions(onScreen);

  const outlet: GuideOutlet = useMemo(() => ({ model, find: (key) => (model ? outletFind(model, key) : null) }), [model]);

  const current = player.channels.find((c) => c.station.id === player.currentId);
  const description = cell ? describe(cell.airing, cell.airing?.programId ? descriptions.get(cell.airing.programId) : null) : null;
  const offAir = cell && row ? offAirLine(cell, row.station, MARKET_TZ) : null;
  const external = cell && row ? externalLine(cell, row.station, player.channels.find((c) => c.station.id === row.station.id)?.external?.source) : null;
  const hint = cell ? okHint(cell, now) : null;

  let body;
  if (error && !model) body = <p className="tvg__msg" role="alert">{(error as ApiError).message || "Something went wrong. Try again."}</p>;
  else if (loading || !model) body = <TvGuideGridPlaceholder from={from} timeZone={MARKET_TZ} />;
  else if (!model.rows.length) body = <p className="tvg__msg">No stations on the TV band yet.</p>;
  else
    body = (
      <TvGuideGrid
        rows={rows}
        from={from}
        now={now}
        timeZone={MARKET_TZ}
        focusedKey={cell?.key ?? null}
        onCell={(ri, c) => {
          if (!focus) return;
          const next = { ...focus, row: firstRow + ri, t: Math.max(c.start, from) };
          if (c.key === cell?.key) choose(c);
          else setFocus(next);
        }}
      />
    );

  return (
    <div className={optionsOpen ? "tvg tvg--dim" : "tvg"}>
      {/* The dim over the picture, with a hole where the window is. */}
      <div className="tvg__window" aria-hidden="true" />
      <div className="tvg__top">
        <div className="tvg__info" aria-live="polite">
          {cell && row ? (
            <>
              <div className="tvg__when oc-mono">{whenLine(cell, row.station, MARKET_TZ)}</div>
              {/* A244: a programming block's member says so. */}
              {blockLine(cell) && <div className="tvg__block">{blockLine(cell)}</div>}
              <h2 className="tvg__title">{cellTitle(cell, row.station)}</h2>
              {description ? (
                <p className="tvg__desc">
                  {description.liveLead ? (
                    <>
                      <LiveText className="tvg-live" />
                      {description.text.slice(4)}
                    </>
                  ) : (
                    description.text
                  )}
                </p>
              ) : offAir ? (
                <p className="tvg__desc">{offAir}</p>
              ) : external ? (
                <p className="tvg__desc">{external}</p>
              ) : null}
              <div className="tvg__hint">
                {hint && (
                  <span>
                    <Kbd size="tv">OK</Kbd>
                    {hint}
                  </span>
                )}
                <span>
                  <Kbd size="tv">Back</Kbd>Close guide
                </span>
              </div>
            </>
          ) : (
            <div className="tvg__hint">
              <span>
                <Kbd size="tv">Back</Kbd>Close guide
              </span>
            </div>
          )}
        </div>
        <div className="tvg__live">
          <div className="tvg__pic" />
          <div className="tvg__cap">
            <span>{current ? `Now on ${identText(current.station)}` : ""}</span>
            <span className="oc-mono">{clock(now, { timeZone: MARKET_TZ })}</span>
          </div>
        </div>
      </div>
      <div className="tvg__grid">{body}</div>
      <Outlet context={outlet} />
    </div>
  );
}
