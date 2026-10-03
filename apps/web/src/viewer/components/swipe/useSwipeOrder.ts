// The swipe's order for this viewer (swipe home 08, "Order"), from the market's dial and the
// viewer's presets, per band. The swipe, the guide and the player (setOrder, on the phone and
// tablet app only) all take it from here.

import { useEffect, useMemo } from "react";
import { orderIds, swipeOrder, usePlayer, type SwipeOrder } from "@opencast/player";
import type { DialRowX } from "../../api/ext";
import { useChannels, usePresets } from "../../data/viewer";
import { presetIdsInOrder } from "./rules";

export interface SwipeOrders {
  tv: SwipeOrder<DialRowX>;
  radio: SwipeOrder<DialRowX>;
}

export function useSwipeOrders(): SwipeOrders {
  const channels = useChannels();
  const { presets } = usePresets();
  return useMemo(() => {
    const ids = presetIdsInOrder(presets);
    return { tv: swipeOrder(channels, ids, "tv"), radio: swipeOrder(channels, ids, "radio") };
  }, [channels, presets]);
}

/** The order the player's channel up and down follow: the swipe's on the phone and tablet, channel order elsewhere. */
export function OrderSync({ on }: { on: boolean }) {
  const [, engine] = usePlayer();
  const orders = useSwipeOrders();
  useEffect(() => {
    engine.setOrder(on ? [orderIds(orders.tv), orderIds(orders.radio)] : null);
  }, [engine, on, orders]);
  useEffect(() => () => engine.setOrder(null), [engine]);
  return null;
}
