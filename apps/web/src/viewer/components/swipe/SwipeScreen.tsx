// The swipe home (A245; viewer/opencast-swipe-home.html): the home is the picture. Swiping up and
// down moves through the viewer's presets, then the rest of the dial in channel order, with
// resistance as the finger drags and a snap on letting go (swipe home 08). The next and previous
// stations are warm, so the drag usually shows their live picture; one that isn't ready shows the
// tuning static with its number and keeps it after the snap until its first frame. Tapping the
// picture pauses and resumes; Back to live comes up while behind. Only the packaging is new: the
// player (its static, corner number, bug and banner) is the one specified elsewhere.
//
// Around the picture: the market, the TV and Radio bands and search at the top (full bleed under
// the status bar, fading from the edge), the five buttons on the right, the position line, and the
// shell's floating bar. In landscape the labels drop, the tabs and band switch go (phones), and the
// buttons fade after 3 seconds. Tablets keep the picture 16:9 in portrait, with the station's
// colour around it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Icon, IconButton, Slate, clock, cx } from "@opencast/ui";
import { PlayerSurface, TuningStatic, boundaryFrom, orderIds, orderPlace, prefersReducedMotion, stepId, type Boundary } from "@opencast/player";
import { MARKET_TZ, now as clockNow, useNow } from "../../../lib/clock";
import type { DialRowX } from "../../api/ext";
import { useMarkets, useMarketSlug } from "../../data/viewer";
import { setDevice } from "../../device/store";
import { tick } from "../../native/haptics";
import { useCastSession } from "../../cast/session";
import { watchOnOffered } from "../../cast/useCast";
import { useOverlayParams } from "../watch/overlay";
import { stationSlug } from "../watch/logic";
import { stationPath } from "../station/actions";
import { AirPlayLine } from "../watch/AirPlay";
import { NotForMe } from "../watch/NotForMe";
import { SharedAiring } from "../watch/parts";
import { WatchOnSheet } from "../remote/WatchOnSheet";
import type { WatchData } from "../watch/useWatch";
import { AXIS_PX, CHROME_HIDE_MS, DETENT_SHARE, FADE_MS, OSD_MS, SNAP_EASE, SNAP_MS, SPRING_EASE, SPRING_MS, TAP_SLOP_PX, axisOf, directionOf, dragOffset, releaseAction, seamAt, velocityOf, type Sample, type SwipeDir } from "./gesture";
import { backToLivePlace, behindMs, behindText, boundaryText, placeText } from "./rules";
import { useSwipeOrders } from "./useSwipeOrder";
import { SwipeRail } from "./SwipeRail";
import { useSwipeShell, type SwipeForm } from "./form";
import "./swipe.css";

/** After the snap, the swipe's own picture waits at most this long for the player to take over. */
const LAND_GIVE_UP_MS = 9000;

interface Peek {
  row: DialRowX;
  dir: SwipeDir;
  boundary: Boundary | null;
  /** The player has its warm picture beside this one. */
  picture: boolean;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  samples: Sample[];
  axis: "x" | "y" | null;
  dir: SwipeDir | null;
  target: DialRowX | null;
  boundary: Boundary | null;
  /** The player has the target's warm picture beside this one. */
  picture: boolean;
  offset: number;
  crossed: boolean;
  /** This press turned the sound on. */
  sound?: boolean;
}

/** How far behind live, counted from the player's pauses (behind live is only ever caused by pausing). */
function useBehind(w: WatchData): number {
  const s = w.state;
  const acc = useRef<{ before: number; since: number | null }>({ before: 0, since: null });
  const t = useNow(1000);
  const since = s.status === "paused" ? (s.paused?.since ?? null) : null;
  if (!s.behindLive && s.status !== "paused") acc.current = { before: 0, since: null };
  else if (since !== acc.current.since) {
    // A pause began, or one ended: what it added stays counted.
    const a = acc.current;
    if (a.since !== null) a.before += Math.max(0, Date.now() - a.since);
    a.since = since;
  }
  return behindMs({ before: acc.current.before, pausedSince: acc.current.since, now: Math.max(t.getTime(), Date.now()) });
}

export function SwipeScreen({ w, form }: { w: WatchData; form: SwipeForm }) {
  const s = w.state;
  const engine = w.engine;
  const navigate = useNavigate();
  const { open } = useOverlayParams();
  const orders = useSwipeOrders();
  const markets = useMarkets();
  const slug = useMarketSlug();
  const cast = useCastSession();
  const row = w.row;
  const fromId = s.pendingId ?? s.currentId ?? row?.station.id ?? null;
  const band = row?.station.band === "radio" ? "radio" : "tv";
  const order = band === "radio" ? orders.radio : orders.tv;
  const ids = useMemo(() => orderIds(order), [order]);
  const landscape = form.landscape;

  const root = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const detent = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const busy = useRef(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [landing, setLanding] = useState<{ id: string; picture: boolean } | null>(null);
  const [osd, setOsd] = useState<DialRowX | null>(null);
  const [chrome, setChrome] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether the sound was held (the browser's first-tap rule, or Muted previews) as the latest press
   * went down: that press turns it on and does nothing else. Read before the player's own listener
   * (registered after this one) turns the sound on.
   */
  const soundHeld = useRef(false);
  useLayoutEffect(() => {
    const on = () => void (soundHeld.current = engine.getState().mutedByBrowser);
    window.addEventListener("pointerdown", on, { capture: true });
    return () => window.removeEventListener("pointerdown", on, { capture: true });
  }, [engine]);

  const height = () => root.current?.clientHeight ?? 0;
  const skip = useCallback((id: string) => !engine.canPlayDash() && w.channels.find((c) => c.station.id === id)?.playback?.format === "dash", [engine, w.channels]);

  // ---------- The buttons in landscape: back for 3 seconds after any tap ----------
  const showChrome = useCallback(
    (keep = false) => {
      setChrome(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      if (landscape && !keep) hideTimer.current = setTimeout(() => setChrome(false), CHROME_HIDE_MS);
    },
    [landscape]
  );
  useEffect(() => {
    showChrome(s.status === "paused");
    return () => void (hideTimer.current && clearTimeout(hideTimer.current));
  }, [landscape, s.status === "paused"]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Moving the pictures (straight on the elements: no render per frame) ----------
  const place = (offset: number, dir: SwipeDir | null) => {
    const h = height();
    if (cur.current) cur.current.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : "";
    const at = dir ? offset + (dir === "next" ? h : -h) : 0;
    for (const el of [back.current, front.current]) if (el) el.style.transform = `translate3d(0, ${at}px, 0)`;
  };
  const transition = (value: string) => {
    for (const el of [cur.current, back.current, front.current]) if (el) el.style.transition = value;
  };
  const placeDetent = (d: Drag) => {
    const el = detent.current;
    if (!el) return;
    if (!d.boundary || !d.dir) return void el.classList.remove("is-on");
    el.classList.add("is-on");
    const seam = seamAt(d.offset, height(), d.dir);
    // On the seam, just inside the incoming picture.
    el.style.top = `${d.dir === "next" ? seam - 46 : seam + 10}px`;
  };

  /** The station the drag is heading for, the detent if it crosses one, and its picture beside this one. */
  const prepare = (d: Drag, dir: SwipeDir) => {
    d.dir = dir;
    d.crossed = false;
    const id = stepId(ids, fromId, dir, skip);
    const target = id ? (w.channels.find((c) => c.station.id === id) ?? null) : null;
    d.target = target;
    d.boundary = target ? boundaryFrom(ids, fromId, dir) : null;
    const picture = target ? engine.peek(target.station.id) : (engine.peek(null), false);
    d.picture = picture;
    // The warm picture sits a screen below (or above) the one on screen, and moves with it.
    cur.current?.style.setProperty("--oc-peek-y", `${dir === "next" ? height() : -height()}px`);
    setPeek(target ? { row: target, dir, boundary: d.boundary, picture } : null);
  };

  const finish = () => {
    transition("");
    place(0, null);
    cur.current?.style.removeProperty("--oc-peek-y");
    root.current?.removeAttribute("data-dragging");
    detent.current?.classList.remove("is-on");
  };

  /** The snap has landed: the player changes channel (no static when the picture was showing). */
  const land = (target: DialRowX, picture: boolean) => {
    setLanding({ id: target.station.id, picture });
    if (picture) setOsd(target);
    setDevice({ lastStationId: target.station.id });
    void engine.swipeTo(target.station.id, { input: "touch" });
    busy.current = false;
  };

  const snap = (d: Drag) => {
    const target = d.target;
    if (!target || !d.dir) return finish();
    const picture = d.picture && engine.swipeReady(target.station.id);
    busy.current = true;
    tick();
    if (prefersReducedMotion()) {
      // Reduced motion: no slide; the player crossfades in 200 ms.
      finish();
      engine.peek(null);
      setPeek(null);
      return land(target, false);
    }
    const h = height();
    transition(`transform ${SNAP_MS}ms ${SNAP_EASE}`);
    place(d.dir === "next" ? -h : h, d.dir);
    setTimeout(() => {
      // Where it ended: the incoming picture in place, the old one gone. The warm picture stays put
      // (at 0) until the player has made it the one on screen.
      transition("");
      if (cur.current) {
        cur.current.style.transform = "";
        cur.current.style.setProperty("--oc-peek-y", "0px");
      }
      for (const el of [back.current, front.current]) if (el) el.style.transform = "translate3d(0, 0, 0)";
      root.current?.removeAttribute("data-dragging");
      detent.current?.classList.remove("is-on");
      land(target, picture);
    }, SNAP_MS + 10);
  };

  const springBack = (d: Drag) => {
    busy.current = true;
    transition(prefersReducedMotion() ? `transform ${FADE_MS}ms linear` : `transform ${SPRING_MS}ms ${SPRING_EASE}`);
    place(0, d.dir);
    detent.current?.classList.remove("is-on");
    setTimeout(() => {
      finish();
      engine.peek(null);
      setPeek(null);
      busy.current = false;
    }, (prefersReducedMotion() ? FADE_MS : SPRING_MS) + 10);
  };

  /** Next or previous without a finger: the arrow keys and the screen reader's actions. */
  const step = useCallback(
    (dir: SwipeDir) => {
      if (busy.current || drag.current) return;
      const d: Drag = { id: -1, x0: 0, y0: 0, samples: [], axis: "y", dir: null, target: null, boundary: null, picture: false, offset: 0, crossed: false };
      prepare(d, dir);
      if (!d.target) return;
      root.current?.setAttribute("data-dragging", "");
      place(0, dir);
      requestAnimationFrame(() => snap(d));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, fromId, w.channels]
  );

  // The player has taken over (its picture, its static, its needle or its off-air screen): the
  // swipe's own layer goes.
  useEffect(() => {
    if (!landing) return;
    const id = landing.id;
    const done = (s.currentId === id && !s.pendingId) || s.tuning?.stationId === id || s.status === "standby";
    if (done) {
      engine.peek(null);
      setPeek(null);
      setLanding(null);
      finish();
      return;
    }
    const t = setTimeout(() => {
      engine.peek(null);
      setPeek(null);
      setLanding(null);
      finish();
    }, LAND_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [landing, s.currentId, s.pendingId, s.tuning?.stationId, s.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // The corner number after a snap that showed the picture (the player draws its own on a full change).
  useEffect(() => {
    if (!osd) return;
    const t = setTimeout(() => setOsd(null), OSD_MS);
    return () => clearTimeout(t);
  }, [osd]);

  // swipe home 08, "Preloading": while the swipe home is up, the next and previous stations (and the
  // dial's first while in the presets) keep a picture ready, so the drag shows them live. Elsewhere
  // the player goes back to warming playlists only (PlayerRoot's default), and the picture is put away.
  useEffect(() => {
    engine.setOptions({ warm: "buffer" });
    return () => {
      engine.peek(null);
      engine.setOptions({ warm: "prefetch" });
    };
  }, [engine]);

  // ---------- The finger ----------
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (busy.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const sound = soundHeld.current;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, samples: [{ y: e.clientY, t: e.timeStamp }], axis: null, dir: null, target: null, boundary: null, picture: false, offset: 0, crossed: false, sound };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 12) d.samples.shift();
    if (!d.axis) {
      d.axis = axisOf(dx, dy);
      if (d.axis === "y") {
        root.current?.setAttribute("data-dragging", "");
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // A pointer the browser no longer knows (it was cancelled): the drag goes on without capture.
        }
      }
    }
    if (d.axis !== "y") return;
    const dir = directionOf(dy);
    if (dir !== d.dir && Math.abs(dy) > 2) prepare(d, dir);
    if (!d.target) return;
    const h = height();
    d.offset = dragOffset(dy, h, !!d.boundary);
    place(d.offset, d.dir);
    if (d.boundary) {
      // A light tick when the pull crosses the detent's threshold.
      const past = Math.abs(d.offset) > DETENT_SHARE * h;
      if (past && !d.crossed) tick();
      d.crossed = past;
    }
    placeDetent(d);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    // Letting go is the last sample: a finger that stopped before lifting isn't a flick.
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.axis && moved < Math.max(TAP_SLOP_PX, AXIS_PX)) return onTap(e, !!d.sound);
    if (d.axis !== "y") return;
    if (!d.target) return finish();
    const act = releaseAction({ offset: d.offset, velocity: velocityOf(d.samples), height: height(), detent: !!d.boundary });
    if (act === "snap") snap(d);
    else springBack(d);
  };
  const onPointerCancel = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.axis === "y" && d.target) springBack(d);
    else finish();
  };

  /** A tap: pause or resume (taps on buttons and bars never pause); the call sign opens the station's page. */
  const onTap = (e: PointerEvent<HTMLDivElement>, soundTap: boolean) => {
    showChrome();
    const t = e.target as Element;
    if (t.closest("button, a, [role='button']")) return;
    // The call sign in the banner, the bug or the corner number (drawn over the picture, not
    // buttons of their own): the station's page.
    const on = (sel: string) =>
      Array.from(root.current?.querySelectorAll(sel) ?? []).some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
    if (row && on(".oc-banner__id, .oc-bug, .oc-ovl__logo, .vw-sw__osd")) return void navigate(stationPath(row.station));
    if (soundTap) return;
    if (s.status === "playing" || s.status === "paused") engine.togglePlay();
  };

  // The arrow keys (swipe home 01's demo): down brings the next station up, up the previous.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k !== "ArrowDown" && k !== "ArrowUp" && k !== "PageDown" && k !== "PageUp") return;
      const t = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (t?.closest && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="radiogroup"]'))) return;
      e.preventDefault();
      step(k === "ArrowDown" || k === "PageDown" ? "next" : "prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // ---------- Back to live ----------
  const bannerUp = !!s.banner && !s.entry;
  const livePlace = backToLivePlace(s, bannerUp);
  const behind = useBehind(w);
  // Just above the banner: where the banner's top is now (it varies with what's on).
  useLayoutEffect(() => {
    const el = root.current;
    const b = el?.querySelector<HTMLElement>(".oc-banner");
    if (!el) return;
    if (b) el.style.setProperty("--vw-sw-banner-top", `${b.offsetTop}px`);
    else el.style.removeProperty("--vw-sw-banner-top");
  });

  // ---------- What's drawn ----------
  const nextId = stepId(ids, fromId, "next", skip);
  const prevId = stepId(ids, fromId, "prev", skip);
  const nextRow = nextId ? w.channels.find((c) => c.station.id === nextId) : undefined;
  const prevRow = prevId ? w.channels.find((c) => c.station.id === prevId) : undefined;
  const ident = (r: DialRowX | undefined) => (r ? [r.station.callSign ?? r.station.name, r.station.channel].filter(Boolean).join(" ") : "");
  const position = placeText(orderPlace(ids, row?.station.id ?? null), band);
  const marketName = markets.data?.find((m) => m.slug === slug)?.name ?? "Choose a market";
  const paused = s.status === "paused" && !!s.paused;
  const onTv = cast.status === "casting" || cast.status === "mirroring";
  const glow = row?.station.colour ?? "#33507A";
  const hiddenChrome = landscape && !chrome;
  const tabletPortrait = form.device === "tablet" && !landscape;
  useSwipeShell(form, hiddenChrome);
  const label = peek?.boundary ? boundaryText(peek.boundary, { presets: ids.presets, total: ids.ids.length, band }) : null;

  const switchBand = (to: "tv" | "radio") => {
    if (to === band) return;
    const first = (to === "radio" ? orders.radio : orders.tv).rows[0];
    if (first) navigate(`/watch/${stationSlug(first.station)}`);
  };

  return (
    <div
      ref={root}
      className={cx("vw-sw", `vw-sw--${form.device}`, landscape ? "vw-sw--land" : "vw-sw--port", paused && "vw-sw--paused", hiddenChrome && "vw-sw--quiet", livePlace && "vw-sw--behind")}
      style={{ "--vw-sw-glow": glow } as CSSProperties}
    >
      <div className="vw-sw__touch" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        {/* The incoming station, behind the moving picture: its colour, its static or its off-air screen. */}
        <div ref={back} className="vw-sw__peek" aria-hidden="true" hidden={!peek}>
          {peek && <PeekBack peek={peek} tablet={tabletPortrait} />}
        </div>
        <div ref={cur} className="vw-sw__cur">
          {tabletPortrait && <div className="vw-sw__glow" aria-hidden="true" />}
          <PlayerSurface timeZone={MARKET_TZ} clock={clockNow} fill={form.device === "tablet" && !landscape ? "contain" : "cover"} pausedControls={false} className="vw-sw__pic" />
          {paused && <div className="vw-sw__dim" aria-hidden="true" />}
        </div>
        {/* Over it all: the incoming station's corner number. */}
        <div ref={front} className="vw-sw__peek vw-sw__peek--front" aria-hidden="true" hidden={!peek}>
          {peek && (
            <div className="vw-sw__osd is-on">
              <span className="vw-sw__n oc-mono">{peek.row.station.channel}</span>
              <span className="vw-sw__c oc-cs">{peek.row.station.callSign}</span>
            </div>
          )}
        </div>
        {osd && !peek && (
          <div className="vw-sw__osd vw-sw__osd--landed is-on" aria-hidden="true">
            <span className="vw-sw__n oc-mono">{osd.station.channel}</span>
            <span className="vw-sw__c oc-cs">{osd.station.callSign}</span>
          </div>
        )}
        {paused && (
          <div className="vw-sw__pause" aria-hidden="true">
            <span className="vw-sw__pause-g">
              <Icon name="play" size={26} />
            </span>
            {/* On the app's clock (the banner's), however long ago the player paused. */}
            <span>Paused at {clock(new Date(clockNow().getTime() - (Date.now() - s.paused!.since)), { timeZone: MARKET_TZ })}</span>
          </div>
        )}
      </div>

      <div ref={detent} className="vw-sw__detent" aria-hidden="true">
        {label && (
          <div>
            {label.title}
            <small>{label.sub}</small>
          </div>
        )}
      </div>

      {/* The top bar: full bleed under the status bar, fading from the very edge. */}
      <header className="vw-sw__top">
        <button type="button" className="vw-sw__mkt" onClick={() => open({ modal: "market" })} aria-haspopup="dialog">
          {marketName}
          <Icon name="down" size={13} />
        </button>
        <div className="vw-sw__band" role="group" aria-label="Band">
          <button type="button" aria-pressed={band === "tv"} onClick={() => switchBand("tv")} disabled={!orders.tv.rows.length}>
            TV
          </button>
          <button type="button" aria-pressed={band === "radio"} onClick={() => switchBand("radio")} disabled={!orders.radio.rows.length}>
            Radio
          </button>
        </div>
        <div className="vw-sw__end">
          {s.airPlay.available && !s.airPlay.active && <IconButton icon="tv" label="AirPlay" bare className="vw-sw__ib" onClick={() => engine.showAirPlayPicker()} />}
          {watchOnOffered() && <IconButton icon="cast" label={onTv ? `Watching on ${cast.target.name}` : "Cast"} aria-pressed={onTv} bare className="vw-sw__ib" onClick={() => open({ sheet: "watch-on" })} />}
          <IconButton icon="search" label="Search" bare className="vw-sw__ib" onClick={() => navigate("/search")} />
        </div>
      </header>

      <div className="vw-sw__notes">
        <AirPlayLine w={w} className="vw-airplay--phone" />
        <SharedAiring w={w} />
      </div>

      <SwipeRail w={w} className="vw-sw__chrome" />

      {position && !livePlace && (
        <div className="vw-sw__pos vw-sw__chrome" aria-live="polite">
          {position}
        </div>
      )}
      <div className="vw-sw__nfm vw-sw__chrome">
        <NotForMe w={w} />
      </div>

      {livePlace && (
        <Button className={cx("vw-sw__live", `vw-sw__live--${livePlace}`)} onClick={() => engine.backToLive()} aria-label={`Back to live, ${behindText(behind)}`}>
          <i aria-hidden="true" />
          Back to live
          <span className="vw-sw__behind oc-mono">{behindText(behind)}</span>
        </Button>
      )}

      {/* The swipe's keyboard and screen-reader way: next and previous as actions. */}
      <div className="vw-sw__sr">
        <button type="button" onClick={() => step("next")} disabled={!nextRow}>
          {nextRow ? `Next channel: ${ident(nextRow)}` : "Next channel"}
        </button>
        <button type="button" onClick={() => step("prev")} disabled={!prevRow}>
          {prevRow ? `Previous channel: ${ident(prevRow)}` : "Previous channel"}
        </button>
        {row && (
          <a href={stationPath(row.station)} onClick={(e) => (e.preventDefault(), navigate(stationPath(row.station)))}>
            {`${row.station.name}'s page`}
          </a>
        )}
      </div>
      <WatchOnSheet />
    </div>
  );
}

/** The incoming station behind the moving picture: nothing over its warm picture; else its static, its off-air screen, or the radio band's card. */
function PeekBack({ peek, tablet }: { peek: Peek; tablet: boolean }) {
  const r = peek.row;
  const st = r.station;
  const glow = { "--vw-sw-glow": st.colour ?? "#33507A" } as CSSProperties;
  const offAir = st.kind !== "listed" && (!r.onAir || !r.playback || r.now?.kind === "off_air");
  if (st.band === "radio")
    return (
      <div className="vw-sw__radio" style={glow}>
        <span className="vw-sw__radio-f oc-mono">{st.channel}</span>
        <span className="vw-sw__radio-cs oc-cs">{st.callSign}</span>
        <span className="vw-sw__radio-t">{r.onAir && r.now ? r.now.title : "Off air"}</span>
      </div>
    );
  if (offAir) {
    const back = r.now?.kind === "off_air" ? (r.now.backAt ?? r.now.endsAt) : (r.backAt ?? r.next?.startsAt ?? null);
    return (
      <div className="vw-sw__off" style={glow}>
        <Slate kind="off-air" callSign={st.callSign ?? undefined} name={st.name}>
          {back ? (
            <>
              {`${[st.callSign, st.channel].filter(Boolean).join(" ")} signs on again at `}
              <span className="oc-mono">{clock(back, { timeZone: MARKET_TZ })}</span>.
            </>
          ) : null}
        </Slate>
      </div>
    );
  }
  if (peek.picture) return <div className={cx("vw-sw__ready", tablet && "vw-sw__ready--glow")} style={glow} />;
  return (
    <div className="vw-sw__static">
      <TuningStatic rolling={false} />
    </div>
  );
}
