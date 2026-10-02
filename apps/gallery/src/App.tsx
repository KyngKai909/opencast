import { Link, NavLink, Route, Routes, useParams } from "react-router";
import { Lockup, useGround, type GroundChoice } from "@opencast/ui";
import { ALL, GROUPS, byId } from "./specimens";
import type { Specimen, Source } from "./registry";
import { ScaledFrame } from "./Frame";

const GROUND_LABEL: Record<"dark" | "light" | "tv", string> = { dark: "Dark ground", light: "Light ground", tv: "TV (always dark)" };

function refHref(s: Source) {
  return `/reference/${s.file}${s.anchor ? `#${s.anchor}` : ""}`;
}

function SourceLinks({ from }: { from: Source[] }) {
  return (
    <ul className="gal-sources">
      {from.map((s, i) => (
        <li key={i}>
          <a href={refHref(s)} target="_blank" rel="noreferrer">
            {s.file}
            {s.anchor ? ` #${s.anchor}` : ""}
          </a>
          {s.frames?.length ? <span className="oc-quiet"> frames {s.frames.join(", ")}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function StatePanel({ spec, ground, render }: { spec: Specimen; ground: "dark" | "light" | "tv"; render: () => React.ReactNode }) {
  const attrs = ground === "tv" ? { "data-ground": "tv" } : { "data-theme": ground };
  return (
    <div className="gal-panel oc-app" {...attrs}>
      <div className="gal-panel__label">{GROUND_LABEL[ground]}</div>
      <div className="gal-panel__body">{spec.frame ? <ScaledFrame {...spec.frame}>{render()}</ScaledFrame> : render()}</div>
    </div>
  );
}

function SpecimenView({ spec }: { spec: Specimen }) {
  const grounds = spec.grounds ?? ["dark", "light"];
  return (
    <article className="gal-spec" id={spec.id}>
      <header className="gal-spec__head">
        <h2>{spec.name}</h2>
        <span className="oc-quiet">{spec.group}</span>
        <Link className="gal-compare-link" to={`/${spec.id}/compare`}>
          Compare with the reference
        </Link>
      </header>
      {spec.notes && <p className="gal-spec__notes">{spec.notes}</p>}
      <SourceLinks from={spec.from} />
      {spec.states.map((st, i) => (
        <section key={i} className="gal-state" data-state={st.label}>
          <h3>{st.label}</h3>
          {st.note && <p className="gal-state__note">{st.note}</p>}
          <div className={spec.stacked || spec.frame ? "gal-grounds gal-grounds--stacked" : "gal-grounds"}>
            {grounds.map((g) => (
              <StatePanel key={g} spec={spec} ground={g} render={st.render} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function SpecimenPage() {
  const { id = "" } = useParams();
  const spec = byId(id);
  if (!spec) return <p>No specimen called {id}.</p>;
  return <SpecimenView spec={spec} />;
}

function GroupPage() {
  const { group = "" } = useParams();
  const list = ALL.filter((s) => s.group.toLowerCase() === group.toLowerCase());
  return (
    <>
      {list.map((s) => (
        <SpecimenView key={s.id} spec={s} />
      ))}
    </>
  );
}

function ComparePage() {
  const { id = "" } = useParams();
  const spec = byId(id);
  const { ground, setChoice: setGround } = useGround();
  if (!spec) return <p>No specimen called {id}.</p>;
  const src = spec.from[0];
  return (
    <div className="gal-compare">
      <header className="gal-spec__head">
        <h2>{spec.name}: compared</h2>
        <Link to={`/${spec.id}`}>Back to the specimen</Link>
        <button className="gal-ground-btn" type="button" onClick={() => setGround(ground === "dark" ? "light" : "dark")}>
          {ground === "dark" ? "Light ground" : "Dark ground"}
        </button>
      </header>
      <div className="gal-compare__cols">
        <div>
          <div className="gal-panel__label">Built ({ground})</div>
          <div className="gal-panel oc-app" data-theme={ground}>
            <div className="gal-panel__body">{spec.states.map((st, i) => <div key={i} className="gal-compare__state">{spec.frame ? <ScaledFrame {...spec.frame}>{st.render()}</ScaledFrame> : st.render()}</div>)}</div>
          </div>
        </div>
        <div>
          <div className="gal-panel__label">Reference: {src.file}{src.anchor ? ` #${src.anchor}` : ""}</div>
          <iframe className="gal-compare__ref" title="Reference frame" src={refHref(src)} />
        </div>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div className="gal-home">
      <h1 className="oc-t-heading">The Opencast gallery</h1>
      <p className="oc-muted">
        Every component in @opencast/ui, in every state, on both grounds, with the reference frame it comes from. {ALL.length} components.
      </p>
      {GROUPS.map((g) => (
        <section key={g} className="gal-home__group">
          <h2 className="oc-t-section">
            <Link to={`/group/${g.toLowerCase()}`}>{g}</Link>
          </h2>
          <ul>
            {ALL.filter((s) => s.group === g).map((s) => (
              <li key={s.id}>
                <Link to={`/${s.id}`}>{s.name}</Link> <span className="oc-quiet">{s.states.length} states</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GroundSwitch() {
  const { choice, setChoice } = useGround();
  const options: GroundChoice[] = ["system", "dark", "light"];
  return (
    <label className="gal-ground">
      <span className="oc-quiet">Page ground</span>
      <select value={choice} onChange={(e) => setChoice(e.target.value as GroundChoice)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "system" ? "System" : o === "dark" ? "Dark" : "Light"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function App() {
  return (
    <div className="gal">
      <nav className="gal-nav" aria-label="Components">
        <Link to="/" className="gal-nav__brand">
          <Lockup size="phone" /> <span className="oc-quiet">gallery</span>
        </Link>
        <GroundSwitch />
        {GROUPS.map((g) => (
          <div key={g} className="gal-nav__group">
            <NavLink to={`/group/${g.toLowerCase()}`} className="gal-nav__g">
              {g}
            </NavLink>
            {ALL.filter((s) => s.group === g).map((s) => (
              <NavLink key={s.id} to={`/${s.id}`}>
                {s.name}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <main className="gal-main">
        <Routes>
          <Route index element={<Home />} />
          <Route path="group/:group" element={<GroupPage />} />
          <Route path=":id" element={<SpecimenPage />} />
          <Route path=":id/compare" element={<ComparePage />} />
        </Routes>
      </main>
    </div>
  );
}
