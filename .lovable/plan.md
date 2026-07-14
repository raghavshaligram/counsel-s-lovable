# Transactional Data Extraction

Add a **Transactions** mode to the existing Extract tool that turns the raw tables already produced by `extract-tables.ts` into typed rows for bank statements, invoices/receipts, and legal (LEDES-style) billing, plus a generic table extractor. Preview → edit → export CSV / XLSX. 100% on-device, no AI, no network.

## User flow

1. Left rail → **Extract** → new third mode chip **Transactions → CSV/Excel** (next to "Pages → PDF" and "Data → Excel").
2. Panel shows a **Document type** picker (`Auto-detect · Bank statement · Invoice/Receipt · Legal billing · Generic table`) with the auto-detected type pre-selected.
3. Click **Extract transactions** → runs the existing `extractTables` pipeline (silent OCR fallback stays intact), then the semantic parser for the chosen type.
4. Preview table in the inspector: columns are typed per document type. Each cell is editable; header row shows the mapped source column with a dropdown to remap if auto-mapping is wrong.
5. **Copy CSV**, **Download CSV**, **Download XLSX** buttons. XLSX includes a summary sheet for statements (opening/closing balance, totals by month, totals by category-guess).

## Detection engine (`src/lib/pdf/transactions/detect-type.ts`)

Sniff the first 2 pages of text to pick a type:

- **Bank statement** — presence of `\b(Statement|Account) (period|summary|number)\b`, `Beginning balance`, `Ending balance`, `Deposits/Credits`, `Withdrawals/Debits`, or a header row containing `Date` + `Description` + `Amount|Debit|Credit|Balance`.
- **LEDES / legal billing** — headers like `Timekeeper`, `Task Code`, `Hours`, `Rate`, `Amount`, or a pipe-delimited LEDES 1998B block (`INVOICE_DATE|INVOICE_NUMBER|CLIENT_ID|LAW_FIRM_MATTER_ID|...`).
- **Invoice / receipt** — `Invoice #`, `Bill To`, `Subtotal`, `Tax`, `Total`, or a line-item table with `Qty` + `Unit price` + `Amount`.
- **Fallback** — generic table.

Return `{ type, confidence, evidence }` so the UI can show a small "detected: Bank statement (high)" chip.

## Semantic parsers (`src/lib/pdf/transactions/parsers/`)

Each parser takes the raw `ExtractedTable[]` from `extractTables()` and returns a typed `Transaction[]` plus a `TransactionSchema` describing the output columns.

- `bank-statement.ts` — output columns: `date | description | debit | credit | amount | balance | category?`
  - Date regexes: `MM/DD/YYYY`, `DD/MM/YYYY`, `Mon DD`, `YYYY-MM-DD`. Locale sniffed from the statement (US vs EU) via header text; user can override.
  - Amount parser handles `1,234.56`, `1.234,56`, trailing `CR/DR`, parentheses for negatives, `$/€/£` prefixes. Signed based on debit/credit column when present, else on parentheses/sign.
  - Balance column detected as the rightmost monetary column that increases monotonically in one direction.
  - Simple category guess (rules only): payroll, transfer, fee, atm, card, check, deposit — pure regex on description, no AI.

- `invoice.ts` — output columns: `line_no | description | qty | unit_price | amount | tax?` plus a `header` object (`vendor, invoice_no, invoice_date, due_date, subtotal, tax, total, currency`).
  - Header extracted from key/value pairs above the line-item table (regex on labels).
  - Line items detected as rows where at least two numeric-looking columns exist to the right of a description.
  - Sanity check: `Σ amount ≈ subtotal ± 0.02` — flags a warning row in the preview when it doesn't reconcile.

- `ledes.ts` — output columns: `date | timekeeper_id | timekeeper_name | task_code | activity_code | expense_code | hours | rate | amount | narrative`.
  - Two paths: pipe-delimited LEDES 1998B (parse as CSV with `|`), or human-readable attorney invoice (map header text like `Atty`, `Hours`, `Rate`, `Amount`, `Description`).
  - Task/activity codes validated against the standard UTBMS list (bundled JSON, ~200 codes) so bad column mappings surface as `?` in the preview.

- `generic.ts` — passes rows through, but promotes the first row to headers if all cells are non-numeric, and normalizes amount-looking cells (parses to Number when possible).

## Shared amount / date normalizers (`src/lib/pdf/transactions/normalize.ts`)

Pure functions used by every parser:

- `parseAmount(raw, locale)` → `{ value: number | null, negative: boolean, currency?: string }`.
- `parseDate(raw, locale)` → ISO `YYYY-MM-DD` or null. Two-digit years pivot at 70/69.
- `guessLocale(pageText)` → `"US" | "EU"` based on `$`/`€/£`, decimal-separator frequency, and month name spellings.

## Column mapper

Every parser returns a `mapping: Record<TypedColumn, number | null>` (index into the raw rows). The inspector renders a small mapping strip so the user can reassign columns before export — same primitive as the Bates format editor. Changes re-run the parser in-place (cheap, all in-memory).

## Preview + export UI (`src/components/workspace/transactions-panel.tsx`)

- Header: file name, detected type chip, page count, row count.
- Column-mapping strip (collapsible).
- Editable data grid (virtualized when >200 rows) using existing table components.
- Footer buttons: **Copy CSV**, **Download CSV**, **Download XLSX** (single sheet for invoices/LEDES; statements get `Transactions` + `Summary` sheets — totals by month/category, opening/closing balance).
- Locale toggle (`Auto / US / EU`) that re-runs normalizers.
- Empty state after run: "No transactions detected. Try a different document type or use the raw table extractor."

## Wire-up

- **New** `src/lib/pdf/transactions/{types,detect-type,normalize,parsers/{bank-statement,invoice,ledes,generic}}.ts`
- **New** `src/lib/pdf/transactions/utbms.ts` (bundled code list for LEDES validation)
- **New** `src/components/workspace/transactions-panel.tsx`
- **Edit** `src/components/workspace/tool-panels.tsx` — add third mode chip in the Extract wrapper (around line 5560); import + render `TransactionsPanel`.
- **Reuse** `xlsx` (already a dep, used by `extract-tables.ts`) for XLSX output.

## Technical notes

- Sits on top of `extractTables()` — reuses OCR fallback, no new PDF parsing loop.
- Zero new dependencies.
- Pure functions everywhere → easy unit tests for the normalizers and parsers with sample rows.
- Follows the three-layer contract: srcBytes untouched; parser output is derived state, not sidecar.
- Persistence: nothing saved by default. If the user turns on the case-session save, the extracted table gets stored under `case.transactions[fileName]` for later reuse by the roadmap's Categorize/Expense Report block.

## Out of scope

- AI-assisted extraction (deferred — Hybrid path documented for later).
- Multi-statement reconciliation across files (would live in a workflow node).
- Custom user schemas / column-rename presets (add if a user asks).
- Direct push to accounting software (Xero, QuickBooks) — export CSV meets 99% of that need today.
