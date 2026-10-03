# Synthetic directory controls review

All captures here render synthetic Northstar Demo fixtures. They contain no private reference images or real workforce data. The historical crop measurements guide toolbar spacing; these captures do not establish current Connecteam full-screen pixel parity.

Run `npm run test:controls` with no other dev server in this checkout. The disposable local route/server uses port 5181 and blocks external requests. It exercises the expanded 190px sidebar at 1314px (1084px matched card), 1184px (954px real narrower card), 900px (670px card), and the 390px mobile layout (366px card).

`controls-after-*` shows the initial directory; `controls-after-crop.png` records the matched 1084px card controls. `controls-actions-*` captures horizontally scrolled row actions, including hidden-first-name layouts. Automated checks cover no page overflow, heading offsets, all-matching versus selected export, column hiding, action containment within table cells and their scroll viewport, keyboard Edit/Archive activation with cancellation, and the fallback View link focus. The column chooser has an explicit Close control because its fixed panel may overlap the original summary.

Real local Auth/API/browser tests and the integrated shell review remain separate release checks.

`chat-search-integrated-desktop.png` is our synthetic signed local employee conversation-search capture with literal Unicode/body escaping and integrated Quick Tasks navigation; it contains no real workforce or competitor assets.
