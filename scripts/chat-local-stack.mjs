// Local acceptance only. Runner verifies CT Alt and owns every named resource.
// Cached public Supabase components; no hosted API, Auth, email or storage calls.
import { spawnSync } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
if (
  spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).stdout.trim() !== "https://github.com/Jare7028/CT-Alt.git"
)
  throw Error("CT Alt checkout required");
const prefix = "ct-alt-chat-acceptance";
const secret = randomBytes(48).toString("base64url");
const password = randomBytes(24).toString("base64url");
function docker(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout;
}
function token(role) {
  const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const s =
    enc({ alg: "HS256", typ: "JWT" }) +
    "." +
    enc({
      iss: "supabase-demo",
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    });
  return s + "." + createHmac("sha256", secret).update(s).digest("base64url");
}
docker(["network", "create", prefix]);
docker([
  "run",
  "--pull=never",
  "--label",
  "ct-alt-module=chat-acceptance",
  "-d",
  "--name",
  prefix + "-db",
  "--network",
  prefix,
  "--network-alias",
  "db",
  "--tmpfs",
  "/var/lib/postgresql/data",
  "-e",
  "POSTGRES_PASSWORD=" + password,
  "-e",
  "POSTGRES_DB=postgres",
  "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
]);
let ready = false;
for (let i = 0; i < 60; i++) {
  if (
    spawnSync(
      "docker",
      [
        "exec",
        prefix + "-db",
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      ],
      { stdio: "ignore" },
    ).status === 0
  ) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
if (!ready) throw Error("Owned database unavailable");
docker(
  [
    "exec",
    "-i",
    prefix + "-db",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
  ],
  `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login password '${password}';grant anon,authenticated,service_role to authenticator;create role supabase_auth_admin login createrole password '${password}';create schema auth authorization supabase_auth_admin;alter role supabase_auth_admin set search_path=auth;grant all on schema public to supabase_auth_admin;`,
);
docker([
  "run",
  "--pull=never",
  "--label",
  "ct-alt-module=chat-acceptance",
  "-d",
  "--name",
  prefix + "-auth",
  "--network",
  prefix,
  "--network-alias",
  "auth",
  "-e",
  "GOTRUE_API_HOST=0.0.0.0",
  "-e",
  "GOTRUE_API_PORT=9999",
  "-e",
  "API_EXTERNAL_URL=http://127.0.0.1:54821/auth/v1",
  "-e",
  "GOTRUE_DB_DRIVER=postgres",
  "-e",
  `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@db:5432/postgres?sslmode=disable`,
  "-e",
  "GOTRUE_SITE_URL=http://127.0.0.1:5194",
  "-e",
  "GOTRUE_DISABLE_SIGNUP=true",
  "-e",
  "GOTRUE_JWT_ADMIN_ROLES=service_role",
  "-e",
  "GOTRUE_JWT_AUD=authenticated",
  "-e",
  "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
  "-e",
  "GOTRUE_JWT_SECRET=" + secret,
  "-e",
  "GOTRUE_JWT_EXP=3600",
  "-e",
  "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
  "-e",
  "GOTRUE_EXTERNAL_PHONE_ENABLED=false",
  "-e",
  "GOTRUE_MAILER_AUTOCONFIRM=true",
  "ghcr.io/supabase/gotrue@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b",
]);
let migrated = false;
for (let i = 0; i < 80; i++) {
  const r = spawnSync(
    "docker",
    [
      "exec",
      prefix + "-auth",
      "wget",
      "-Y",
      "off",
      "-qO-",
      "http://127.0.0.1:9999/health",
    ],
    { encoding: "utf8" },
  );
  if (r.status === 0) {
    migrated = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!migrated) throw Error("Real Auth migration failed");
docker(
  [
    "exec",
    "-i",
    prefix + "-db",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
  ],
  `grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;`,
);
for (const file of [
  "20261003143058_workforce_foundation.sql",
  "20261003153745_agents_records.sql",
  "20261003171238_chat_conversations.sql",
])
  docker(
    [
      "exec",
      "-i",
      prefix + "-db",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
    ],
    readFileSync("supabase/migrations/" + file, "utf8"),
  );
docker([
  "run",
  "--pull=never",
  "--label",
  "ct-alt-module=chat-acceptance",
  "-d",
  "--name",
  prefix + "-rest",
  "--network",
  prefix,
  "--network-alias",
  "rest",
  "-e",
  `PGRST_DB_URI=postgres://authenticator:${password}@db:5432/postgres`,
  "-e",
  "PGRST_DB_SCHEMAS=public",
  "-e",
  "PGRST_DB_ANON_ROLE=anon",
  "-e",
  "PGRST_JWT_SECRET=" + secret,
  "ghcr.io/supabase/postgrest@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df",
]);
docker([
  "run",
  "--pull=never",
  "--label",
  "ct-alt-module=chat-acceptance",
  "-d",
  "--name",
  prefix + "-gateway",
  "--network",
  prefix,
  "-p",
  "54821:8000",
  "-e",
  "KONG_DATABASE=off",
  "-e",
  "KONG_DECLARATIVE_CONFIG=/tmp/kong.yml",
  "-e",
  "KONG_PROXY_LISTEN=0.0.0.0:8000",
  "-e",
  "KONG_ADMIN_LISTEN=off",
  "ghcr.io/supabase/kong@sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d",
  "sh",
  "-c",
  "while [ ! -f /tmp/kong.yml ]; do sleep 0.2; done; kong start; tail -f /dev/null",
]);
docker(
  ["exec", "-i", prefix + "-gateway", "sh", "-c", "cat > /tmp/kong.yml"],
  `_format_version: "2.1"\nservices:\n  - name: auth\n    url: http://auth:9999\n    routes:\n      - name: auth\n        paths: [/auth/v1/]\n        strip_path: true\n  - name: rest\n    url: http://rest:3000\n    routes:\n      - name: rest\n        paths: [/rest/v1/]\n        strip_path: true\n`,
);
writeFileSync(
  "/tmp/ct-alt-chat-status.json",
  JSON.stringify({
    API_URL: "http://127.0.0.1:54821",
    ANON_KEY: token("anon"),
    SERVICE_ROLE_KEY: token("service_role"),
    JWT_SECRET: secret,
  }),
  { mode: 0o600 },
);
console.log(
  "Owned local stack: real GoTrue Auth, PostgREST, PostgreSQL 17 and loopback Kong gateway.",
);
