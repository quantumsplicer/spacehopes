import type { Metadata } from "next";

export const metadata: Metadata = { title: "Comment policy" };

export default function CommentPolicy() {
  return (
    <div className="legal">
      <h1>Comment policy</h1>
      <p>[Placeholder: edit this to your own words.]</p>
      <h2>Disagreement is welcome</h2>
      <p>Comments are for thinking alongside each other. Disagree freely, and say why.</p>
      <h2>What gets held back</h2>
      <p>Abuse, threats, hate, spam, and anything that names or targets a private person. Comments with several links are held for a person to read.</p>
      <h2>How it works</h2>
      <p>Comments are plain text and are read before they appear. Hidden comments are kept for the record but are not shown.</p>
    </div>
  );
}
