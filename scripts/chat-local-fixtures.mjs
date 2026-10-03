import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const require = createRequire(new URL("../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
if (
  spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).stdout.trim() !== "https://github.com/Jare7028/CT-Alt.git"
)
  throw Error("CT Alt checkout required");
const binding = spawnSync(
  "docker",
  [
    "inspect",
    "--format",
    '{{index .Config.Labels "ct-alt-module"}} {{json .HostConfig.PortBindings}}',
    "ct-alt-chat-acceptance-gateway",
  ],
  { encoding: "utf8" },
);
if (
  binding.status !== 0 ||
  !binding.stdout.startsWith("chat-acceptance ") ||
  !binding.stdout.includes('"HostPort":"54821"')
)
  throw Error("Owned local gateway required");
const settings = JSON.parse(
  readFileSync("/tmp/ct-alt-chat-status.json", "utf8"),
);
if (settings.API_URL !== "http://127.0.0.1:54821")
  throw Error("Wrong local target");
if (
  !readFileSync("/tmp/ct-alt-chat-stack/supabase/config.toml", "utf8").includes(
    'project_id = \"ct-alt-chat-acceptance\"',
  )
)
  throw Error("Wrong independent stack");
const client = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tenant = "60000000-0000-4000-8000-000000000001";
const foreignTenant = "60000000-0000-4000-8000-000000000002";
const password = randomBytes(24).toString("base64url");
const accounts = {};
for (const [name, role] of [
  ["owner", "owner"],
  ["employee", "employee"],
  ["outsider", "admin"],
  ["manager", "manager"],
  ["foreign", "owner"],
]) {
  const email = `chat-acceptance-${name}@example.test`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  accounts[name] = { id: data.user.id, email, password, role };
}
for (const [table, rows] of [
  [
    "tenants",
    [
      { id: tenant, name: "Chat acceptance synthetic A" },
      { id: foreignTenant, name: "Chat acceptance synthetic B" },
    ],
  ],
  [
    "tenant_memberships",
    Object.entries(accounts).map(([name, a]) => ({
      tenant_id: name === "foreign" ? foreignTenant : tenant,
      user_id: a.id,
      display_name: `Synthetic ${name}`,
      role: a.role,
    })),
  ],
]) {
  const { error } = await client.from(table).insert(rows);
  if (error) throw error;
}
writeFileSync(
  "/tmp/ct-alt-chat-acceptance-fixtures.json",
  JSON.stringify({
    url: settings.API_URL,
    key: settings.ANON_KEY,
    tenant,
    foreignTenant,
    accounts,
  }),
  { mode: 0o600 },
);
writeFileSync(
  ".env.local",
  `NEXT_PUBLIC_SUPABASE_URL=${settings.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${settings.ANON_KEY}\n`,
  { mode: 0o600 },
);
console.log(
  "Five confirmed synthetic local Auth accounts and two tenants created.",
);
