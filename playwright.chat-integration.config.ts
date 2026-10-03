import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/chat-integration",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5194",
    headless: true,
    launchOptions: {
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  reporter: "list",
});
