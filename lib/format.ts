export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exp);
  const precision = exp === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[exp]}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function kindFromFile(file: File): "image" | "pdf" | "zip" | "file" {
  const type = file.type;
  const name = file.name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    name.endsWith(".zip")
  ) {
    return "zip";
  }
  return "file";
}
