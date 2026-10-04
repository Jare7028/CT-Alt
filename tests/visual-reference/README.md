# Synthetic directory controls review

All captures here render synthetic Northstar Demo fixtures. They contain no private reference images or real workforce data. The historical crop measurements guide toolbar spacing; these captures do not establish current Connecteam full-screen pixel parity.

Run `npm run test:controls` with no other dev server in this checkout. The disposable local route/server uses port 5181 and blocks external requests. It exercises the expanded 190px sidebar at 1314px (1084px matched card), 1184px (954px real narrower card), 900px (670px card), and the 390px mobile layout (366px card).

`controls-after-*` shows the initial directory; `controls-after-crop.png` records the matched 1084px card controls. `controls-actions-*` captures horizontally scrolled row actions, including hidden-first-name layouts. Automated checks cover no page overflow, heading offsets, all-matching versus selected export, column hiding, action containment within table cells and their scroll viewport, keyboard Edit/Archive activation with cancellation, and the fallback View link focus. The column chooser has an explicit Close control because its fixed panel may overlap the original summary.

Real local Auth/API/browser tests and the integrated shell review remain separate release checks.

`chat-search-integrated-desktop.png` is our synthetic signed local employee conversation-search capture with literal Unicode/body escaping and integrated Quick Tasks navigation; it contains no real workforce or competitor assets.

`time-off-integrated-desktop-review.png` is our synthetic signed owner team-review capture after employee unknown-response recovery and audited approval; all names/notes are synthetic.

`updates-integrated-desktop-review.png` is the full signed synthetic owner Updates management capture with exact counts over 1000 and separate recipient viewed/confirmed statuses. `updates-integrated-desktop-viewport.png` is its unscaled first 1444×960 viewport excerpt for legible desktop review. Both show our own CT Alt output; no real recipient records or reference assets are included.

`updates-export-integrated-desktop-review.png` is our signed synthetic owner desktop capture after exporting the complete confirmed subset of a500-recipient update, showing distinct viewed/confirmed counts and50 displayed statuses. Names include deliberate Unicode/formula fixtures; no real workforce records or competitor assets are included.
