import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5194",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    launchOptions: {
      executablePath: process.env.CT_ALT_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  reporter: "list",
});
