import type { Metadata, Viewport } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const serif = Source_Serif_4({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-serif", display: "swap" });
const sans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });

const base = process.env.PUBLIC_URL || "http://localhost:8080";

export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: { default: "Space hopes", template: "%s · Space hopes" },
  description: "Short thoughts and longer essays from Saravanan Murugan, IAS, written slowly and shared openly.",
  alternates: { types: { "application/rss+xml": "/rss.xml" } },
  openGraph: { siteName: "Space hopes", type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // opt in to per-request rendering so the CSP nonce set in middleware reaches Next's scripts
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
