# Desktop visual reference

The owner selected the standard Connecteam desktop layout on4 October2026 and asked for close pixel matching. This pass prioritises the shared shell and Job scheduling. It retains CT Alt branding, original implementation and existing access rules.

## Reference evidence and limits

- Official guide: https://help.connecteam.com/en/articles/4100339-starting-guide-to-the-job-scheduler . Its January2026 lobby image is2048×1100. Scaling that published image to1444px yields an approximately56px topbar,196px sidebar,256×327px lobby cards and20px card gaps. These are measurements of a published reference image, rather than CSS measurements from an authenticated account.
- The same current guide embeds a calendar example with December2023 sample dates. It supports compact rows, white rounded title/content panels, date totals and filled published versus outlined draft shifts. It does not establish the exact current logged-in calendar layout.
- The public https://app.connecteam.com/ launch pad was inspected in a fresh, unsigned browser at1444×960. Its computed font family is Noto Sans. CT Alt self-hosts separately sourced Google Fonts Noto Sans under the included SIL Open Font License.
- No authenticated Connecteam session was available, and none was claimed. Public competitor screenshots/assets remain outside the repository. The app uses original icons/calendar illustration and synthetic CT Alt screenshot fixtures.

## Implemented visual scope

The shell uses a56px header,196px sidebar, Noto Sans, updated spacing/colour tokens and the standard section order: Operations, Communication, HR & Skills. Job scheduling replaces the custom Client Rotas menu name without changing its route. Existing accessible navigation, collapse, company scope and account controls are retained. Unsupported modules remain disabled and labelled through accessibility text/tooltips.

The scheduler lobby uses a rounded white titlebar, counted Active/Archived tabs, search/Add new controls and three-column cards with original calendar art, actual assignment counts and permitted admin initials. The existing real Reload control is retained where the reference has Filter; no unsupported filter action is presented. Card titles and Access schedule use the existing selection handler.

## Rendered evidence

An isolated1444×776 CT Alt render with synthetic fixtures measured header56px/sidebar196px; lobby card positions235,511,787 at y330, each256×327px. No viewport overflow or browser runtime error was observed. Those measurements apply to this exact viewport and fixture, not every content length or browser. The existing shell browser checks passed desktop navigation, keyboard/skip-link, collapse, directory controls and mobile containment.

The rendered calendar was compared with the official guide image: white rounded title/content panels, compact row/header spacing,40px controls,55px shift cards and unambiguous month/year range. A fresh-route screenshot caught missing global screen-reader styles; the helper was moved to globals.css so Date/Users labels and additional shift/status text stay accessible without inflating the layout. The corrected capture was inspected before signed acceptance.

Original CT Alt synthetic captures: [Lobby](screenshots/scheduler-lobby-desktop-reference-pass.png), [Calendar](screenshots/scheduler-calendar-desktop-reference-pass.png), [Users/shared shell](screenshots/shell-after-desktop.png). These reference-pass captures use intercepted local fixture GET responses, not real Auth or production data. All174 existing config checks and whole check passed. Independent frozen-source reviews of shared shell, scheduler and final global utility found no blockers. The initial signed suite found narrow-screen overflow. The first CSS fix contained visible controls, but a second run caught clipped absolute metadata escaping the table scroller. A browser diagnostic measured the offending hidden text at x525/right526 in a390px viewport. Explicitly anchoring the shared utility fixed this: document width390 and no escaped absolute descendants. All seven signed production-build cases then passed37seconds.

The final signed screenshot inspection also caught long shift titles expanding the weekly table. Definite width and day-count minimum now preserve equal columns while allowing month/narrow scrolling. A long-title render measured the table and scroller at1168px with all seven date columns approximately139px, and no horizontal scroll at1444px. Final source passed a fresh seven-case signed production-build run in36.4seconds after that geometry fix. Whole check and production build passed; the fixture lock, private fixture files and owned services were cleaned up. No assertion was removed or relaxed. Existing database migrations and server/API logic are unchanged.


Signed local Auth captures from the final build: [Lobby](screenshots/scheduler-auth-lobby-desktop.png) and [Owner calendar](screenshots/scheduler-auth-owner-desktop.png). The original retained test calls its owner-page output `rotas-manager-desktop.png`; the committed filename identifies the actual owner actor. These use genuine isolated Auth/API/database/browser execution with synthetic fixtures, not hosted workforce data. All19 applied migration files, lib and app/api are byte-for-byte unchanged against released main95b991c.
