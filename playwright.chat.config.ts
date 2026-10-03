import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/chat-browser",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5193",
    headless: true,
    launchOptions: {
      executablePath: process.env.CT_ALT_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  reporter: "list",
});
