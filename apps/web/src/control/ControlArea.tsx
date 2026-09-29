// The master control area (/control), loaded on its own when someone opens it: its shells' page
// options and its routes (routes.tsx).

import { useEffect } from "react";
import { ShellOptionsProvider } from "./layout/shell";
import { AppRoutes } from "./routes";

export default function ControlArea() {
  useEffect(() => {
    const title = document.title;
    document.title = "Master control · Opencast";
    return () => {
      document.title = title;
    };
  }, []);
  return (
    <ShellOptionsProvider>
      <AppRoutes />
    </ShellOptionsProvider>
  );
}
