import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { fileSize, UploadList, uploadStatusWords } from "./UploadList";
import type { UploadItem } from "./useDirectUpload";

const item = (o: Partial<UploadItem>): UploadItem => ({ id: "f1", name: "Night shift, ep. 4.mp4", bytes: 4_200_000_000, sent: 1_890_000_000, status: "uploading", error: null, retryable: false, upload: null, ...o });

describe("the upload list", () => {
  it("says where each file is", () => {
    expect(uploadStatusWords(item({}))).toBe("Uploading, 45%");
    expect(uploadStatusWords(item({ status: "paused" }))).toBe("Paused at 45%");
    expect(uploadStatusWords(item({ status: "checking", sent: 4_200_000_000 }))).toBe("Checking");
    expect(uploadStatusWords(item({ status: "preparing" }))).toBe("Preparing for air");
    expect(uploadStatusWords(item({ status: "preparing" }), "Checked")).toBe("Checked");
    expect(uploadStatusWords(item({ status: "failed", error: "That file can't be read as video or audio." }))).toBe("That file can't be read as video or audio.");
    expect(uploadStatusWords(item({ status: "choose_again" }))).toBe("Stopped at 45%. Choose the file again to carry on.");
    expect([fileSize(4_200_000_000), fileSize(21_000_000), fileSize(2048), fileSize(12_000_000_000)]).toEqual(["4.2 GB", "21 MB", "2 KB", "12 GB"]);
  });

  it("shows progress, with Pause, Resume, Retry and Cancel as they apply", () => {
    const on = { onPause: vi.fn(), onResume: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn() };
    const { rerender } = render(<UploadList items={[item({})]} label="Uploading to the library" {...on} />);
    const list = screen.getByRole("list", { name: "Uploading to the library" });
    expect(within(list).getByRole("progressbar", { name: "Night shift, ep. 4.mp4, uploaded" }).getAttribute("aria-valuenow")).toBe("45");
    fireEvent.click(within(list).getByRole("button", { name: "Pause Night shift, ep. 4.mp4" }));
    expect(on.onPause).toHaveBeenCalledWith("f1");
    rerender(<UploadList items={[item({ status: "paused" })]} {...on} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume Night shift, ep. 4.mp4" }));
    expect(on.onResume).toHaveBeenCalledWith("f1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel Night shift, ep. 4.mp4" }));
    expect(on.onRemove).toHaveBeenCalledWith("f1");
    rerender(<UploadList items={[item({ status: "failed", retryable: true, error: "The connection dropped. Retry to carry on from where it stopped." })]} {...on} />);
    expect(screen.getByRole("alert").textContent).toBe("The connection dropped. Retry to carry on from where it stopped.");
    fireEvent.click(screen.getByRole("button", { name: "Retry Night shift, ep. 4.mp4" }));
    expect(on.onRetry).toHaveBeenCalledWith("f1");
    rerender(<UploadList items={[]} {...on} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
