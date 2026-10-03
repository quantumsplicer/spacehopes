import type { Metadata } from "next";
import "./studio.css";

export const metadata: Metadata = { title: { default: "Studio", template: "%s · Studio" }, robots: { index: false, follow: false } };

export default function StudioRoot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
