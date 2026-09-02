"use client";

import { useState } from "react";

interface Props {
  onAdd: (text: string) => void;
}

export default function TextComposer({ onAdd }: Props) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  }

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        placeholder="Paste or type text to send across"
        rows={3}
        className="w-full resize-none bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-faint">Ctrl/Cmd + Enter to add</span>
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="rounded-sm bg-surfaceRaised px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-borderStrong disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add text
        </button>
      </div>
    </div>
  );
}
