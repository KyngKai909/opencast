import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ShellSteps } from "./ShellSteps";
import { CONTROL_SETUP_STEPS } from "./ControlSetupShell";

afterEach(cleanup);

describe("ShellSteps", () => {
  it("shows steps before the current one as done, the current one, and the rest to come", () => {
    const { container } = render(<ShellSteps steps={[...CONTROL_SETUP_STEPS]} current={3} hint="Each step saves as you go." />);
    const items = [...container.querySelectorAll("li")];
    expect(items.map((li) => li.className.match(/--(\w+)/)?.[1])).toEqual(["done", "done", "current", "next", "next"]);
    expect(items[2].getAttribute("aria-current")).toBe("step");
    expect(items[0].textContent).toBe("Your station, done");
    expect(items[0].querySelector("svg")).not.toBeNull();
    expect(items[3].textContent).toBe("4Translators");
    expect(screen.getByText("Each step saves as you go.")).toBeTruthy();
  });
});
