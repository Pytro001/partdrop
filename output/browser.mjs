// Shared Playwright launcher: bundled headless Chromium if present, otherwise installed Chrome.
const mod = process.env.PLAYWRIGHT_MODULE || '/Users/pytro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const { chromium } = await import(mod)
export async function launch(args = ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']) {
  try { return await chromium.launch({ headless: true, args }) } catch (e) {
    if (!String(e.message).includes("Executable doesn't exist")) throw e
    return await chromium.launch({ headless: true, channel: 'chrome', args })
  }
}
