"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cfetch } from "@/lib/api";
import type { Card } from "@/lib/types";
import { fmtDate, plural, timeAgo } from "@/lib/format";
import { Arrow, ArrowDown } from "@/components/Icons";
import { toast } from "@/lib/client";
import { Glow, RiseWords } from "./Motion";

export default function Hero({ latest }: { latest: Card | null }) {
  const [card, setCard] = useState<Card | null>(latest);
  const [ago, setAgo] = useState("");
  const [k, setK] = useState(0);
  const [seen, setSeen] = useState<number[]>(latest ? [latest.id] : []);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAgo(timeAgo(latest?.published_at)), [latest]);

  async function surprise() {
    if (busy) return;
    setBusy(true);
    try {
      // ask for a thought we have not shown yet; the server starts a new round when all have been seen
      const r = await fetch(`/api/v1/thoughts/random?exclude=${seen.join(",")}&t=${Date.now()}`, { cache: "no-store" });
      if (r.status === 404) toast("There are no thoughts to show yet. Please check back soon.");
      else if (!r.ok) toast(`Could not load another thought (error ${r.status}). Please try again.`);
      else {
        const c = (await r.json()) as Card;
        if (card && c.id === card.id) toast("That is the only thought so far. More are on the way.");
        else { setCard(c); setSeen((x) => [...x.filter((i) => i !== c.id), c.id].slice(-50)); setK((x) => x + 1); }
      }
    } catch {
      toast("Could not reach the site. Check your connection and try again.");
    }
    setBusy(false);
  }
  function start(e: React.MouseEvent) {
    e.preventDefault();
    const el = document.getElementById("feed");
    el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    el?.focus({ preventScroll: true });
  }

  return (
    <Glow className="hero">
      <div className="container-page hero-grid">
        <div className="hero-copy">
          {latest && <div className="badge fade"><span className="dot" aria-hidden />New thought{ago ? `, ${ago}` : ""}</div>}
          <h1 aria-label="Hopes, given space.">
            <span aria-hidden>
              <RiseWords text="Hopes, given" start={100} /><br />
              <RiseWords text="space." em="space" start={340} />
            </span>
          </h1>
          <p className="intro rise" style={{ animationDelay: "560ms" }}>Short thoughts and longer essays on the things worth hoping for, written slowly. Read them, and leave your own thoughts beside them.</p>
          <div className="cta rise" style={{ animationDelay: "700ms" }}>
            <a href="#feed" onClick={start} className="btn btn-ink btn-lg">Start reading <ArrowDown width={16} height={16} /></a>
            <button type="button" onClick={surprise} className="btn btn-ghost btn-lg" disabled={busy} aria-busy={busy}>{busy ? "Finding one…" : "Surprise me"}</button>
          </div>
        </div>
        {card && (
          <div className="floaty rise" style={{ animationDelay: "500ms" }}>
            <aside className={`float-card ${k > 0 ? "swap" : ""}`} key={k} aria-label="The latest thought" aria-live="polite">
              <p className="label"><span>{k === 0 ? "The latest thought" : "A thought from the archive"}</span><span>{fmtDate(card.published_at)}</span></p>
              <blockquote>{card.text}</blockquote>
              <div className="foot">
                <span>{plural(card.comment_count, "comment")}</span>
                <Link href={`/t/${card.id}`}>Read <Arrow width={15} height={15} /></Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </Glow>
  );
}
