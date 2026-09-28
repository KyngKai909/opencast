// What the player's modals and the station preview share: opening and closing an overlay by its
// search params (so Esc and Back return to exactly where you were), a Modal on the web and a
// Sheet on the phone with the same content, and reads cached apart from other screens' reads.

import { useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Modal, Sheet } from "@opencast/ui";
import type { EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { call, type CallArgs } from "../../api/client";
import { keyFor } from "../../api/hooks";
import { useIsPhone } from "../../layout/shell";

/** Opens an overlay over the current page, or closes one, by its search params. */
export function useOverlayParams() {
  const [params, setParams] = useSearchParams();
  const open = useCallback(
    (set: Record<string, string>, drop: string[] = []) =>
      setParams((p) => {
        for (const k of drop) p.delete(k);
        for (const [k, v] of Object.entries(set)) p.set(k, v);
        return p;
      }),
    [setParams]
  );
  const close = useCallback(
    (keys: string[]) =>
      setParams(
        (p) => {
          for (const k of keys) p.delete(k);
          return p;
        },
        { replace: true }
      ),
    [setParams]
  );
  return { params, open, close };
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  stationBand?: ReactNode;
  label?: string;
  footer?: ReactNode;
  footStacked?: boolean;
  /** Web width in px. */
  width?: number;
  /** Phone: dragging the sheet up. */
  onExpand?: () => void;
  /** The head's close button (web). Off when the station band carries its own. */
  showClose?: boolean;
  className?: string;
  children?: ReactNode;
}

/** A Modal on the web, a Sheet on the phone: the same content and buttons. */
export function Dialog({ width, onExpand, showClose, ...rest }: DialogProps) {
  const phone = useIsPhone();
  return phone ? <Sheet {...rest} onExpand={onExpand} /> : <Modal {...rest} width={width} showClose={showClose} />;
}

/**
 * Reads an endpoint with an extended schema, cached under its own key: another screen reading
 * the same endpoint with its own extension can't strip these fields out of the shared cache.
 */
export function useApiAs<E extends EndpointDef, S extends z.ZodType>(tag: string, endpoint: E, args: CallArgs, schema: S, enabled = true) {
  return useQuery<z.infer<S>>({ queryKey: [tag, ...keyFor(endpoint, args)], queryFn: () => call(endpoint, args, schema), enabled });
}
