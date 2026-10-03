import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "@/components/Icons";

export const metadata: Metadata = { title: "Subscription", robots: { index: false } };

export default async function Subscribed({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const msg = ok === "1" ? ["You are subscribed.", "Thank you for confirming. You will get one email for each new post."]
    : ok === "2" ? ["You are unsubscribed.", "No more emails. You are welcome back any time."]
    : ["That link did not work.", "It may have expired. You can subscribe again from the home page."];
  return (
    <div className="container-page" style={{ paddingTop: 96, maxWidth: 640, textAlign: "center" }}>
      <div className="sent-big">
        {ok !== "0" && ok ? <span className="tick"><Check width={34} height={34} /></span> : null}
        <h2>{msg[0]}</h2>
        <p style={{ color: "var(--ink-2)", marginTop: 12 }}>{msg[1]}</p>
        <Link href="/" className="btn btn-ghost" style={{ marginTop: 28 }}>Back to the notebook</Link>
      </div>
    </div>
  );
}
