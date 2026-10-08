# Container returns backed by the BCRS refund receipt

Date: 2026-10-08. Status: approved in chat (option 1, AI reads the receipt).

## 1. Goal

A container return counts only when the student uploads a screenshot of the BCRS deposit refund that DBS PayLah! or SimplyGo EZ-Link recorded. The AI reads the screenshot; the app applies the rules. Container returns stop being honour-based, and the report can say they are "evidenced by the BCRS refund record".

The plain "enter a number" logging is removed.

## 2. Facts this relies on (NEA)

- BCRS adds a 10¢ deposit to eligible plastic bottles and metal cans (150 ml to 3 L with the deposit mark).
- At a Return Right machine the refund goes to SimplyGo EZ-Link (tap the card) or DBS PayLah! (scan the PayLah QR). It arrives straight away.
- So containers = refund amount ÷ 10¢.

Source: https://www.nea.gov.sg/our-services/waste-management/beverage-container-return-scheme/for-consumers

Not confirmed: the exact wording of the refund line in each app's history. The prompt describes what to look for in general terms, and the rules don't depend on a merchant name. Real screenshots are needed to tune the prompt (see §9).

## 3. Student flow

1. Log → Container returns → **Upload refund screenshot** (picks from the photo library; no camera).
2. The app shrinks it to at most 1600 px on the long side (screenshots are tall; 1024 px makes the text too small) and uploads.
3. Success: a toast such as "3 containers returned · +15", or "…, daily limit reached".
4. Failure: one plain sentence (§5). Nothing is logged.

There is no review step: the student cannot edit what was read, because that would undo the proof.

## 4. API

`POST /api/returns/receipt`, students only, body `{ image: { mime, base64 } }`, same 3 MB body limit and image checks as meal photos.

Order:
1. Image valid (`decodeImage`) → else 400 `invalid_image`.
2. Image hash unused → else 409 `duplicate_photo`.
3. Take an AI call (`takeAiCall`) → else 429 `ai_limit`.
4. AI read (`aiJson` with `RECEIPT_PROMPT`, `validateReceipt`). A mock answer (AI off or failing) → 503 `receipt_unavailable`.
5. `checkReceipt` (§5) → 422 / 409 with its code.
6. Insert with the receipt cap (§6). A UNIQUE clash on `image_hash` → 409 `duplicate_photo`; on `receipt_key` → 409 `receipt_claimed`.

201 response: `{ points, capped, containers, provider, refunded_at }` (`refunded_at` as SGT ISO).

`POST /api/returns` is removed.

## 5. Rules (pure function in `src/worker/lib/receipt.ts`)

AI reply shape (validated):
`{ is_bcrs_refund: boolean, provider: "paylah" | "simplygo" | null, amount_cents: integer | null, refunded_at: "YYYY-MM-DD HH:MM" | null }`.
The prompt gives today's SGT date so a screenshot without a year resolves to this year. If the screenshot shows several transactions, the AI reads the first BCRS refund.

`checkReceipt(read, now, joinedAt)`:

| Check | Error code | Message |
|---|---|---|
| `is_bcrs_refund` true, `provider`, `amount_cents` and `refunded_at` present | 422 `not_receipt` | "Couldn't find a BCRS deposit refund in that screenshot. Upload the refund from PayLah! or SimplyGo." |
| `amount_cents` a positive multiple of 10, at most 2000 (200 containers) | 422 `bad_amount` | "That refund amount doesn't match 10¢ per container." |
| Refund not more than 10 min in the future, not older than 3 days | 422 `receipt_date` | "Upload a refund from the last 3 days." |
| Refund minute not before the student joined | 422 `receipt_date` | "That refund is from before you joined." |

Result: `{ containers: amount_cents / 10, refundedAt (ms), key: "<provider>:<YYYY-MM-DDTHH:MM>:<amount_cents>" }`.

The key is global, so the same refund can't be claimed twice by anyone, including through a different screenshot of it.

## 6. Points and data

- Points = containers × `points_container_return` (5).
- New setting `receipt_daily_cap` (50), editable in Admin → Points and limits. It caps the sum of the student's `source = 'receipt'` points today (SGT).
- The 30-point self-reported cap now excludes `source = 'receipt'` rows, so the two caps are independent.
- Row: `category = waste`, `type = container_return`, `verified = 0`, `source = receipt`, `image_hash`, `receipt_key`, `detail = { count, provider, amount_cents, refunded_at, ai: "live" }`. `kg_co2e` stays null.
- The image is never stored. No name, account or reference number is stored.

Migration `0005_receipt_returns.sql` rebuilds `activities` (SQLite can't change a CHECK): `source` allows `'receipt'`, plus a new `receipt_key TEXT UNIQUE`. No table references `activities`, so the rebuild is copy → drop → rename, then the two indexes are recreated. Existing rows (including seeded `manual` returns) are kept.

## 7. Elsewhere

- Activities CSV: two new columns at the end, `receipt_provider` and `refunded_at_sgt`.
- Log screen: the stepper and "Log returns" button are replaced by the upload button and one line: "Bottles and cans returned under the Beverage Container Return Scheme. Upload the refund screenshot from DBS PayLah! or SimplyGo: 10¢ back means one container, +5 each."
- Docs: demo checklist, `docs/claude-handoff.md` §3.6, README.

## 8. Testing

- `checkReceipt`: each row of §5, the boundaries (3 days, 10 min, join minute), the key format.
- `validateReceipt`: wrong types, unknown provider, bad date strings.
- Route (AI faked through `AI_FETCH`): success with points and row contents; mock → 503; duplicate image; same refund through a different image (another user) → `receipt_claimed`; cap at 50 and independence from the 30-point cap in both directions; AI call counted; students only; old `/api/returns` gone.
- Migration: existing rows survive; `source = 'receipt'` accepted.
- CSV: the new columns.

## 9. Limits (say these in the report)

- A convincingly edited screenshot can still get through. The checks stop reuse and sharing, not forgery.
- Students without PayLah! or SimplyGo can't log returns.
- The prompt was written without real screenshots; it should be checked against one or two real ones before the demo.
- Out of scope: several refunds from one screenshot, admin review, any link to BCRS's own data.
