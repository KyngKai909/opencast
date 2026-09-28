// "Clear" with its ring (the reference's .clear-tag): where a funding source is Clear's.

import "./ClearTag.css";

export function ClearTag({ word = true }: { word?: boolean }) {
  return (
    <span className="bz-clear-tag">
      <i aria-hidden="true" />
      {word && "Clear"}
    </span>
  );
}
