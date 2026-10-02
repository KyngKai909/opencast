const QUESTIONS: ReadonlyArray<[string, string]> = [
  ["Is it free to watch?", "Yes. Stations are supported by local spots, underwriting and pledges from viewers who want to support them."],
  ["Does it cost anything to run a station?", "No. The software is free and open source. Stations can earn from spots in their breaks and from pledges."],
  ["Can I keep streaming to YouTube and Twitch?", "Yes. Master control relays your station to other services, and you choose whether each one airs your spots or a station ID slate in the breaks."],
  ["What can I put on air?", "Anything you made, anything you have the owner's permission to air, and anything in the public domain. Every item's rights are confirmed before it airs."],
  ["Why channel numbers?", "Because a dial you can learn is easier than a feed you have to search. Each market has a limited set of numbers, and stations keep theirs."],
  ["Is Opencast the final name?", "Not yet. It's the working name while we build."]
];

/** S.12: questions, ruled, each one opening in place. */
export function Faq() {
  return (
    <section className="st-s" id="faq">
      <div className="st-wrap">
        <h2 className="st-h">Questions.</h2>
        <div className="st-faq">
          {QUESTIONS.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
