import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const origin = spawnSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
}).stdout.trim();
if (origin !== "https://github.com/Jare7028/CT-Alt.git")
  throw new Error("CT Alt checkout required");
const fixture = "app/smart-groups-test-fixture";
if (existsSync(fixture))
  throw new Error("Fixture route exists; refusing to overwrite");
mkdirSync(fixture);
writeFileSync(
  `${fixture}/page.tsx`,
  "export {default} from '../../tests/smart-groups-browser/fixture-page';\n",
);
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "5195",
  ],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "disabled-for-smart-groups-component-tests",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "disabled",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
server.stdout.on("data", (chunk) => {
  log += chunk;
});
server.stderr.on("data", (chunk) => {
  log += chunk;
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Fixture server exited: " + log);
    try {
      if ((await fetch("http://127.0.0.1:5195/smart-groups-test-fixture")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw new Error("Fixture server unavailable: " + log);
  if (process.env.CT_ALT_AGENT_BROWSER) {
    mkdirSync("test-results", { recursive: true });
    const env = {
      ...process.env,
      AGENT_BROWSER_SESSION: "ct-sg-review",
      AGENT_BROWSER_NAMESPACE: "ct-sg-review",
      AGENT_BROWSER_SOCKET_DIR: "/tmp/ct-smart-groups-browser",
      AGENT_BROWSER_EXECUTABLE_PATH: "/usr/bin/chromium",
      XDG_CONFIG_HOME: "/tmp/ct-alt-smart-groups-chrome-config",
      XDG_CACHE_HOME: "/tmp/ct-alt-smart-groups-chrome-cache",
    };
    for (const args of [
      ["open", "http://127.0.0.1:5195/smart-groups-test-fixture"],
      [
        "wait",
        "--fn",
        '!!document.querySelector(".sg-heading button") && !document.querySelector(".sg-heading button").disabled',
      ],
      ["snapshot", "-i"],
      [
        "eval",
        'document.body.innerText.trim().length > 0 && !document.querySelector("[data-nextjs-dialog]")',
      ],
      ["screenshot", "/tmp/ct-alt-smart-groups-gut-check.png"],
      ["open", "http://127.0.0.1:5195/"],
      ["close"],
    ]) {
      const result = spawnSync(
        process.env.CT_ALT_AGENT_BROWSER,
        ["--args", "--no-sandbox", ...args],
        { env, encoding: "utf8", timeout: 30000 },
      );
      if (result.status !== 0)
        throw new Error("Browser verification failed: " + result.stderr);
      console.log(result.stdout.trim());
    }
  }
  const child = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "tests/smart-groups-browser/playwright.config.ts",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: process.env },
  );
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) process.exitCode = 1;
} finally {
  if (server.exitCode === null) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await closed;
  }
  rmSync(fixture, { recursive: true });
  rmSync(".next/dev/types", { recursive: true, force: true });
}
