const staticAsset = (source) => ({
  source,
  headers: [
    // Icons aren't fingerprinted, so let browsers reuse them for a day and
    // refresh quietly in the background for a week after that.
    { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      staticAsset("/icon-192.png"),
      staticAsset("/icon-512.png"),
      staticAsset("/icon.png"),
      staticAsset("/apple-icon.png"),
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The pairing code lives in the URL for a moment; never leak it as a referrer.
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
