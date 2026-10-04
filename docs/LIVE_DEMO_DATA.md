# Live demo data

On 4 October 2026 the owner explicitly authorised labelled fictional data in the verified CT Alt company for testing. The first seed was committed atomically and replayed once with no duplicates. Every pre-existing application/Auth row, current login, membership and setting was preserved. No invitations, email, messages or notifications were sent.

| Data | Added |
| --- | ---: |
| Demo directory records | 21 |
| Demo schedules | 3 |
| Published four-hour shifts | 60 |
| Schedule jobs | 6 |
| Clock jobs | 6 |
| Quick Tasks | 12 (9 published/open, 3 drafts) |
| Updates drafts | 6 |
| Knowledge Bases | 2 drafts, each with one folder and two text items |
| Forms drafts | 2 |

Schedules span two weeks before/after 4 October 2026 and include shifts on the anchor date. Twenty fictional staff records remain unlinked to Auth. One newly created Demo Coordinator record links to the unchanged existing owner account so Clock and assignment workflows can be tested. No historical clock entries, views, submitted responses or employee accounts were invented.

All creates use the existing recorded, signed-owner RPCs apart from one explicitly reviewed update linking only the newly created exact Demo Coordinator to the existing owner. Original rows were snapshotted within the transaction and required to survive byte-for-byte. Applied migration statements and function/grant/RLS/trigger metadata were checked before and after. No permanent seed helper tables or functions were added.

Private seed SQL and credentials remain outside this public repository. The seed is not a cleanup/reset facility. Edited demo records must never be blindly overwritten, and removing demo data requires its own reviewed operation.

Requests demo cards will be added through the new recorded Requests RPC after its schema and consumer release are verified.
