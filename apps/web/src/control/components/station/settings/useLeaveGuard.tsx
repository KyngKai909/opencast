// A246: a warning before leaving a page with unsaved changes (Break rules' draft). The app's router
// is a BrowserRouter, which can't block navigation, so this catches the ways out it can: closing
// or reloading the tab (the browser's own prompt), a link anywhere on the page (the rail, a
// tab's link), and the page's own navigations (`go`, which the Schedule's tabs call). Each asks
// "Leave without saving?"; leaving drops the changes. The browser's Back button isn't caught.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Modal } from "@opencast/ui";

export interface LeaveGuard {
  /** Go somewhere in the app, asking first while there are unsaved changes. */
  go(to: string): void;
  /** The question, while it's asked (render it). */
  dialog: React.ReactNode;
}

export function useLeaveGuard(dirty: boolean, discard: () => void, words: { title: string; subtitle: string }): LeaveGuard {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a value to show their prompt.
      e.returnValue = "";
    };
    // Capture: before the router's own link handler runs.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const go = useCallback((to: string) => (dirty ? setPending(to) : navigate(to)), [dirty, navigate]);

  const dialog = pending ? (
    <Modal
      open
      onClose={() => setPending(null)}
      width={420}
      title={words.title}
      subtitle={words.subtitle}
      footer={
        <>
          <Button onClick={() => setPending(null)}>Keep editing</Button>
          <Button
            variant="primary"
            onClick={() => {
              const to = pending;
              setPending(null);
              discard();
              navigate(to);
            }}
          >
            Leave without saving
          </Button>
        </>
      }
    />
  ) : null;

  return { go, dialog };
}
