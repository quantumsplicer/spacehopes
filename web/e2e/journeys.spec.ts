import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { credentials, csrf, mailTo, signInStudio } from "./helpers";

const SLUG = "blog-title-clear-and-calm-up-to-three-lines";
const IMG = path.resolve(__dirname, "fixtures/red.jpg");
const run = Date.now().toString(36);

async function visitorsNow(page: Page) {
  await page.goto("/studio");
  const n = await page.locator(".stat.tint .num").first().textContent();
  const r = await page.locator(".stat").nth(1).locator(".num").textContent();
  return { v: Number((n ?? "0").replace(/\D/g, "")), r: Number((r ?? "0").replace(/\D/g, "")) };
}

test("a reader opens a blog, sees the progress bar and the lightbox", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hopes, given space." })).toBeVisible();
  await page.getByRole("link", { name: "[Blog title, clear and calm, up to three lines]", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${SLUG}`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Blog title, clear and calm");
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.locator(".progress").evaluate((e) => getComputedStyle(e).transform)).not.toBe("matrix(0, 0, 0, 1, 0, 0)");
  await page.getByRole("button", { name: /Open full screen/ }).first().click();
  const lb = page.getByRole("dialog", { name: "Image viewer" });
  await expect(lb).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(lb).toBeHidden();
});

test("copying is blocked on posts, with a toast, but the comment box still works", async ({ page }) => {
  await page.goto(`/p/${SLUG}`);
  const ok = await page.evaluate(() => getComputedStyle(document.querySelector(".prose p")!).userSelect);
  expect(ok).toBe("none");
  await page.locator(".prose p").first().dispatchEvent("copy");
  await expect(page.getByText("Copying is turned off. Use Share to send the link.")).toBeVisible();
  await page.locator(".cform-inline").getByLabel("Your thoughts").fill("typing works");
  expect(await page.locator(".cform-inline").getByLabel("Your thoughts").inputValue()).toBe("typing works");
});

test("name-only comment waits for review", async ({ page }) => {
  await page.goto(`/p/${SLUG}`);
  const form = page.locator(".cform-inline");
  await form.getByLabel("Your name").fill(`E2E Reader ${run}`);
  await form.getByLabel("Your thoughts").fill(`A thoughtful remark ${run}`);
  await form.getByRole("button", { name: "Post comment" }).click();
  await expect(form.getByText("Thank you. Your comment is awaiting review.")).toBeVisible();
});

test("subscribe needs a confirmed email (double opt-in)", async ({ page }) => {
  const email = `e2e+${run}@example.com`;
  await page.goto("/");
  await page.locator("aside").getByLabel("Email address").fill(email);
  await page.locator("aside").getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByText("Almost there. Check your inbox to confirm.")).toBeVisible();
  const mail = await mailTo(email, "Confirm");
  const link = mail.Text.match(/https?:\/\/\S+confirm\?token=\S+/)![0];
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByRole("heading", { name: "You are subscribed." })).toBeVisible();
});

test("contact form sends and shows the tick", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByText("office", { exact: false })).toHaveCount(0); // no address, no grievance notice
  await page.getByLabel("Your name").fill("E2E Writer");
  await page.getByRole("textbox", { name: "Email" }).fill(`e2e.contact+${run}@example.com`);
  await page.getByRole("button", { name: "Media" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Hello, this is an automated test message.");
  await page.getByRole("button", { name: "Send message" }).isDisabled();
  await page.getByLabel(/My details will be used only/).check();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Received. Thank you." })).toBeVisible();
});

test("search palette opens with / and finds a post", async ({ page }) => {
  await page.goto("/about");
  await page.keyboard.press("/");
  const d = page.getByRole("dialog", { name: /Search/ });
  await expect(d).toBeVisible();
  await d.getByRole("textbox").fill("drawing");
  await expect(d.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();
});

test("owner writes a blog with an image and a drawing, publishes, moderates, and sees the numbers move", async ({ page, browser }) => {
  await signInStudio(page);
  const before = await visitorsNow(page);

  // new blog
  await page.getByRole("button", { name: "New blog" }).first().click();
  await page.waitForURL(/\/studio\/posts\/\d+/);
  const postId = page.url().match(/posts\/(\d+)/)![1];
  await page.getByLabel("Title").fill(`E2E blog ${run}`);
  await page.getByLabel("Standfirst").fill("Written by a robot, for testing.");
  const body = page.locator(".tiptap");
  await body.click();
  await page.keyboard.type("The first paragraph of the e2e blog. ");
  await page.keyboard.press("Enter");

  // an image via the / menu (the file picker opens)
  await page.keyboard.type("/");
  await expect(page.getByRole("option", { name: /Image/ })).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("option", { name: /Image/ }).click()]);
  await chooser.setFiles(IMG);
  await expect(page.locator(".nv img").first()).toBeVisible();
  await page.getByLabel("Alt text (required)").first().fill("A red field with a yellow sun");

  // publishing is blocked until alt text exists: add a drawing and try first
  await page.locator(".tiptap p").last().click();
  await page.keyboard.type("/");
  await page.getByRole("option", { name: /Drawing/ }).click();
  const studio = page.getByRole("dialog", { name: "Drawing studio" });
  await expect(studio).toBeVisible();
  const cv = studio.locator("canvas").first();
  await cv.waitFor();
  const box = (await cv.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-120, -40], [0, 40], [120, -40]]) {
    await page.mouse.move(cx + dx - 60, cy + dy); await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy + 60, { steps: 12 }); await page.mouse.move(cx + dx + 60, cy + dy, { steps: 12 }); await page.mouse.up();
  }
  await studio.getByRole("button", { name: "Teal" }).click();
  await studio.getByRole("button", { name: "Pen", exact: true }).click();
  await page.mouse.move(cx - 150, cy + 150); await page.mouse.down(); await page.mouse.move(cx + 150, cy + 150, { steps: 20 }); await page.mouse.up();
  await studio.getByRole("button", { name: "Undo" }).click();
  await studio.getByRole("button", { name: "Redo" }).click();
  await studio.getByRole("button", { name: "Add to post" }).click();
  await expect(studio).toBeHidden();
  await expect(page.locator(".nv")).toHaveCount(2);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "alt text" })).toBeVisible(); // blocked: the drawing has no alt text
  await page.getByLabel("Alt text (required)").last().fill("Teal and black strokes forming a loose pattern");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.")).toBeVisible({ timeout: 20_000 });
  const href = await page.getByRole("link", { name: "View on the site" }).getAttribute("href");

  // a reader (fresh browser) reads it and comments: visitors and readers go up
  const reader = await browser.newContext();
  const rp = await reader.newPage();
  await rp.goto(href!);
  await expect(rp.getByRole("heading", { level: 1 })).toContainText(`E2E blog ${run}`);
  await expect(rp.locator(".prose img").first()).toBeVisible();
  const form = rp.locator(".cform-inline");
  await form.getByLabel("Your name").fill(`E2E Moderate ${run}`);
  await form.getByLabel("Your thoughts").fill(`Please approve this ${run}`);
  await form.getByRole("button", { name: "Post comment" }).click();
  await expect(form.getByText("awaiting review")).toBeVisible();

  // the owner approves it
  await page.goto("/studio/comments");
  const row = page.locator("article.crow", { hasText: `Please approve this ${run}` });
  await expect(row).toBeVisible();
  await expect(row.getByText("Looks fine")).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveCount(0);
  await rp.reload();
  await expect(rp.getByText(`Please approve this ${run}`)).toBeVisible();
  await reader.close();

  // overview numbers changed
  const after = await visitorsNow(page);
  expect(after.v).toBeGreaterThan(before.v);
  expect(after.r).toBeGreaterThan(before.r);
  // leave no test content behind
  await page.request.delete(`/api/v1/studio/posts/${postId}`, { headers: { "x-csrf-token": await csrf(page) } });
});

test("signed-in-readers mode asks for a one-time email code", async ({ page, browser }) => {
  await signInStudio(page);
  const token = await csrf(page);
  const put = (data: object) => page.request.put("/api/v1/studio/settings", { data, headers: { "x-csrf-token": token } });
  expect((await put({ comment_mode: "signed_in", review_comments: false })).ok()).toBeTruthy();
  try {
    const ctx = await browser.newContext();
    const rp = await ctx.newPage();
    const form = rp.locator(".cform-inline");
    await expect(async () => { await rp.goto(`/p/${SLUG}`); await expect(form.getByText("Please sign in to join the conversation.")).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 30_000 }); // public settings are cached for a few seconds
    const email = `e2e.reader+${run}@example.com`;
    await form.getByLabel("Your name").fill(`E2E Ravi ${run}`);
    await form.getByLabel(/Email, for a one-time code/).fill(email);
    await form.getByRole("button", { name: "Send code" }).click();
    const mail = await mailTo(email, "sign-in code");
    const code = mail.Text.match(/\b(\d{6})\b/)![1];
    await form.getByLabel(/Six-digit code/).fill(code);
    await form.getByRole("button", { name: "Sign in" }).click();
    await expect(form.getByText(`Commenting as`)).toBeVisible();
    await form.getByLabel("Your thoughts").fill(`Signed in thought ${run}`);
    await form.getByRole("button", { name: "Post comment" }).click();
    await expect(form.getByText("now part of the conversation")).toBeVisible();
    await expect(rp.getByText(`Signed in thought ${run}`)).toBeVisible();
    await expect(rp.getByText(email)).toHaveCount(0); // the email is never shown
    await ctx.close();
  } finally {
    await put({ comment_mode: "name", review_comments: true });
  }
});

test("Studio phone layout: bottom tab bar and the Write screen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await signInStudio(page);
  await expect(page.getByRole("navigation", { name: "Studio" }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: "Write" })).toBeVisible();
  await page.getByRole("link", { name: "Write" }).click();
  await page.waitForURL(/\/studio\/posts\/\d+/);
  await expect(page.getByPlaceholder("Write a thought. One to four sentences.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Draw" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Photo" })).toBeVisible();
  await ctx.close();
});

test("sign-in: wrong passwords get one generic message, then the form locks with a countdown", async ({ page }) => {
  const c = credentials(true);
  await page.goto("/studio/login");
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("Login ID").fill(i === 1 ? "someone-else" : c.login_id); // an unknown ID says exactly the same thing
    await page.getByLabel("Password", { exact: true }).fill(`wrong-guess-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect login ID or password.", { exact: true })).toBeVisible();
    await page.waitForTimeout(900); // the form also refuses a second submit within a moment
  }
  await page.getByLabel("Login ID").fill(c.login_id);
  await page.getByLabel("Password", { exact: true }).fill(c.password);
  await expect(page.getByRole("button", { name: /Try again in/ })).toBeDisabled(); // locked, even for the right password
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/studio");
});

test("owner changes the password in the dashboard; the old one stops working", async ({ page }) => {
  const c = credentials(true);
  await signInStudio(page, c);
  await page.goto("/studio/settings");
  const NEWPW = "Orbit-Lantern-42-Quartz";
  const fillNew = async (old: string, next: string) => {
    await page.getByLabel("Current password").fill(old);
    await page.getByLabel("New password", { exact: true }).fill(next);
    await page.getByLabel("Repeat the new password").fill(next);
  };
  await fillNew(c.password, "short");
  await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled(); // too weak
  await fillNew("not-the-current-password-1A!", NEWPW);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The current password is not right.")).toBeVisible();
  await page.waitForTimeout(900); // a person would not resubmit within a second; the form ignores that
  await fillNew(c.password, NEWPW);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/studio/login");
  await page.getByLabel("Login ID").fill(c.login_id);
  await page.getByLabel("Password", { exact: true }).fill(c.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect login ID or password.", { exact: true })).toBeVisible();
  await page.waitForTimeout(900);
  await page.getByLabel("Password", { exact: true }).fill(NEWPW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/studio");
  credentials(true); // reset the test account for the next run
});
