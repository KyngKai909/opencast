// The Network desk area (/desk), loaded on its own when someone opens it. Opencast's own internal
// tool: never indexed (the page says so while it's open; vercel.json sends X-Robots-Tag for /desk).

import { useEffect } from "react";
import { AppRoutes } from "./routes";

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const title = document.title;
    document.title = "Network desk";
    return () => {
      meta.remove();
      document.title = title;
    };
  }, []);
}

export default function DeskArea() {
  useNoIndex();
  return <AppRoutes />;
}
