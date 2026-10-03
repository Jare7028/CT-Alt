import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
// Never accepts a hosted URL, inherited credential, existing stack or private data.
const prefix = "ct-alt-chat-acceptance";
const containers = ["gateway", "rest", "auth", "db"].map(
  (part) => `${prefix}-${part}`,
);
const origin = spawnSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
}).stdout.trim();
if (origin !== "https://github.com/Jare7028/CT-Alt.git")
  throw Error("Wrong checkout");
for (const name of containers)
  if (spawnSync("docker", ["inspect", name], { stdio: "ignore" }).status === 0)
    throw Error(`Refusing existing resource ${name}`);
if (
  spawnSync("docker", ["network", "inspect", prefix], { stdio: "ignore" })
    .status === 0
)
  throw Error("Refusing existing network");
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(Error("Local acceptance app port 5194 is already in use")),
  );
  probe.listen(5194, "127.0.0.1", () => probe.close(resolve));
});
// An exclusive task lock prevents another copy from racing the preflight and
// later cleaning up this run's named containers.
const lockPath = "/tmp/ct-alt-chat-acceptance-lock";
mkdirSync(lockPath);
const originalEnv = existsSync(".env.local")
  ? readFileSync(".env.local")
  : null;
const guidance = readFileSync("AGENTS.md", "utf8");
let server;
function run(args) {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Local acceptance command failed")),
    );
  });
}
try {
  mkdirSync("/tmp/ct-alt-chat-stack/supabase", { recursive: true });
  writeFileSync(
    "/tmp/ct-alt-chat-stack/supabase/config.toml",
    `project_id = "${prefix}"\n`,
  );
  await run(["scripts/chat-local-stack.mjs"]);
  let healthy = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch("http://127.0.0.1:54821/auth/v1/health");
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await delay(200);
  }
  if (!healthy) throw Error("Owned Auth unavailable");
  await run(["scripts/chat-local-fixtures.mjs"]);
  const settings = JSON.parse(
    readFileSync("/tmp/ct-alt-chat-status.json", "utf8"),
  );
  if (settings.API_URL !== "http://127.0.0.1:54821")
    throw Error("Wrong owned API");
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "5194",
    ],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: settings.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.ANON_KEY,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null)
      throw Error("Local dev server exited: " + log);
    try {
      const result = await fetch("http://127.0.0.1:5194/login");
      if (result.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!ready) throw Error("Local app unavailable: " + log);
  await run([
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.chat-integration.config.ts",
  ]);
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
  }
  for (const name of containers)
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", prefix], { stdio: "ignore" });
  if (originalEnv) writeFileSync(".env.local", originalEnv, { mode: 0o600 });
  else rmSync(".env.local", { force: true });
  rmSync(".next/dev/types", { recursive: true, force: true });
  if (!guidance.includes("<!-- BEGIN:nextjs-agent-rules -->"))
    writeFileSync(
      "AGENTS.md",
      readFileSync("AGENTS.md", "utf8").replace(
        /\n<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->\n/,
        "",
      ),
    );
  for (const file of [
    "/tmp/ct-alt-chat-status.json",
    "/tmp/ct-alt-chat-acceptance-fixtures.json",
  ])
    rmSync(file, { force: true });
  rmSync(lockPath, { recursive: true });
}
