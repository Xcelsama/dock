import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dock",
  description: "Move files and text between your devices.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
