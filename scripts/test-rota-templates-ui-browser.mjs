import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
if (
  spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).stdout.trim() !== "https://github.com/Jare7028/CT-Alt.git"
)
  throw Error("CT Alt checkout required");
const portProbe = await import("node:net");
await new Promise((resolve, reject) => {
  const probe = portProbe.createServer();
  probe.once("error", () =>
    reject(Error("Synthetic port5198 is already in use")),
  );
  probe.listen(5198, "127.0.0.1", () => probe.close(resolve));
});
const fixture = "app/rota-templates-component-fixture";
if (existsSync(fixture))
  throw Error("Existing fixture route will not be overwritten");
mkdirSync(fixture);
writeFileSync(
  fixture + "/page.tsx",
  "export {default} from '../../tests/rota-templates-ui-browser/fixture-page';\n",
);
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "5198",
  ],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "disabled-for-templates-component-tests",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "disabled",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  testChild = null,
  cleaning = false;
server.stdout.on("data", (c) => (log += c));
server.stderr.on("data", (c) => (log += c));
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  testChild?.kill("SIGTERM");
  if (server.exitCode === null) {
    const done = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await done;
  }
  rmSync(fixture, { recursive: true, force: true });
  rmSync(".next/dev/types", { recursive: true, force: true });
}
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
])
  process.once(signal, () => {
    void cleanup().then(() => process.exit(code));
  });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw Error("Owned fixture server failed " + log);
    try {
      if (
        (await fetch("http://127.0.0.1:5198/rota-templates-component-fixture"))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw Error("Owned fixture unavailable " + log);
  for (const args of [
    ["open", "http://127.0.0.1:5198/rota-templates-component-fixture"],
    ["snapshot", "-i"],
    [
      "eval",
      'document.querySelector("[data-nextjs-dialog]") ? "ERROR_OVERLAY" : document.body.innerText.trim().length ? "HAS_CONTENT" : "BLANK"',
    ],
    ["close"],
  ]) {
    const verified = spawnSync(
      "npx",
      [
        "--yes",
        "--package=agent-browser@0.38.2",
        "agent-browser",
        "--session",
        "ct-alt-templates-verify",
        "--executable-path",
        process.env.CT_ALT_CHROMIUM || "/usr/bin/chromium",
        ...args,
      ],
      { encoding: "utf8" },
    );
    if (verified.status !== 0 || /ERROR_OVERLAY|BLANK/.test(verified.stdout))
      throw Error(
        "Owned dev server browser verification failed: " +
          verified.stdout +
          verified.stderr,
      );
  }
  testChild = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "tests/rota-templates-ui-browser/playwright.config.ts",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: process.env },
  );
  if ((await new Promise((resolve) => testChild.once("exit", resolve))) !== 0)
    process.exitCode = 1;
} finally {
  await cleanup();
}
