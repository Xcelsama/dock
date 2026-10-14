"use client";

import { useRef } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  /** True while something is being dragged over the page (the page owns drop handling). */
  active: boolean;
}

// Click-to-choose area. Dropping and pasting are handled page-wide (see
// app/page.tsx), so a file landing anywhere works, not just in this box.
export default function Dropzone({ onFiles, active }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      className={`group cursor-pointer rounded-md border border-dashed px-6 py-10 text-center transition-colors ${
        active ? "border-accent bg-accent/5" : "border-border hover:border-borderStrong"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <p className="text-sm text-ink">
        Drop or paste files anywhere, or{" "}
        <span className="text-accent underline underline-offset-2">choose from your device</span>
      </p>
      <p className="mt-1 text-xs text-faint">Screenshots, images, PDFs, zips, or anything else</p>
    </div>
  );
}
