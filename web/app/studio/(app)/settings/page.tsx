"use client";
import { useEffect, useRef, useState } from "react";
import { get, post, put } from "@/lib/studio";
import ChangePassword from "@/components/studio/ChangePassword";
import { fmtDate } from "@/lib/format";
import { useStudio } from "@/components/studio/StudioShell";

type S = { comment_mode: "name" | "signed_in"; review_comments: boolean; disable_copy: boolean; watermark: boolean; site_name: string; about_quote: string; about_byline: string; about_quote_confirmed: boolean; footer_line: string; social_links: { label: string; url: string }[]; mail_configured?: boolean; mail?: { configured: boolean; provider: string; from: string; owner_email: string } };

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch-hit" onClick={() => onChange(!on)}><span className="switch" aria-checked={on} /></button>;
}

export default function Settings() {
  const { me, refresh } = useStudio();
  const owner = me.user.role === "owner";
  const [s, setS] = useState<S | null>(null);
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [testTo, setTestTo] = useState("");
  const [testState, setTestState] = useState<null | { ok: boolean; text: string }>(null);
  const [testing, setTesting] = useState(false);
  const [audit, setAudit] = useState<any[] | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => setAsked(location.search.includes("change=1")), []);
  const forced = asked || me.must_change;

  useEffect(() => { get<S>("/settings").then((x) => { setS(x); }) }, []);

  async function save(patch: Partial<S>) {
    if (!s || !owner) return;
    setS({ ...s, ...patch }); setErr("");
    try { const r = await put<S>("/settings", patch); setS(r); setSaved("Saved"); clearTimeout(timer.current); timer.current = setTimeout(() => setSaved(""), 1800); }
    catch (e: any) { setErr(e.message); }
  }
  const debounced = (patch: Partial<S>) => { if (!s) return; setS({ ...s, ...patch }); clearTimeout(timer.current); timer.current = setTimeout(() => save(patch), 700); };

  async function sendTest() {
    setTesting(true); setTestState(null);
    try { const r = await post("/settings/test-email", { to: testTo || me.user.email }); setTestState({ ok: true, text: String(r.provider).includes("Mailpit")
        ? "Sent to the local test inbox. Nothing is delivered to real inboxes while developing: open http://localhost:8025 to read it. Real sending is only set up on the live site."
        : `Sent through ${r.provider}. Check the inbox of ${testTo || me.user.email} (and its spam folder), and the Sent folder of the sending account.` }); }
    catch (e: any) { setTestState({ ok: false, text: e.message }); }
    setTesting(false);
  }
  async function loadAudit() { setAudit(await get("/audit-log?limit=100")); }

  if (!s) return <p style={{ padding: 40, color: "var(--muted)" }} aria-busy>Loading…</p>;
  const signed = s.comment_mode === "signed_in";
  return (
    <>
      <header className="s-top"><h1>Settings</h1><span role="status" style={{ color: "var(--teal)", fontSize: 14 }}>{saved}</span></header>
      <div className="s-body">
        {!owner && <p className="footnote" style={{ marginBottom: 20 }}>Editors can look at settings but only the owner can change them.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {s.mail_configured === false && (
          <div role="alert" className="footnote" style={{ background: "var(--flag-bg)", color: "var(--flag-fg)", marginBottom: 20 }}>
            <b>Email is not set up yet.</b> Subscribers cannot sign up and readers cannot get sign-in codes until a mail service is added (see <code>docs/DEPLOY-FREE.md</code>, step 2).
          </div>
        )}
        <div className="set-grid">
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 14px" }}>Who can comment</h2>
            <div role="radiogroup" aria-label="Who can comment">
              <button className="radio-card" role="radio" aria-checked={!signed} disabled={!owner} onClick={() => save({ comment_mode: "name" })}><span className="dot-r" /><span><b>Anyone, with just a name</b><span>Default. No account or email needed.</span></span></button>
              <button className="radio-card" role="radio" aria-checked={signed} disabled={!owner} onClick={() => save({ comment_mode: "signed_in" })}><span className="dot-r" /><span><b>Only signed-in readers</b><span>Google or a one-time email code before commenting.</span></span></button>
            </div>
            <div className="switch-row"><div><b>Review comments before they appear</b><span>Recommended. New comments wait in the queue.</span></div><Switch on={s.review_comments} onChange={(v) => save({ review_comments: v })} label="Review comments before they appear" /></div>
            <div className="switch-row"><div><b>Turn off copying on posts</b><span>Blocks selecting, copying, right-click and saving images. Screenshots cannot be blocked.</span></div><Switch on={s.disable_copy} onChange={(v) => save({ disable_copy: v })} label="Turn off copying on posts" /></div>
            <div className="switch-row"><div><b>Watermark images and drawings</b><span>Adds a faint site name to the corner of new uploads.</span></div><Switch on={s.watermark} onChange={(v) => save({ watermark: v })} label="Watermark images and drawings" /></div>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 14px" }}>What readers see</h2>
            <div className="preview" aria-live="polite">
              <h3>Conversation</h3>
              <div className="cform">
                {signed ? <p style={{ fontSize: 14, marginBottom: 14 }}>Please sign in to join the conversation. Only your name will be shown.</p> : <><span className="label">Your name</span><div className="field" style={{ height: 44 }} aria-hidden /></>}
                <span className="label" style={{ marginTop: 14 }}>{signed ? "Sign in with" : "Your thoughts"}</span>
                {signed ? <div style={{ display: "flex", gap: 8 }}><span className="btn btn-ghost btn-sm">Google</span><span className="btn btn-ghost btn-sm">Email code</span></div> : <div className="field" style={{ height: 76 }} aria-hidden />}
                <div className="foot"><span>{signed ? "" : "No account needed."}</span><span className="btn btn-teal btn-sm">Post comment</span></div>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>{s.review_comments ? "New comments go to the review queue first." : "New comments appear straight away, unless they are flagged."}</p>
            </div>
          </div>
        </div>

        <section className="set-section" aria-labelledby="mail-h">
          <h2 id="mail-h">Email</h2>
          <div className="card">
            <p style={{ fontSize: 14, marginBottom: 14 }}>
              <b>Sending through:</b> {s.mail?.provider ?? "unknown"}{s.mail?.from ? <> · <b>from</b> {s.mail.from}</> : null}
              {s.mail?.configured === false && <span style={{ color: "var(--flag-fg)" }}> · not set up yet</span>}
              {s.mail?.provider?.includes("Mailpit") && <span style={{ color: "var(--muted)" }}> · development only: messages go to <a href="http://localhost:8025" target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>http://localhost:8025</a>, not to real inboxes</span>}
            </p>
            <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 14, maxWidth: 560 }}>This email is used for subscriber confirmations, new-post emails, reader sign-in codes and sign-in alerts. Send yourself a test to see it work: the message should arrive within a minute, and a copy should appear in the Sent folder of the sending Gmail account.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label className="sr-only" htmlFor="test-to">Send the test to</label>
              <input id="test-to" className="field" type="email" style={{ maxWidth: 320 }} placeholder={me.user.email || "you@example.com"} value={testTo} onChange={(e) => setTestTo(e.target.value)} disabled={!owner} />
              <button className="btn btn-teal" onClick={sendTest} disabled={!owner || testing || s.mail?.configured === false}>{testing ? "Sending…" : "Send a test email"}</button>
            </div>
            <div aria-live="polite" role="status" style={{ marginTop: 12 }}>
              {testState && (testState.ok
                ? <p style={{ color: "var(--teal)", fontSize: 14 }}>✓ {testState.text}</p>
                : <p className="err" role="alert">Could not send: {testState.text}</p>)}
            </div>
          </div>
        </section>

        <section className="set-section" aria-labelledby="site-h">
          <h2 id="site-h">The site</h2>
          <div className="set-grid">
            <div style={{ display: "grid", gap: 16 }}>
              <div><label className="label" htmlFor="sn">Site name (the italic wordmark in the header and the Studio)</label><input id="sn" className="field" disabled={!owner} value={s.site_name} maxLength={60} onChange={(e) => debounced({ site_name: e.target.value })} /></div>
              <div><label className="label" htmlFor="aq">About quote {!s.about_quote_confirmed && <span style={{ color: "var(--muted)", fontWeight: 400 }}>[to be confirmed]</span>}</label>
                <textarea id="aq" className="field" rows={3} disabled={!owner} value={s.about_quote} maxLength={400} onChange={(e) => debounced({ about_quote: e.target.value, about_quote_confirmed: true })} /></div>
              <div><label className="label" htmlFor="ab">Name shown under the About quote</label><input id="ab" className="field" disabled={!owner} value={s.about_byline} maxLength={120} onChange={(e) => debounced({ about_byline: e.target.value })} /></div>
              <div><label className="label" htmlFor="fl">Footer line (after “Space hopes.”)</label><input id="fl" className="field" disabled={!owner} value={s.footer_line} maxLength={200} onChange={(e) => debounced({ footer_line: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <div><span className="label">Social links (shown on the Contact page)</span>
                {s.social_links.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input aria-label="Label" className="field" style={{ width: 110 }} disabled={!owner} value={l.label} onChange={(e) => debounced({ social_links: s.social_links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <input aria-label="Link" className="field" placeholder="https://" disabled={!owner} value={l.url} onChange={(e) => debounced({ social_links: s.social_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                    {owner && <button className="linkbtn" onClick={() => save({ social_links: s.social_links.filter((_, j) => j !== i) })}>Remove</button>}
                  </div>
                ))}
                {owner && s.social_links.length < 8 && <button className="btn btn-ghost btn-sm" onClick={() => setS({ ...s, social_links: [...s.social_links, { label: "", url: "https://" }] })}>Add a link</button>}
              </div>
            </div>
          </div>
        </section>

        <section className="set-section" aria-labelledby="sec-h" id="security">
          <h2 id="sec-h">Security</h2>
          <ChangePassword forced={forced} />
          {owner && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>Audit log</h2>
              {!audit ? <button className="btn btn-ghost btn-sm" onClick={loadAudit}>Show recent activity</button> : (
                <div style={{ maxHeight: 320, overflow: "auto", fontSize: 13 }}>
                  {audit.map((a) => <div key={a.id} style={{ display: "flex", gap: 12, padding: "6px 0", borderTop: "1px solid var(--line)" }}><span style={{ color: "var(--muted)", width: 150, flex: "none" }}>{fmtDate(a.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })}</span><span>{a.action}{a.target ? ` #${a.target}` : ""}</span></div>)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
