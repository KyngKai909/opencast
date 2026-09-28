import { useEffect } from "react";
import { useNavigate } from "react-router";

/**
 * The ui shells draw plain `<a href>` (they don't know the router). Same-origin clicks navigate
 * inside the app instead of reloading it (which would drop a live studio's camera).
 */
export function useInAppLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.origin !== window.location.origin) return;
      e.preventDefault();
      navigate(a.pathname + a.search + a.hash);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);
}
