import type { Metadata } from "next";
import { getSettings } from "@/lib/api";
import { Glow, RiseWords } from "@/components/site/Motion";

export const metadata: Metadata = { title: "About" };

/** Just the quote and the author's name beneath it. */
export default async function About() {
  const s = await getSettings();
  const last = s.about_quote.trim().split(/\s+/).pop() ?? "";
  const em = s.about_quote.toLowerCase().includes("thinker") ? "thinker" : last.replace(/[.,!?]/g, "");
  return (
    <Glow className="about">
      <div className="container-page">
        <p style={{ color: "var(--teal)", fontSize: 14, fontWeight: 600 }}>About</p>
        <h1 className="quote" aria-label={s.about_quote}><span aria-hidden><RiseWords text={s.about_quote} em={em} /></span></h1>
        {s.about_byline && <p className="byline rise" style={{ animationDelay: "900ms" }}>{s.about_byline}</p>}
      </div>
    </Glow>
  );
}
