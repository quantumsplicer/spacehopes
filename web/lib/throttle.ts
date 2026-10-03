"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Front-end throttling for password forms. It is a courtesy and a speed bump (it survives a page refresh, and
 * it follows any wait the server announces); the real limits are enforced by the API, which does not trust this.
 * After 3 wrong attempts the form locks for 5 s, then 10 s, 20 s ... up to 5 minutes.
 */
const cooldown = (fails: number) => (fails < 3 ? 0 : Math.min(300, 5 * 2 ** (fails - 3)));
type State = { fails: number; until: number };

function read(key: string): State {
  try { const v = JSON.parse(localStorage.getItem("throttle:" + key) ?? "null"); if (v && typeof v.fails === "number") return v; } catch { /* */ }
  return { fails: 0, until: 0 };
}
function write(key: string, s: State) { try { localStorage.setItem("throttle:" + key, JSON.stringify(s)); } catch { /* storage blocked: the server still limits */ } }

export function useThrottle(key: string) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const last = useRef(0);

  useEffect(() => { setUntil(read(key).until); }, [key]);
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => { setNow(Date.now()); if (Date.now() >= until) clearInterval(t); }, 250);
    return () => clearInterval(t);
  }, [until]);

  const left = Math.max(0, Math.ceil((until - now) / 1000));

  /** Call before sending. Returns false if the form is locked or was submitted a moment ago (double clicks, scripts). */
  const allow = useCallback(() => {
    const t = Date.now();
    if (read(key).until > t || t - last.current < 800) return false;
    last.current = t;
    return true;
  }, [key]);

  /** Record a failed attempt. `serverWaitSeconds` comes from a 429 and can only lengthen the wait. */
  const failed = useCallback((serverWaitSeconds = 0) => {
    const s = read(key);
    const fails = s.fails + 1;
    const wait = Math.max(cooldown(fails), serverWaitSeconds);
    const next = { fails, until: wait ? Date.now() + wait * 1000 : 0 };
    write(key, next); setUntil(next.until); setNow(Date.now());
  }, [key]);

  const succeeded = useCallback(() => { write(key, { fails: 0, until: 0 }); setUntil(0); }, [key]);

  return { left, locked: left > 0, allow, failed, succeeded };
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
