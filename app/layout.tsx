import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dock",
  description: "Move files and text between your devices.",
  appleWebApp: {
    capable: true,
    title: "Dock",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#101314",
};

// Starts the list request the moment the HTML arrives, instead of waiting for
// the JavaScript to download, parse and hydrate first. By the time the page's
// code is ready the answer is usually already here and it just picks it up
// (see `takeEarlyBootstrap` in app/page.tsx). Only runs on the home page, and
// the window it asks for (start of yesterday, device time) must match
// `startOfYesterday` in lib/window.ts.
const EARLY_BOOTSTRAP = `(function(){try{if(location.pathname!=="/")return;var d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-1);window.__dockBoot=fetch("/api/bootstrap?since="+encodeURIComponent(d.toISOString()),{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_BOOTSTRAP }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
