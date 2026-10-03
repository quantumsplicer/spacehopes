import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

/** Placeholder notice (DPDP Act 2023). Bracketed text must be reviewed and replaced by the owner before launch. */
export default function Privacy() {
  return (
    <div className="legal">
      <h1>Privacy</h1>
      <p>[Review this notice with a lawyer before launch. It is written to fit the Digital Personal Data Protection Act, 2023, and it names the site, not any individual.]</p>
      <h2>What is collected</h2>
      <p>Visits are counted without cookies and without storing your IP address or browser details. The site stores only daily totals. If you comment, we keep the name you typed and the words you wrote. If you subscribe or write through the contact form, we keep your email address and your message.</p>
      <h2>Why</h2>
      <p>Only to show your comment, to send the emails you asked for, and to reply to your message. Nothing is sold or shared for advertising.</p>
      <h2>Spam protection</h2>
      <p>To stop abuse we keep a one-way scrambled fingerprint of a commenter&rsquo;s connection. It cannot be turned back into an IP address.</p>
      <h2>Your choices</h2>
      <p>Every email has an unsubscribe link. To have a comment or message removed, write through the contact page: [response time].</p>
      <h2>Contact for privacy questions</h2>
      <p>[Privacy contact address]</p>
    </div>
  );
}
