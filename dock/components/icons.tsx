import { ItemKind } from "@/lib/types";

const common = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ImageIcon() {
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5.5-5.5a2 2 0 0 0-2.8 0L3 20" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg {...common}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 15.5v-3h1.3a1.5 1.5 0 0 1 0 3H9z" />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg {...common}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M10 3v3M13 6v3M10 9v3M13 12v3" />
      <rect x="9.5" y="14.5" width="3.5" height="4" rx="0.5" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg {...common}>
      <path d="M6 4h12M6 9h12M6 14h8M6 19h5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg {...common}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function KindIcon({ kind }: { kind: ItemKind }) {
  switch (kind) {
    case "image":
      return <ImageIcon />;
    case "pdf":
      return <PdfIcon />;
    case "zip":
      return <ZipIcon />;
    case "text":
      return <TextIcon />;
    default:
      return <FileIcon />;
  }
}
