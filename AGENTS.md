# Project boundaries

- Work only in this independent repository and its explicitly verified resources.
- Never modify or connect to another application's deployment, Auth or database.
- This repository is public: no secrets, credentials, private documents or real workforce data.
- No spending, paid upgrades or usage-billed provisioning is authorized.
- Build client rotas first after independent service setup. Preserve the full workforce scope in the roadmap.
- Use synthetic data and enforce permissions at the server/database boundary. UI hiding is not authorization.
- Add feature-level tests for tenant isolation, permissions and scheduling edge cases with implementation.
- Run `npm run check` and `npm run build` before pushing changes.
- Consult installed Next.js documentation under `node_modules/next/dist/docs` before changing framework integration.
