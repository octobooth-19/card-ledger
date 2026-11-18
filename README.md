# Card Ledger

**Developer:** Dayana

Open [index.html](index.html) directly in a modern browser. Keep `parser.js` next to it. No build, server, dependencies,
account, or internet connection is needed. The dashboard is a standalone utility; it does not post to the ERP or
read its data.

The first launch shows roughly 300 synthetic SMS messages across six calendar months. The demo has three example
warning rows and two examples of foreign-currency purchases; no rates are set by default. Choose **Remove demo
messages** before or after importing your own data. **Reset to dummy data** replaces both messages and settings after
confirmation.

## Import from iPhone

1. In Shortcuts, create a shortcut using **Find Messages**, if available. Optionally filter by bank sender and date.
2. Pass the message bodies to **Combine Text** with two line breaks as the separator.
3. Use **Save to Files** (sometimes shown as **Save File**) to save a `.txt` file.
4. In Card Ledger, upload the file or paste the export into the message field. If your iOS version doesn't expose
   **Find Messages**, copy the SMS bodies manually, inserting a blank line between messages.

A CSV export can have a `Message`, `Text`, `Body`, or `SMS` column and optional `Sender` and `Timestamp` columns.
`Sender` should contain a supported bank name if the SMS body has no bank prefix. ISO timestamps with date, time, and
offset work best. Quote fields containing commas, newlines, or double quotes. Unsupported messages, verification
texts, and malformed rows with readable text remain visible with reasons in the import panel. A structurally invalid
CSV is rejected with an error so you can correct it and re-import.

Duplicate detection uses a stable hash of parsed identity (amount, merchant, timestamp, card, bank, currency, and type)
and normalized original text. Original text helps distinguish separate charges with different references. Re-imports
skip matching occurrences, but retain multiple occurrences in one source. If two messages are identical and exported
without separate timestamps or references, the app cannot distinguish a new charge from a re-import. For a known
distinct charge, select **Keep matching messages** and import just that charge.

## Read and manage the ledger

- The overview shows this month's net spend (purchases minus refunds/reversals), previous-month change, average
  and largest purchases, credits, and unresolved warnings. Declines and credit-limit notices never count as spend.
- Insights chart gross CAD purchases, before credits. Trend and weekday views need a date; undated purchases can
  still appear in the category, merchant, and card breakdowns. Budgets compare dated net CAD spend against recurring
  category targets for the selected month. Table filters do not change the overview, charts, or budgets.
- Hyperlinks connect the sections: **View transactions** and **View budgets** at the top, a category name in the
  **By category** chart (its purchases), and **View <category> transactions** on each budget (that category for the
  selected budget month) open the Transactions table with the matching filters applied.
- Search, sort, filter, and paginate the table. Use **Details** for the original SMS, available credit/limit, and
  warning reasons. Editing a category updates the merchant's exact-name override for past and future imports.
  Edit keyword lists in **Settings**; unmatched merchants default to Other.
- Enter your own **CAD per foreign unit** rates. Rates apply to all dates, not historical exchange-rate lookups.
  The original amount is preserved; conversion rounds to the nearest cent, half up. Without a rate, foreign purchases
  and credits are excluded from CAD aggregates. A bare `$` or `¥` does not identify a currency and is also excluded.
- Warnings flag eligible purchases above the configured CAD threshold, or purchases with the same bank/card, merchant,
  original amount and currency within ten minutes. Both purchases in a matching pair get flagged. Missing times or
  card numbers prevent matching; an explicit time zone is not compared with an unspecified time zone. Mark a warning
  reviewed or not suspicious to clear it from the pending count without hiding the reason. Use **View pending warnings**
  or **View all flagged transactions** in the overview to find them; the table shows each warning's reason alongside
  the merchant, and its status opens the review controls. Warnings are not proof of fraud.
- **Export filtered CSV** includes all matching rows, not just the current page. It includes original and converted
  amounts, category, card, type, review status, warning reason, and raw SMS. Formula-like text cells are prefixed with
  an apostrophe to prevent spreadsheet evaluation. The CSV is not a full settings or unparsed-message backup.

Messages and preferences are stored only in this browser's `localStorage`, and are not encrypted by the app. Avoid
importing private messages on a shared browser profile. File URL storage behavior varies by browser; moving the
files, switching profiles, or clearing site data can remove access to the saved ledger. Keep your source exports.

## Parser formats and tests

These are **illustrative** formats, not bank specifications. Banks may use different wording, short codes, or
locales. The parser recognizes numeric year-first dates, named months, and short numeric dates. Ambiguous short
numeric dates use month/day/year; two-digit years are in the 2000s. Keep CSV timestamps to distinguish messages
without embedded dates or times.

| Bank | Example |
| --- | --- |
| RBC | `RBC Alert: purchase of CAD 24.50 at Harbour Coffee on 2026-03-04 10:15; card ending in 4821` |
| TD | `TD Alert: CAD 24.50 refund from Harbour Coffee on 03/04/26 at 6:42 PM; card ending 7392` |
| Scotiabank | `Scotiabank: reversal alert: CAD 24.50 at Harbour Coffee on Mar 4, 2026; card ending 3108` |
| BMO | `BMO: declined for CAD 24.50 at Harbour Coffee; card ending 9054` |
| CIBC | `CIBC: USD 24.50 was charged at Harbour Coffee on 2026-03-04T10:15:00-05:00; card ending 6627` |

To add a bank, give it an anchored sender/SMS prefix and a transaction regex in the `banks` table in
[parser.js](parser.js). Set `order` to the capture indexes for status and amount. Reuse shared token parsing for
money, dates, cards, and limits when possible. Add a synthetic fixture to [parser.test.js](parser.test.js) that checks
the expected output, not merely that the pattern matched.

Run the dependency-free Node tests from this directory or the repository root:

```sh
node --test
```
