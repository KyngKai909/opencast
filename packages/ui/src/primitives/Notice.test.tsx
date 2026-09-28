import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Notice } from "./Notice";

afterEach(cleanup);

describe("Notice", () => {
  it("a standby notice says it needs attention in words", () => {
    render(<Notice title="Dead air from 11:40 pm to 2:00 am.">2 hr 20 min with nothing scheduled.</Notice>);
    expect(screen.getByText("Needs attention.")).toBeTruthy();
    cleanup();
    render(<Notice tone="plain">A station needs at least one program.</Notice>);
    expect(screen.queryByText("Needs attention.")).toBeNull();
  });
});
