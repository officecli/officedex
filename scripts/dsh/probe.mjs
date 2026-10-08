import { chromium } from "playwright";

const [, , command, ...rest] = process.argv;
const URL_ARG = process.env.APP_URL || "";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

if (URL_ARG) {
  await page.goto(URL_ARG, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}
console.log("URL:", page.url());
console.log("TITLE:", await page.title());
const frames = page.frames().map((f) => f.url());
console.log("FRAMES:", JSON.stringify(frames, null, 1));
console.log("BODY_LEN:", (await page.content()).length);
console.log("---- console ----");
console.log(logs.join("\n") || "(none)");
console.log("---- top-level text ----");
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500));
await page.screenshot({ path: "build/dev-real/probe.png" });
await browser.close();
