// Ephemeral CT Alt-only synthetic browser fixture. No supplied URLs or keys.
// Stop with Ctrl-C; only containers carrying this run's random label are removed.
import { startOwnedStorage } from "./storage-provider-fixture.mjs";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
if (spawnSync('git',['remote','get-url','origin'],{cwd:root,encoding:'utf8'}).stdout.trim() !== 'https://github.com/Jare7028/CT-Alt.git') throw Error('Only CT Alt fixtures permitted');
const { createClient } = createRequire(root + '/package.json')('@supabase/supabase-js');
const suffix = randomUUID().slice(0, 8);
const network = "ct-alt-rotas-" + suffix;
const db = "supabase_db_ct-alt-independent",
  auth = network + "-auth",
  rest = network + "-rest";
const mail = network + "-mail";
const containers = [];
const docker = (args, input) => {
  const r = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 30000,
  });
  if (r.status !== 0) throw Error((r.stderr || "Docker failed").replaceAll(process.env.CT_ALT_KB_FILE_HMAC_KEY || "[no-key]", "[synthetic-private-key]"));
  return (r.stdout + (args[0] === "logs" ? r.stderr : "")).trim();
};
const sql = (s) =>
  docker(
    [
      "exec",
      "-i",
      db,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    s,
  );
function verify(name) {
  if (
    !containers.includes(name) ||
    docker([
      "inspect",
      name,
      "--format",
      '{{index .Config.Labels "ct-alt.test"}}',
    ]) !== suffix
  )
    throw Error("Local fixture identity mismatch");
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = randomBytes(48).toString("hex");
const token = (role) => {
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      role,
      iss: "supabase-demo",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    }),
  ).toString("base64url");
  return (
    head +
    "." +
    body +
    "." +
    createHmac("sha256", secret)
      .update(head + "." + body)
      .digest("base64url")
  );
};
const key = token("anon"),
  service = token("service_role");
let gateway, storageProvider, pendingStorageCleanup;
async function cleanup() {
  gateway?.close();
  (storageProvider?.cleanup ?? pendingStorageCleanup)?.();
  for (const c of containers.reverse()) {
    verify(c);
    docker(["rm", "-f", c]);
  }
  docker(["network", "rm", network]);
}
process.on("SIGTERM", () => {
  void cleanup().finally(() => process.exit());
});
process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit());
});
try {
  if (
    !readFileSync(root + "/supabase/config.toml", "utf8").includes(
      'project_id = "ct-alt-independent"',
    )
  )
    throw Error("Project mismatch");
  if (spawnSync('docker', ['inspect', db], {stdio:'ignore'}).status === 0) throw Error('Refusing existing local fixture database');
  docker(["network", "create", "--label", "ct-alt.test=" + suffix, network]);
  docker([
    "run",
    "-d",
    "--name",
    db,
    "--network",
    network,
    "--label",
    "ct-alt.test=" + suffix,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_DB=postgres",
    "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
  ]);
  containers.push(db);
  for (let i = 0; i < 60; i++) {
    const r = spawnSync("docker", [
      "exec",
      db,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ]);
    if (r.status === 0) break;
    await delay(250);
  }
  verify(db);
  sql(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;",
  );
  docker(['run','-d','--name',mail,'--network',network,'--label','ct-alt.test='+suffix,'-p','127.0.0.1:54824:8025','axllent/mailpit:v1.24.1@sha256:4873e5a441ed368f1e98a832f61257a033859f5e829542cd03fb772d2282ea4e']);
  containers.push(mail);
  docker([
    "run",
    "-d",
    "--name",
    auth,
    "--network",
    network,
    "--label",
    "ct-alt.test=" + suffix,
    "-p",
    "127.0.0.1:54825:9999",
    "-e",
    "GOTRUE_API_HOST=0.0.0.0",
    "-e",
    "GOTRUE_API_PORT=9999",
    "-e",
    "API_EXTERNAL_URL=http://127.0.0.1:54821",
    "-e",
    "GOTRUE_SITE_URL=http://127.0.0.1:5180",
    "-e",
    "GOTRUE_DB_DRIVER=postgres",
    "-e",
    "GOTRUE_DB_DATABASE_URL=postgres://postgres@" +
      db +
      ":5432/postgres?search_path=auth",
    "-e",
    "GOTRUE_JWT_SECRET=" + secret,
    "-e",
    "GOTRUE_JWT_AUD=authenticated",
    "-e",
    "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    "-e",
    "GOTRUE_JWT_ADMIN_ROLES=service_role",
    "-e",
    "GOTRUE_DISABLE_SIGNUP=false",
    '-e', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true',
    '-e', 'GOTRUE_EXTERNAL_PHONE_ENABLED=false',
    '-e', 'GOTRUE_MAILER_AUTOCONFIRM=false',
    '-e', 'GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:5180/auth/callback',
    '-e', 'GOTRUE_SMTP_HOST=' + mail,
    '-e', 'GOTRUE_SMTP_PORT=1025',
    '-e', 'GOTRUE_SMTP_ADMIN_EMAIL=ct-alt@example.test',
    '-e', 'GOTRUE_SMTP_SENDER_NAME=CT Alt local tests',
    '-e', 'GOTRUE_SMTP_MAX_FREQUENCY=60s',
    '-e', 'GOTRUE_RATE_LIMIT_EMAIL_SENT=100',
    '-e', 'GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify',
    '-e', 'GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify',
    '-e', 'GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify',
    '-e', 'GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify',
    "ghcr.io/supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b",
  ]);
  containers.push(auth);
  let healthy = false;
  for (let i = 0; i < 80; i++) {
    verify(auth);
    try {
      healthy = (await fetch("http://127.0.0.1:54825/health")).ok;
    } catch {}
    if (healthy) break;
    await delay(250);
  }
  if (!healthy) {
    console.error(docker(["logs", "--tail", "8", auth]));
    throw Error("Local Auth did not become healthy");
  }
  verify(db);
  sql(
    "create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;",
  );
  const migrationFiles = readdirSync(root + "/supabase/migrations").filter(f => f.endsWith(".sql")).sort();
  const requiresStorage = migrationFiles.some(f => f.endsWith("_knowledge_base_files.sql"));
  if (requiresStorage || process.env.CT_ALT_FIXTURE_STORAGE === "1") {
    storageProvider = await startOwnedStorage({dbContainer:db,dbName:"postgres",fixtureLabel:{key:"ct-alt.test",value:suffix},jwtSecret:secret,anonKey:key,serviceKey:service,networkName:network,publishPort:54827,postgrestUrl:`http://${rest}:3000`,onCleanupReady:cleanup=>{pendingStorageCleanup=cleanup;}});
  }
  for (const file of migrationFiles) {
    verify(db);
    sql(readFileSync(root + "/supabase/migrations/" + file, "utf8"));
  }
  if (storageProvider) {
    storageProvider.verify();
    docker(['exec','-i',storageProvider.containerName,'node','-'], `(async()=>{
      const headers={Authorization:'Bearer '+process.env.SERVICE_KEY,'Content-Type':'application/json'};
      const created=await fetch('http://127.0.0.1:5000/bucket',{method:'POST',headers,body:JSON.stringify({id:'ct-alt-knowledge-base',name:'ct-alt-knowledge-base',public:false,file_size_limit:2097152})});
      if(created.status!==200)throw Error('Synthetic private bucket creation failed: '+created.status);
      const read=await fetch('http://127.0.0.1:5000/bucket/ct-alt-knowledge-base',{headers});
      if(read.status!==200)throw Error('Synthetic private bucket verification failed: '+read.status);
      const bucket=await read.json();
      if(bucket.id!=='ct-alt-knowledge-base'||bucket.name!=='ct-alt-knowledge-base'||bucket.public!==false||bucket.file_size_limit!==2097152)throw Error('Synthetic private bucket scope or byte limit mismatch');
      console.log('Verified empty private synthetic bucket with 2 MiB limit');
    })().catch(e=>{console.error(e.message);process.exit(1)});`);
  }
  if (requiresStorage) {
    const hmacKey = process.env.CT_ALT_KB_FILE_HMAC_KEY;
    const hmacId = process.env.CT_ALT_KB_FILE_HMAC_KEY_ID;
    if (hmacKey || hmacId) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(hmacId ?? "") || !/^[A-Za-z0-9+/]+={0,2}$/.test(hmacKey ?? "") || Buffer.from(hmacKey,"base64").length < 32) throw Error("Invalid private synthetic file verifier configuration");
      sql(`insert into workforce_private.knowledge_file_verifier_keys(key_id,key_bytes,active) values ('${hmacId}',decode('${hmacKey}','base64'),true);`);
    }
  }
  docker([
    "run",
    "-d",
    "--name",
    rest,
    "--network",
    network,
    "--label",
    "ct-alt.test=" + suffix,
    "-p",
    "127.0.0.1:54826:3000",
    "-e",
    "PGRST_DB_URI=postgres://postgres@" + db + ":5432/postgres",
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    "PGRST_JWT_SECRET=" + secret,
    "-e",
    "PGRST_DB_MAX_ROWS=1000",
    "ghcr.io/supabase/postgrest:v16.4@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df",
  ]);
  containers.push(rest);
  gateway = createServer(async (req, res) => {
    try {
      const isAuth = req.url.startsWith("/auth/v1/");
      const isRest = req.url.startsWith("/rest/v1/");
      const isStorage = Boolean(storageProvider) && req.url.startsWith("/storage/v1/");
      if (!isAuth && !isRest && !isStorage) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (isStorage) storageProvider.verify(); else verify(isAuth ? auth : rest);
      const url =
        (isAuth ? "http://127.0.0.1:54825" : isStorage ? "http://127.0.0.1:54827" : "http://127.0.0.1:54826") +
        req.url.replace(isAuth ? "/auth/v1" : isStorage ? "/storage/v1" : "/rest/v1", "");
      const buffers = [];
      for await (const c of req) buffers.push(c);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers["content-length"];
      if (!headers.authorization) headers.authorization = "Bearer " + key;
      const upstream = await fetch(url, {
        redirect: "manual",
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(buffers),
      });
      res.writeHead(
        upstream.status,
        Object.fromEntries(
          [...upstream.headers].filter(
            ([k]) =>
              ![
                "content-encoding",
                "content-length",
                "transfer-encoding",
              ].includes(k),
          ),
        ),
      );
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(503);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(54821, "127.0.0.1", resolve);
  });
  const admin = createClient("http://127.0.0.1:54821", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accounts = {};
  const password = randomBytes(24).toString("base64url");
  const tenantA = "40000000-0000-4000-8000-000000000001",
    tenantB = "40000000-0000-4000-8000-000000000002";
  for (const [name, role] of [
    ["owner", "owner"],
    ["admin", "admin"],
    ["manager", "manager"],
    ["employee", "employee"],
    ["foreign", "owner"],
  ]) {
    verify(auth);
    const email = "ct-alt-" + name + "@example.test";
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (result.error)
      throw Error(
        "Synthetic local account creation failed: " + result.error.message,
      );
    accounts[name] = { id: result.data.user.id, email, password, role };
  }
  verify(db);
  sql(
    `insert into public.tenants(id,name,time_zone)values('${tenantA}','Synthetic North Company','Europe/London'),('${tenantB}','Synthetic South Company','America/New_York');`,
  );
  for (const [name, a] of Object.entries(accounts)) {
    verify(db);
    const t = name === "foreign" ? tenantB : tenantA;
    sql(
      `insert into public.tenant_memberships(tenant_id,user_id,display_name,role)values('${t}','${a.id}','Synthetic ${name}','${a.role}');insert into public.agents(tenant_id,user_id,first_name,last_name,phone,created_by)values('${t}','${a.id}','Synthetic','${name}','+447700900${{ owner: 201, admin: 202, manager: 203, employee: 204, foreign: 205 }[name]}','${name === "foreign" ? a.id : accounts.owner.id}');`,
    );
  }
  verify(db);
  sql("insert into public.agent_fields(tenant_id,key,label,required,position)values('40000000-0000-4000-8000-000000000001','client','Client',true,1);update public.agents set title='Synthetic '||last_name,team='North',custom_fields='{\"client\":\"Demo client\"}'::jsonb where tenant_id='40000000-0000-4000-8000-000000000001';update public.agents set first_name='Foreign',title='Synthetic foreign',team='South' where tenant_id='40000000-0000-4000-8000-000000000002';");
  writeFileSync(
    root + "/.env.local",
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54821\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    "/tmp/ct-alt-local-fixtures.json",
    JSON.stringify({
      url: "http://127.0.0.1:54821",
      key,
      jwtSecret: secret,
      fixtureLabel: suffix,
      tenantA,
      tenantB,
      accounts,
    }),
    { mode: 0o600 },
  );
  console.log(
    "Independent CT Alt loopback Auth/REST/Postgres/Mailpit ready with synthetic fixtures; no hosted connections or emails.",
  );
} catch (e) {
  console.error(e.message);
  await cleanup();
  process.exit(1);
}
