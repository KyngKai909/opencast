import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest runs without globals, so testing-library can't clean up by itself: unmount after each test.
afterEach(() => cleanup());
