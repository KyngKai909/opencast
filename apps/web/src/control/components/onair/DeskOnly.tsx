// A246 (Phase 4, opencast-schedule 08): on the phone, small fixes work (fill a gap, sign off, move a
// program) and building templates, blocks and break rules is desk work. Those tabs say so plainly,
// with the way back to the Log.

import { Button } from "@opencast/ui";
import { scheduleHref } from "./scheduleRoutes";

export function DeskOnly({ what, base }: { what: "Templates" | "Blocks" | "Break rules"; base: string }) {
  return (
    <section className="cc-deskonly" aria-labelledby="cc-deskonly-h">
      <h2 id="cc-deskonly-h" className="cc-deskonly__h">
        Open {what} on a computer
      </h2>
      <p className="cc-deskonly__p">Templates, blocks and break rules are desk work. On the phone, check tonight, fill dead air, sign off and move a program on the Log.</p>
      <Button variant="primary" href={scheduleHref(base)}>
        Back to the Log
      </Button>
    </section>
  );
}
