import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
// A temporary component harness: no Auth accounts, database, keys or messages.
// Never reused as a production route. The browser intercepts all chat API calls.
const origin = spawnSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
}).stdout.trim();
if (origin !== "https://github.com/Jare7028/CT-Alt.git")
  throw new Error("CT Alt checkout required");
const originalGuidance = readFileSync("AGENTS.md", "utf8");
const route = "app/chat-test-fixture";
if (existsSync(route))
  throw new Error("Fixture route already exists; refusing to overwrite");
mkdirSync(route);
writeFileSync(
  `${route}/page.tsx`,
  `import Chat from '../chat/chat';
export default function Fixture(){return <Chat company={{id:'40000000-0000-4000-8000-000000000001',name:'Synthetic Company'}} companies={[{id:'40000000-0000-4000-8000-000000000001',name:'Synthetic Company'}]} actorId="00000000-0000-4000-8000-000000000001" management={true}/>;}`,
);
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "5193",
  ],
  {
    // Deliberately invalid config prevents all Supabase operations, including proxy.
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "disabled-for-chat-component-tests",
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
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Fixture server exited: " + log);
    try {
      const result = await fetch("http://127.0.0.1:5193/chat-test-fixture");
      if (result.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw new Error("Fixture server did not become ready: " + log);
  if (process.env.CT_ALT_AGENT_BROWSER) {
    mkdirSync("test-results", { recursive: true });
    const browserEnv = {
      ...process.env,
      AGENT_BROWSER_SESSION: "ct-alt-chat-gut-check",
      AGENT_BROWSER_NAMESPACE: "ct-alt-chat-gut-check",
      AGENT_BROWSER_SOCKET_DIR: "/tmp/ct-alt-chat-browser-sockets",
      AGENT_BROWSER_EXECUTABLE_PATH: "/usr/bin/chromium",
      XDG_CONFIG_HOME: "/tmp/ct-alt-chat-chrome-config",
      XDG_CACHE_HOME: "/tmp/ct-alt-chat-chrome-cache",
    };
    for (const args of [
      ["open", "http://127.0.0.1:5193/chat-test-fixture"],
      ["snapshot", "-i"],
      [
        "eval",
        'document.body.innerText.trim().length > 0 && !document.querySelector("[data-nextjs-dialog]")',
      ],
      ["screenshot", "test-results/chat-gut-check.png"],
      ["open", "http://127.0.0.1:5193/"],
      ["close"],
    ]) {
      const result = spawnSync(
        process.env.CT_ALT_AGENT_BROWSER,
        ["--args", "--no-sandbox", ...args],
        { env: browserEnv, encoding: "utf8", timeout: 30000 },
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
      "playwright.chat.config.ts",
    ],
    { stdio: "inherit", env: process.env },
  );
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", resolve);
  });
  rmSync(route, { recursive: true });
  rmSync(".next/dev/types", { recursive: true, force: true });
  const generated =
    /\n<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->\n/;
  if (!originalGuidance.includes("<!-- BEGIN:nextjs-agent-rules -->")) {
    writeFileSync(
      "AGENTS.md",
      readFileSync("AGENTS.md", "utf8").replace(generated, ""),
    );
  }
}
