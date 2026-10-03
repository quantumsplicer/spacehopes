import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "120px 24px", textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 56, margin: 0 }}>Nothing <em style={{ color: "var(--teal)" }}>here.</em></h1>
      <p style={{ color: "var(--ink-2)", margin: "16px 0 28px" }}>That page does not exist, or it has not been published yet.</p>
      <Link href="/" className="btn btn-ink">Back to the notebook</Link>
    </div>
  );
}
