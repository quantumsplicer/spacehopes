import { execSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";

const ROOT = path.resolve(__dirname, "../..");
export const MAILPIT = process.env.E2E_MAILPIT ?? "http://localhost:8025";

let creds: { login_id: string; password: string } | null = null;
/** A throwaway owner (dev only). Pass refresh=true to reset its password and clear any sign-in throttling. */
export function credentials(refresh = false) {
  if (!creds || refresh) creds = JSON.parse(execSync(`${process.env.E2E_EXEC ?? "docker compose exec -T api"} python -m app.cli e2e-user`, { cwd: ROOT }).toString().trim().split("\n").pop()!);
  return creds!;
}

export async function signInStudio(page: Page, c = credentials()) {
  await page.goto("/studio/login");
  await page.getByLabel("Login ID").fill(c.login_id);
  await page.getByLabel("Password", { exact: true }).fill(c.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/studio");
}

export async function csrf(page: Page) { return page.evaluate(() => sessionStorage.getItem("csrf") ?? ""); }

export async function mailTo(to: string, subjectPart = "", tries = 20): Promise<{ Text: string; Subject: string }> {
  for (let i = 0; i < tries; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const m = list.messages?.find((x: any) => x.To.some((t: any) => t.Address === to) && x.Subject.includes(subjectPart));
    if (m) { const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json(); return { Text: full.Text, Subject: full.Subject }; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to}`);
}
