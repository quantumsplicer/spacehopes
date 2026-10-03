import Link from "next/link";
import type { PublicSettings } from "@/lib/types";

/** One quiet line. */
export default function Footer({ settings }: { settings: PublicSettings }) {
  return (
    <footer className="site-footer">
      <div className="container-page inner">
        <p style={{ margin: 0 }}><em>Space hopes.</em> {settings.footer_line}</p>
        <nav aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/comment-policy">Comment policy</Link>
          <a href="/rss.xml">RSS</a>
        </nav>
      </div>
    </footer>
  );
}
