import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "requests.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${process.env.CT_ALT_REQUESTS_UI_PORT || 5197}`,
    headless: true,
    viewport: { width: 1444, height: 960 },
    launchOptions: {
      executablePath: process.env.CT_ALT_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
});
