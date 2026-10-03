"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Close, Menu, Search } from "@/components/Icons";
import { useSite } from "./SiteProvider";
import SearchPalette from "./SearchPalette";

const LINKS = [
  { href: "/feed", label: "Thoughts/Feed", match: (p: string) => p.startsWith("/feed") || p.startsWith("/p/") || p.startsWith("/t/") },
  { href: "/about", label: "About", match: (p: string) => p.startsWith("/about") },
  { href: "/contact", label: "Contact", match: (p: string) => p.startsWith("/contact") },
];

export default function Header() {
  const path = usePathname();
  const { site_name } = useSite();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(t && /input|textarea|select/i.test(t.tagName)) && !t?.isContentEditable) {
        e.preventDefault(); setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container-page inner">
          <Link href="/" className="wordmark" aria-label={`${site_name}, home`}>{site_name}</Link>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="navlink" aria-current={l.match(path) ? "page" : undefined}>{l.label}</Link>
            ))}
            <button className="search-pill" onClick={() => setSearch(true)} aria-label="Search (press /)">
              <Search width={16} height={16} /> Search <kbd aria-hidden>/</kbd>
            </button>
            <Link href="/subscribe" className="btn btn-teal btn-sm">Subscribe</Link>
          </nav>
          <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"}>
            {open ? <Close /> : <Menu />}
          </button>
        </div>
      </header>
      <div id="mobile-nav" className="mobile-nav" hidden={!open}>
        {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        <button onClick={() => { setOpen(false); setSearch(true); }} style={{ textAlign: "left", fontFamily: "var(--font-serif)", fontSize: 30, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>Search</button>
        <Link href="/subscribe">Subscribe</Link>
      </div>
      {search && <SearchPalette onClose={() => setSearch(false)} />}
    </>
  );
}
