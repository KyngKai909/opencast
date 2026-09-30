// The station account's banner (pay-as-you-go, follow-up Phase 2): on the Monitor and Earnings while
// the station is in its grace period or paused, linking to Settings, Station account. Owners and
// operators (who see the account); nothing while it's ok. The channel is never paused, and the
// banner says so.

import { Button, Notice } from "@opencast/ui";
import { useStation } from "../../station/StationContext";
import { useStationAccount } from "./UsageAccount";
import { bannerWords } from "./usage";

export function AccountBanner({ className }: { className?: string }) {
  const s = useStation();
  const q = useStationAccount(s.id, s.can("seeMoney"));
  const words = q.data ? bannerWords(q.data) : null;
  if (!words) return null;
  return (
    <Notice
      className={className}
      title={words.title}
      detail={words.detail}
      action={
        <Button size="sm" href={`${s.base}/settings/account`}>
          Station account
        </Button>
      }
    />
  );
}
