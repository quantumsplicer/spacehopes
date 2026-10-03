"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, post, setCsrf } from "@/lib/studio";
import { fmtDate } from "@/lib/format";

type Me = { authenticated: boolean; csrf: string; must_change: boolean; user: { id: number; login_id: string; email: string; name: string; role: "owner" | "editor" }; last_login_at: string | null; last_login_device: string | null };
type Ctx = { me: Me; waiting: number; refresh: () => void; siteName: string };
const C = createContext<Ctx | null>(null);
export const useStudio = () => useContext(C)!;

const I = (d: string) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const NAV = [
  { href: "/studio", label: "Overview", icon: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z" },
  { href: "/studio/posts", label: "Posts", icon: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" },
  { href: "/studio/drawings", label: "Drawings", icon: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" },
  { href: "/studio/media", label: "Media", icon: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4" },
  { href: "/studio/comments", label: "Comments", icon: "M4 5h16v11H9l-5 4z", badge: true },
  { href: "/studio/subscribers", label: "Subscribers", icon: "M3 6h18v12H3zM3 7l9 6 9-6" },
  { href: "/studio/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z" },
];
const TABS = [
  { href: "/studio", label: "Overview", icon: NAV[0].icon }, { href: "/studio/write", label: "Write", icon: "M4 20l4-1 11-11-3-3L5 16z" },
  { href: "/studio/comments", label: "Comments", icon: NAV[4].icon }, { href: "/studio/settings", label: "Settings", icon: NAV[6].icon },
];

export default function StudioShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [siteName, setSiteName] = useState("Space hopes");

  const refresh = useCallback(async () => {
    try {
      const d = await get<Me>("/auth/me");
      if (!d.authenticated) { router.replace("/studio/login"); return; }
      setCsrf(d.csrf); setMe(d);
      const c = await get<{ counts: { waiting: number } }>("/comments?status=waiting&limit=1");
      setWaiting(c.counts.waiting);
    } catch { router.replace("/studio/login"); }
  }, [router]);

  useEffect(() => { refresh(); get<{ site_name: string }>("/settings").then((s) => setSiteName(s.site_name)).catch(() => {}); }, [refresh]);
  useEffect(() => { const f = () => router.replace("/studio/login"); window.addEventListener("studio-signed-out", f); return () => window.removeEventListener("studio-signed-out", f); }, [router]);
  useEffect(() => { const f = () => router.replace("/studio/settings?change=1"); window.addEventListener("studio-password-required", f); return () => window.removeEventListener("studio-password-required", f); }, [router]);
  useEffect(() => { if (me) get<{ counts: { waiting: number } }>("/comments?status=waiting&limit=1").then((c) => setWaiting(c.counts.waiting)).catch(() => {}); }, [path, me]);

  async function signOut() { try { await post("/auth/logout"); } catch { /* */ } setCsrf(""); router.replace("/studio/login"); }
  const active = (h: string) => (h === "/studio" ? path === "/studio" : path.startsWith(h));

  if (!me) return <div style={{ padding: 40, color: "var(--muted)" }} aria-busy>Loading…</div>;
  return (
    <C.Provider value={{ me, waiting, refresh, siteName }}>
      <div className="studio">
        <aside className="s-side" aria-label="Studio">
          <div className="s-brand"><span className="wordmark">{siteName}</span><span className="s-pill">Studio</span></div>
          <nav className="s-nav" aria-label="Studio sections">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
                {I(n.icon)}{n.label}{n.badge && waiting > 0 && <span className="badge-n">{waiting}</span>}
              </Link>
            ))}
          </nav>
          <div className="s-me">
            <b>Signed in as {me.user.login_id}</b>
            <span>Last sign-in {me.last_login_at ? fmtDate(me.last_login_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "now"}{me.last_login_device ? `, ${me.last_login_device}` : ""}</span>
            <a href="/" target="_blank" rel="noopener">View the site</a>
            <button onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <div className="s-main">
          {me.must_change && path !== "/studio/settings" && (
            <div role="alert" style={{ background: "var(--flag-bg)", color: "var(--flag-fg)", padding: "12px 24px", fontSize: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <b>You are still using the starting password.</b> Anyone who knows it can sign in.
              <Link href="/studio/settings?change=1" style={{ fontWeight: 700, textDecoration: "underline" }}>Change it now</Link>
            </div>
          )}
          {children}
        </div>
        <nav className="s-tabbar" aria-label="Studio">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined}>
              {I(t.icon)}{t.label}
            </Link>
          ))}
        </nav>
      </div>
    </C.Provider>
  );
}
