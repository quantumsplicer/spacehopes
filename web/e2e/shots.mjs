// Usage: node e2e/shots.mjs <outDir> <name:path:width[:height]> ...
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [out, ...specs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const s of specs) {
  const [name, path, w = "1440", h = "900"] = s.split("|");
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto("http://localhost:8080" + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(name, errors.length ? "ERRORS: " + errors.slice(0, 3).join(" | ") : "ok");
  await ctx.close();
}
await browser.close();
