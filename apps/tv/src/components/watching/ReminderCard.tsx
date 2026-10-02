// The reminder card (tv 03 note): at a reminded program's start it slides in over whatever's on.
// OK switches; Back waves it away. The picture and the remote keep working underneath.

import { Kbd } from "@opencast/ui";
import "./ReminderCard.css";

export function ReminderCard({ text }: { text: string }) {
  return (
    <div className="tvw-remind" role="status" aria-live="polite">
      <p className="tvw-remind__what">{text}</p>
      <p className="tvw-remind__ok">
        <Kbd size="tv">OK</Kbd>to switch.
      </p>
    </div>
  );
}
