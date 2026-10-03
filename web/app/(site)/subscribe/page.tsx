import type { Metadata } from "next";
import SubscribeBox from "@/components/site/SubscribeBox";

export const metadata: Metadata = { title: "Subscribe" };

export default function Subscribe() {
  return (
    <div className="container-page" style={{ paddingTop: "clamp(48px, 8vw, 110px)", maxWidth: 640 }}>
      <h1 className="page-h1 rise">Get new posts <em>by email.</em></h1>
      <p className="page-intro">One email for each new thought or blog. Nothing else. You confirm your address first, and every email has an unsubscribe link.</p>
      <div style={{ marginTop: 32 }}><SubscribeBox heading="Your email" /></div>
    </div>
  );
}
