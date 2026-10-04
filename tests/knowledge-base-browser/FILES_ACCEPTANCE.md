# Private-file desktop synthetic acceptance

The retained 57 Knowledge Base regressions remain unchanged. `files.spec.ts`
adds 60 file cases using only original synthetic companies, Auth identities,
resource names, file bytes, and the API model in `file-helpers.ts`.

The latest complete run passed all 117 persistent regressions in 4.0 minutes:
57 retained Knowledge Base cases and 60 file cases. Two alternate-pane cases
first reproduced the prior defect: an already decoded file body created a
private object URL after the actual React search-submit or resource-insights
handler entered a different pane. With download cancellation at both entries,
they require zero URL creation, anchor clicks, downloads, and success notices
after releasing that body. Closing insights restores an enabled download button.

The earlier 116-case run included 115 regressions and one temporary desktop
capture case. The capture case was rerun successfully against the final padding
and captions, then removed with the temporary fixture route. The later
cancellation fix has no visual change. Targeted ESLint and
`tsc --noEmit --incremental false` passed.

Coverage includes create/replace multipart identity and revision binding, the
2 MiB boundary and supported picker types, permanent company allocation labels
and state counts, current denial clearing, field-free original-actor UUID
recovery after remount, unknown upload close versus durable-success finalize,
mismatched acknowledgements, held POST body departure and actual forced
refresh-handler guards, current attachment identity/version/size/header
validation, post-blob actor/company/role/refresh/departure fences, object URL
revocation, archived/depth-16 forced-handler guards, and reader downloads and
refreshes producing no additional views.

The browser model does not validate provider upload content or replace the
integrator's genuine Storage/Auth acceptance. Unsupported picker content is
still verified by the server. No hosted resources, browser JWTs, provider URLs,
keys, or external private assets are part of this fixture.

Synthetic verification used the root-granted exclusive loopback port 5195
window, webpack dev mode (the shared node_modules symlink is outside
Turbopack's worktree root), and a temporary `/knowledge-base-test-fixture` route
that imports the retained `fixture-page.tsx`. No fixture route is committed.
The agent-browser smoke found meaningful content, no framework overlay, and
expected controls; its browser session was closed. The owned dev process,
temporary route, and `.next/dev` cache were removed after verification.

Original synthetic desktop captures at 1444×1050 were visually inspected:
`/tmp/ct-alt-kb-files-detail-viewport.png`, `detail-full.png`, `replace.png`,
`add.png`, and `recovery.png` (each filename has the `ct-alt-kb-files-` prefix).
They show the current version, create/replace editor, truthful reserved and
retained budget, and unknown-upload recovery without private stored fields.
