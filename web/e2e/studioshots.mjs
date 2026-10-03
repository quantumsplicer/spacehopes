// Usage: node e2e/studioshots.mjs <outDir>   (needs the stack running)
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const creds = JSON.parse(execSync("docker compose exec -T api python -m app.cli e2e-user", { cwd: new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") }).toString().trim().split("\n").pop());

const browser = await chromium.launch();
async function login(page, n) {
  await page.goto("http://localhost:8080/studio/login");
  await page.screenshot({ path: `${out}/login.png` });
  await page.getByLabel("Login ID").fill(creds.login_id);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/studio");
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce", userAgent: "Mozilla/5.0 Chrome/130" });
const page = await ctx.newPage();
const errors = []; page.on("console", (m) => m.type() === "error" && errors.push(m.text())); page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await login(page, 0);
await page.waitForSelector(".chart svg"); await page.waitForTimeout(900);
await page.locator(".chart svg rect[role=button]").nth(9).click();
await page.screenshot({ path: `${out}/overview.png` });
await page.goto("http://localhost:8080/studio/comments"); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/comments.png` });
await page.goto("http://localhost:8080/studio/settings"); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/settings.png`, fullPage: true });
await page.goto("http://localhost:8080/studio/posts"); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/posts.png` });
await page.goto("http://localhost:8080/studio"); await page.getByRole("button", { name: "New blog" }).first().click();
await page.waitForURL(/posts\/\d+/); await page.getByLabel("Title").fill("Title"); await page.locator(".tiptap").click(); await page.keyboard.type("[Body text as it is being written, in the same type readers will see.]"); await page.keyboard.press("Enter"); await page.keyboard.type("/");
await page.waitForSelector(".slash"); await page.screenshot({ path: `${out}/editor.png` });
// drawing studio at iPad size
await page.getByRole("option", { name: /Drawing/ }).click();
await page.setViewportSize({ width: 1366, height: 1024 });
await page.waitForSelector(".ds-stage > canvas"); await page.waitForTimeout(500);
const cv = await page.locator(".ds-stage > canvas").boundingBox();
const cx = cv.x + cv.width / 2 - 100, cy = cv.y + cv.height / 2;
await page.getByRole("button", { name: "Black" }).click(); await page.getByRole("button", { name: "Pen", exact: true }).click();
for (const [x0, y0, x1, y1] of [[-200, 60, 200, 60], [-200, 60, -200, -80], [200, 60, 200, -80], [-200, -80, 200, -80]]) { await page.mouse.move(cx + x0, cy + y0); await page.mouse.down(); await page.mouse.move(cx + x1, cy + y1, { steps: 14 }); await page.mouse.up(); }
await page.getByRole("button", { name: "Colour pencil" }).click(); await page.getByRole("button", { name: "Saffron" }).click();
await page.mouse.move(cx + 260, cy - 200); await page.mouse.down(); for (let a = 0; a <= 24; a++) await page.mouse.move(cx + 260 + 40 * Math.cos(a / 24 * 6.4), cy - 200 + 40 * Math.sin(a / 24 * 6.4)); await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/drawing.png` });
await ctx.close();

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce", userAgent: "Mozilla/5.0 Chrome/130" });
const mp = await m.newPage(); await login(mp, 1); await mp.waitForTimeout(900); await mp.screenshot({ path: `${out}/overview-m.png`, fullPage: true });
await mp.goto("http://localhost:8080/studio/comments"); await mp.waitForTimeout(700); await mp.screenshot({ path: `${out}/comments-m.png`, fullPage: true });
await mp.getByRole("link", { name: "Write" }).click(); await mp.waitForTimeout(1000); await mp.screenshot({ path: `${out}/write-m.png` });
console.log(errors.length ? "console errors:\n" + errors.join("\n") : "no console errors");
await browser.close();
