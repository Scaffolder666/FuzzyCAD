"use client";

import { useState } from "react";

type HandleValueInputProps = {
  valueMm: number;
  onCommit: (valueMm: number) => void;
  className: string;
};

/** Editable numeric readout for a drag handle — type an exact mm value instead of only dragging. */
export default function HandleValueInput({
  valueMm,
  onCommit,
  className,
}: HandleValueInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    const parsed = parseFloat(draft ?? "");

    if (!Number.isNaN(parsed)) {
      onCommit(parsed);
    }

    setDraft(null);
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.1"
      className={className}
      value={draft ?? valueMm.toFixed(1)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }

        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
