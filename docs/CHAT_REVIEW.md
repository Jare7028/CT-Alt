# Chat first slice — review and integration

Independent CT Alt implementation. Reference: [Connecteam Starting Guide to the Chat](https://help.connecteam.com/en/articles/5839181-starting-guide-to-the-chat), checked 3 October 2026. The verified workflows are Add New / New Chat / New Group, direct messaging, manually selected group members, and description context above a group conversation. CT Alt uses its own code, copy and visual styling; no account data, screenshots, proprietary assets or employee information were imported. Also inspected the public desktop image in [Chat (for Users)](https://help.connecteam.com/en/articles/6712594-chat-for-users). The original implementation follows its white pane headers, pale blue selection/thread backdrop, pill primary action, rounded search and circular avatar geometry. The image was downloaded only to a temporary reference path, never committed. This PR does not claim pixel equivalence; unimplemented controls are not presented as working features.

## Delivered

- `/chat?company=<tenant UUID>` with current signed-user company access; company selection, conversation list, conversation-name search, message preview and unread badge, direct/group creation, selected-user picker, descriptions, text composer and persistent history.
- Retry retains the original client ID and text after a lost response. Database retries return the original message; changing the body with the same ID fails.
- Server sequence allocated while holding the conversation row lock; reads sort by sequence. Initial history shows the last 100 messages, with earlier-message pagination. Poll/reconnect drains all newer pages before marking read.
- Monotonic per-user read cursor. Unread excludes the user's own sends.
- Restricted management groups admit only current owners/admins/managers. Demotion, tenant suspension, membership suspension and conversation removal revoke database/API access without token refresh.

## Security and integration

New proposed migration: `supabase/migrations/20261003171238_chat_conversations.sql`. **Not applied to hosted Supabase. Parent owns final migration version, independent review, integration and deployment.** Depends on the existing workforce foundation only; no existing migration was edited. No Auth, `lib/agent-types.ts`, shared navigation, hosted settings, publications or storage changes.

Tables: `chat_conversations`, `chat_members`, `chat_messages`, `chat_reads`. Every table enables RLS and revokes default browser writes. SELECT policies call a private membership check tied to `auth.uid()`, current active tenant/company membership and conversation membership. User-editable metadata never authorizes access. Even tenant admins cannot access private conversations they have not joined.

`public.chat_action` is an invoker wrapper around the intentionally privileged, non-exposed `chat_private.act` function. EXECUTE is revoked from PUBLIC/anon and granted only to authenticated. Definers use an empty search path, fully qualified tables, confirmed non-anonymous identities and live authorization checks. Mutations lock the tenant, actor membership, conversation and conversation membership rows to serialize with suspension/removal; creation validates and locks all target tenant memberships. Database constraints bind every participant and message to the conversation's tenant. App requests use shared approved public configuration and the signed user's cookie; there is no app service key.

Chat uses five-second polling with online/visibility refresh. Server access is revoked immediately for subsequent requests. Already-rendered content clears when the next request observes removal/suspension; polling is not instantaneous browser revocation. No sensitive payload is stored in localStorage. No Realtime or storage capability is enabled. Any future implementation must separately prove subscription/storage access after removal and suspension, with parent coordination before hosted changes.

The only allowed hosted target remains `clytszmnrssgvnlwfbrm`; deployment remains `https://ct-alt.vercel.app`. This work performed no hosted database operations, deployment, staff messaging, invites, credential provisioning or billing changes. Training-App checkout and containers were untouched.

The only shared test-runner change imports module-specific race checks and adds `chat.sql` to its suite. No main navigation entry is added; parent can integrate the `/chat` route after review.

## Verification

- `npm run check`: ESLint and TypeScript.
- `npm run build`: production compilation; `/chat` and `/api/chat` included.
- `npm run test:config`: configuration boundary, auth redirect and state reconciliation tests.
- `npm run test:db`: actual PostgreSQL 17 in a fresh network-disabled Docker container, with synthetic users and no published port. Includes existing foundation/Agents suites; chat tests cover cross-tenant and private access, direct write denial, role restrictions, immediate revocation, retry/deduplication, ordering and read cursors. Concurrent tests cover duplicate sends, ordered sends, suspension and removal versus queued sends.
- `node scripts/test-chat-browser.mjs`: temporary component harness, explicitly disabled database configuration, intercepted synthetic API responses, owned loopback port 5193. Tests lost-response retry, 205-message reconnect catch-up, revocation cleanup, management-group selection and mobile overflow. Screenshots written to ignored `test-results/chat-desktop.png` and `chat-mobile.png`. The temporary route is removed even after failure. This is component/browser verification, not signed-in full-stack Auth integration.

## Remaining complete scope

Attachments and storage authorization; message replies; search; admin-only group posting and anonymous admin posting; smart/dynamic groups; member add/remove/leave management UI; moderation/delete/audit workflows; read receipts and group read-by details; formatting; broadcast messages; starred messages; chat settings/communication restrictions; cross-feature chat entry points; Realtime with proven revocation; unread totals in shared navigation; full signed-in local Supabase browser/API tests; full desktop/mobile interaction and appearance verification beyond the public reference image; archive/unarchive, pin, mute and mark-unread actions; chat information panel. Group creation currently allows any active member for ordinary selected-user groups; more granular chat permissions require the settings slice. The initial page loads up to 100 messages, with earlier pagination; conversation list and chat picker still need pagination for large workforces.
