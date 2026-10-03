"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { get, post } from "@/lib/studio";

/** Phone tab "Write": reopen the newest empty thought draft, or start a new one. */
export default function Write() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const drafts = await get<any[]>("/posts?status=draft&type=thought").catch(() => []);
      const empty = drafts.find((d) => !d.text);
      const id = empty ? empty.id : (await post("/posts", { type: "thought" })).id;
      router.replace(`/studio/posts/${id}`);
    })();
  }, [router]);
  return <p style={{ padding: 24, color: "var(--muted)" }} aria-busy>Opening a blank page…</p>;
}
