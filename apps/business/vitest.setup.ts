import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Vitest runs without globals, so testing-library can't clean up by itself: unmount after each test.
afterEach(() => cleanup());

// findBy and waitFor give up after 1 s by default. A page on the mocks can take longer than that to
// load on GitHub's runners (Mock Service Worker walks every handler for each request), so they
// wait up to 5 s: a real failure still fails, only later.
configure({ asyncUtilTimeout: 5000 });
