import { Lockup } from "@opencast/ui";
import { REPO_URL } from "../lib/links";

/** S.13: the footer. Two columns under 760px. */
export function SiteFooter() {
  return (
    <footer className="st-foot">
      <div className="st-wrap">
        <div className="st-foot__grid">
          <div>
            <a className="st-brand" href="#top" aria-label="Opencast, top of page"><Lockup size="site" /></a>
            <p className="st-foot__line">Television, run by your neighbors. Starting in the Inland Empire, California.</p>
          </div>
          <div>
            <h4>Watch</h4>
            <ul>
              <li><a href="#dial">The dial</a></li>
              <li><a href="#remote">On your TV</a></li>
              <li><a href="#join">Waitlist</a></li>
            </ul>
          </div>
          <div>
            <h4>Broadcast</h4>
            <ul>
              <li><a href="#stations">Run a station</a></li>
              <li><a href="#producers">For producers</a></li>
              <li><a href="#businesses">For businesses</a></li>
              <li><a href="#money">How the money works</a></li>
            </ul>
          </div>
          <div>
            <h4>Opencast</h4>
            <ul>
              <li><a href={REPO_URL}>Source code</a></li>
              <li><a href="https://claude.ai/artifact/NMRzW6vzYFf5onCSpBNA6g">Brand and style guide</a></li>
              <li><a href="#faq">Questions</a></li>
            </ul>
          </div>
        </div>
        <p className="st-fine-print">Stations and programs shown are illustrations. Opencast is a working name. Revenue sharing is described to show how the model is intended to work and is not an offer or a promise of earnings.</p>
      </div>
    </footer>
  );
}
