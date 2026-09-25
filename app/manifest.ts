import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dock",
    short_name: "Dock",
    description: "Move files and text between your devices.",
    start_url: "/",
    display: "standalone",
    background_color: "#101314",
    theme_color: "#101314",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
