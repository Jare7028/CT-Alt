import { defineConfig } from "@playwright/test";
export default defineConfig({
  workers: 1,
  retries: 0,
  projects: [
    {
      name: "retained-forms",
      testDir: "../forms-browser",
      testMatch: "*.spec.ts",
    },
    { name: "reporting", testDir: ".", testMatch: "*.spec.ts" },
  ],
  use: {
    baseURL: "http://127.0.0.1:5196",
    headless: true,
    viewport: { width: 1444, height: 1050 },
    launchOptions: {
      executablePath: process.env.CT_ALT_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  reporter: "list",
});
