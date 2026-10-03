import "./chat-local-stack.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const name = "ct-alt-chat-acceptance-db";
const inspection = spawnSync("docker", ["inspect", name], { encoding: "utf8" });
if (
  inspection.status !== 0 ||
  JSON.parse(inspection.stdout)[0].Config.Labels["ct-alt-module"] !==
    "chat-acceptance"
)
  throw Error("Wrong owned database");
const result = spawnSync(
  "docker",
  ["exec", "-i", name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
  {
    input: readFileSync(
      "supabase/migrations/20261003183901_chat_group_permissions.sql",
    ),
    encoding: "utf8",
  },
);
if (result.status !== 0) throw Error(result.stderr || "Group migration failed");
