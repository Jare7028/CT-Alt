# Project boundaries

- Work only in this independent repository and its explicitly verified resources.
- Never modify or connect to another application's deployment, Auth or database.
- This repository is public: no secrets, credentials, private documents or real workforce data.
- No spending, paid upgrades or usage-billed provisioning is authorized.
- Build Agents and their permissions first after independent service setup, then client rotas, then chat. Preserve the full workforce scope in the roadmap.
- Use synthetic data and enforce permissions at the server/database boundary. UI hiding is not authorization.
- Add feature-level tests for tenant isolation, permissions and scheduling edge cases with implementation.
- Run `npm run check` and `npm run build` before pushing changes.
- Consult installed Next.js documentation under `node_modules/next/dist/docs` before changing framework integration.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
