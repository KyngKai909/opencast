// The page's static sections, S.01 to S.09, in the reference's words.

import type { ReactNode } from "react";
import { Button } from "@opencast/ui";
import { REPO_URL } from "../lib/links";
import { Tuner } from "./Tuner";

function Section({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `st-s ${className}` : "st-s"} id={id}>
      <div className="st-wrap">{children}</div>
    </section>
  );
}

function Points({ items, cols = 4 }: { items: ReadonlyArray<[string, string]>; cols?: 3 | 4 }) {
  return (
    <div className={cols === 4 ? "st-cols4" : "st-cols3"}>
      {items.map(([h, p]) => (
        <div className="st-pt" key={h}>
          <h3>{h}</h3>
          <p>{p}</p>
        </div>
      ))}
    </div>
  );
}

/** S.01 */
export function Hero() {
  return (
    <section className="st-hero">
      <div className="st-wrap st-hero__grid">
        <div>
          <h1>Television, run by your neighbors.</h1>
          <p className="st-hero__lede">Opencast is a dial of 24/7 stations run by people and groups where you live. Tune in, cast it to the TV and flip channels with your phone. Or start a station of your own.</p>
          <div className="st-acts">
            <Button variant="primary" href="#join" className="st-btn">Join the waitlist</Button>
            <Button variant="ghost" href="#stations" className="st-btn">Reserve a channel</Button>
          </div>
          <p className="st-hero__where">Starting in the Inland Empire, California.</p>
        </div>
        <Tuner />
      </div>
    </section>
  );
}

/** S.02 */
export function DialSection() {
  return (
    <Section id="dial">
      <h2 className="st-h">A dial, not a feed.</h2>
      <p className="st-lede">Streaming apps hand you an endless grid and ask you to choose. Opencast works the way TV did: something is always on, the stations are always in the same place, and you change channel until something catches you.</p>
      <div className="st-versus">
        <div>
          <h4>Opencast</h4>
          <div className="st-vrow"><span className="oc-mono">7.1</span>Your town hall, live</div>
          <div className="st-vrow"><span className="oc-mono">12.1</span>A local beat show, then cartoons from 1928</div>
          <div className="st-vrow"><span className="oc-mono">88.3</span>Radio dramas until 6:00 am</div>
        </div>
        <div className="st-versus__feed">
          <h4>A feed</h4>
          <div className="st-vrow"><span className="oc-mono">1</span>Recommended for you</div>
          <div className="st-vrow"><span className="oc-mono">2</span>Because you watched something once</div>
          <div className="st-vrow"><span className="oc-mono">3</span>Trending, somewhere</div>
        </div>
      </div>
      <Points
        items={[
          ["Ordered by channel", "Your market's stations sit in channel order, the same every time, so you learn where things are."],
          ["Live and local first", "Something happening near you right now always comes before anything else."],
          ["You join where it is", "Tuning in lands mid-program, like a real station. No scrubbing, no restarting."],
          ["No scores", "No view counts, star ratings or trending lists. A station is judged by its schedule."]
        ]}
      />
    </Section>
  );
}

/** S.03 */
export function RemoteSection() {
  return (
    <Section id="remote">
      <h2 className="st-h">Your phone is the remote.</h2>
      <div className="st-remote">
        <div>
          <p className="st-lede st-lede--tight">Cast it to the TV, then flip channels with your thumb. Choosing is tiring. Changing channel isn't.</p>
          <p className="st-remote__p">Put Opencast on the TV and your phone turns into a remote: channel up and down, a keypad for 12.1, a guide and six presets. On a TV with the Opencast app, the TV's own remote does the same.</p>
          <p className="st-remote__p">It opens on the last channel you watched. There's no home screen to get past.</p>
        </div>
        <div className="st-devices">
          <div className="st-dv"><span>Chromecast and Google TV</span><span>Cast from your phone</span></div>
          <div className="st-dv"><span>Android TV, Fire TV</span><span>Opencast app, with the TV remote</span></div>
          <div className="st-dv"><span>Apple TV and AirPlay TVs</span><span>Mirror from the iPhone app</span></div>
          <div className="st-dv"><span>Phone, tablet, computer</span><span>Watch anywhere</span></div>
          <div className="st-dv"><span>Roku</span><span className="oc-quiet">Later</span></div>
        </div>
      </div>
    </Section>
  );
}

/** S.04 */
export function StationsSection() {
  const steps: ReadonlyArray<[string, string]> = [
    ["Claim a channel", "Pick a call sign and a number on your market's dial. Numbers are limited per market, like the real thing."],
    ["Fill your library", "Upload shows, spots, bumpers and a station ID. They're prepared for air automatically."],
    ["Build the log", "Lay out the day to the second. Breaks are placed for you, and gaps are flagged before they reach air."],
    ["Sign on", "Your station goes on the dial and stays on around the clock, with live shows switched in when they start."]
  ];
  return (
    <Section id="stations">
      <h2 className="st-h">Run a station, not a channel.</h2>
      <p className="st-lede">YouTube made everyone a creator. Opencast makes everyone a station. You program a schedule, air your own shows and other stations' programs, choose the commercials in your breaks, and keep relaying to YouTube and Twitch if you like.</p>
      <ol className="st-steps">
        {steps.map(([b, t], i) => (
          <li key={b}>
            <span className="st-steps__n">{String(i + 1).padStart(2, "0")}</span>
            <b>{b}</b>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      <h3 className="st-sub-h">Carry each other's programs</h3>
      <p className="st-carry">
        Any program can be offered to other stations, the way PBS stations share programming. A small station can fill 24 hours; a good program can travel. The station that makes it sets the terms (<a href="#producers" className="st-link">more for producers</a>):
      </p>
      <div className="st-terms">
        <div><h4>Barter</h4><p>No fee. Break time inside the program is shared between the station airing it and the one that made it.</p></div>
        <div><h4>Cash</h4><p>The airing station pays a set rate per airing and keeps all the break time.</p></div>
        <div><h4>Cash plus barter</h4><p>A lower rate, plus a share of the break time.</p></div>
      </div>
    </Section>
  );
}

/** S.05. "List your programs" chooses the producer role and goes to the waitlist. */
export function ProducersSection({ onListPrograms }: { onListPrograms(): void }) {
  const rows: ReadonlyArray<[string, string, string, string, string]> = [
    ["Sat 8:00 pm", "12.1", "Late Crate, on BEAT", "Made here", "Maker"],
    ["Nightly 3:00 am", "90.7", "Late Crate, on HALL", "Carried on barter terms", "Carrier"],
    ["Sun 11:00 pm", "18.1", "Late Crate, on SAZN", "Carried on barter terms", "Carrier"]
  ];
  return (
    <Section id="producers">
      <h2 className="st-h">Make it once. Air it everywhere.</h2>
      <p className="st-lede">The syndication market is where programs find stations. List a show with your terms, and stations across every market can pick it up to fill their nights. You don't need a station of your own to use it: studios and solo producers list programs the same way.</p>
      <div className="st-logstrip" role="group" aria-label="One program airing on three stations">
        {rows.map(([t, ch, what, sub, role]) => (
          <div className="st-lg st-lg--wide" key={t}>
            <span className="st-lg__t">{t}</span>
            <span className="st-lg__ch oc-mono">{ch}</span>
            <div>{what}<small>{sub}</small></div>
            <span className="st-lg__d">{role}</span>
          </div>
        ))}
      </div>
      <Points
        items={[
          ["You set the terms", "Barter, cash per airing, or both. How many airings, live or later, and whether you approve each station."],
          ["Paid by the airing", "Every airing on another station is recorded to the second, and your share settles from it."],
          ["Your name stays on it", "Every station airing your program credits you, and viewers can follow it back to you."],
          ["Rights kept clean", "What you list has its rights confirmed once, so every station carrying it stands on the same record."]
        ]}
      />
      <div className="st-acts st-acts--after">
        <Button variant="primary" href="#join" className="st-btn" data-role="producer" onClick={onListPrograms}>List your programs</Button>
        <Button variant="ghost" href="#stations" className="st-btn">Or run a station</Button>
      </div>
    </Section>
  );
}

/** S.06 */
export function BusinessesSection() {
  const rows: ReadonlyArray<[string, "SPT" | "UND" | "SID", string, string, string]> = [
    ["8:28:30", "SPT", "Orange Street Coffee", "Spot, a code on screen for 10% off", ":30"],
    ["8:29:00", "SPT", "Inland Tire and Wheel", "Spot", ":30"],
    ["8:29:30", "UND", "Made possible by members of Inland Beat", "Underwriting", ":15"],
    ["8:29:55", "SID", "BEAT 12.1, Redlands", "Station ID", ":05"]
  ];
  return (
    <Section id="businesses">
      <h2 className="st-h">Commercials, made here.</h2>
      <p className="st-lede">Local businesses list their spots with a rate. Stations choose which ones air in their breaks, so a coffee shop reaches the people who live near it, on a station those people chose. Opencast's own studio can make the spot for you.</p>
      <div className="st-logstrip" role="group" aria-label="A sample break on BEAT 12.1">
        {rows.map(([t, code, what, sub, d]) => (
          <div className="st-lg" key={t}>
            <span className="st-lg__t">{t}</span>
            <span><span className={`st-code st-code--${code.toLowerCase()}`}>{code}</span></span>
            <div>{what}<small>{sub}</small></div>
            <span className="st-lg__d">{d}</span>
          </div>
        ))}
      </div>
      <Points
        cols={3}
        items={[
          ["Stations choose", "Nothing airs on a station that the station didn't pick. Creators decide what their audience sees."],
          ["Pay how you like", "A rate per thousand people tuned in, or a flat rate per airing. Conversions come from a code or QR on screen."],
          ["Local first", "Filter by distance, so a spot runs where its customers are."]
        ]}
      />
    </Section>
  );
}

/** S.07 */
export function MoneySection() {
  return (
    <Section id="money">
      <h2 className="st-h">Shared, not skimmed.</h2>
      <p className="st-lede">The software is free and open. Opencast pays for itself with a share of spot revenue, and that share is split with the stations that make the platform worth watching.</p>
      <div className="st-split3">
        <div><h3>An equal base</h3><p>Every active station gets the same base share, whatever its size.</p></div>
        <div><h3>A share by watch time</h3><p>More goes to stations people actually spend time with, so better programming earns more.</p></div>
        <div><h3>A fund for new work</h3><p>A portion goes to a fund for new stations and new programs.</p></div>
      </div>
      <p className="st-note">Pledges from viewers go to the station. The exact split, and what makes a station active, will be published before launch. Nothing here is a promise of earnings.</p>
    </Section>
  );
}

/** The lineup's stations: the same as the tuner's, with the reference's categories. */
export const LINEUP: ReadonlyArray<{ channel: string; callSign: string; category: string; description: string; colour: string }> = [
  { channel: "7.1", callSign: "CIVC", category: "Public affairs", description: "Town halls, council meetings and questions from viewers", colour: "#2E6B5A" },
  { channel: "12.1", callSign: "BEAT", category: "Music", description: "Local producers, live sets and beat showcases", colour: "#8C3B7A" },
  { channel: "18.1", callSign: "SAZN", category: "Food", description: "Kitchens and cooks from around the region", colour: "#A3402A" },
  { channel: "24.1", callSign: "REEL", category: "Classic", description: "Cartoons, newsreels and films from the public domain", colour: "#9A5412" },
  { channel: "88.3", callSign: "NITE", category: "Radio band", description: "Old-time radio dramas, all night", colour: "#33507A" }
];

/** S.08. The call sign column goes under 600px. */
export function LocalSection() {
  return (
    <Section id="local">
      <h2 className="st-h">Starting in the Inland Empire.</h2>
      <p className="st-lede">The first dial is local on purpose: town halls and council meetings, the people making music and food here, and a lineup of classic public-domain programming to fill the nights. Here's the kind of lineup we're building toward.</p>
      <div className="st-lineup">
        {LINEUP.map((s) => (
          <div className="st-lu" key={s.callSign}>
            <span className="st-lu__ch oc-mono">{s.channel}</span>
            <span className="st-lu__cs oc-cs">{s.callSign}</span>
            <div>
              <b>{s.category}</b>
              <small>{s.description}</small>
            </div>
            <span className="st-lu__sw" style={{ background: s.colour }} aria-hidden="true" />
          </div>
        ))}
      </div>
      <p className="st-note">Stations shown are examples of what the dial could hold, not current stations.</p>
    </Section>
  );
}

/** S.09. The commands are the root package.json's: `npm run dev` starts the API, the worker and master control on :5173. */
export function OpenSection() {
  return (
    <Section id="open">
      <div className="st-open">
        <div>
          <h2 className="st-h">Open source, all of it.</h2>
          <p className="st-lede st-lede--open">The playout engine and master control are free to read, run and change today, and the viewer apps will be too. A station can run its own copy; the shared dial is what joins them up.</p>
          <Button variant="ghost" href={REPO_URL} className="st-btn">Read the code</Button>
        </div>
        <pre className="st-cli" tabIndex={0} role="region" aria-label="Run a station locally">
          <span className="st-cli__c"># run a station locally</span>
          {`\ngit clone ${REPO_URL}\nnpm install\nnpm run dev\n\n`}
          <span className="st-cli__c"># master control at localhost:5173</span>
          {"\n"}
          <span className="st-cli__c"># the playout worker loops your log to HLS,</span>
          {"\n"}
          <span className="st-cli__c"># and relays to Livepeer when you sign on</span>
        </pre>
      </div>
    </Section>
  );
}

/** S.10's left column. */
export function JoinIntro() {
  return (
    <div>
      <h2 className="st-h">Get on the dial.</h2>
      <p className="st-lede">Join the waitlist as a viewer, reserve a call sign for your station, list your programs for the syndication market, or list your business for the first spot market. We'll write when your market opens, and not before.</p>
    </div>
  );
}
