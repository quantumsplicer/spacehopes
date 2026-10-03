import type { Metadata } from "next";
import { getSettings } from "@/lib/api";
import ContactForm from "@/components/site/ContactForm";

export const metadata: Metadata = { title: "Contact" };

/** No office address and no grievance-portal notice: either would reveal who the owner is. */
export default async function Contact() {
  const s = await getSettings();
  return (
    <div className="container-page contact-grid">
      <div>
        <p style={{ color: "var(--teal)", fontSize: 14, fontWeight: 600 }}>Contact</p>
        <h1 className="page-h1 rise" style={{ marginTop: 18 }}>Write<br /><em>to me.</em></h1>
        <p className="lead">Every message is read. A reply may take a little while.</p>
        <div className="links">
          {s.social_links.map((l) => <a key={l.url} href={l.url} rel="noopener noreferrer nofollow" target="_blank">{l.label}</a>)}
          <a href="/rss.xml">RSS</a>
        </div>
      </div>
      <ContactForm />
    </div>
  );
}
