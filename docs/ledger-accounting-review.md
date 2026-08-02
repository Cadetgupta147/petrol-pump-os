# Ledger & Chart-of-Accounts Review — 2026-08-03

**Update 2026-08-03:** findings #1, #2, #4, #5, #6, #7, #8 below have been fixed this session (see the "Fix all 10 ledger-accounting findings" plan) — schema migration, `LedgerPostingService.postPurchaseVoucher()`/`postOpeningBalanceAdjustment()`/`voidVoucherBySourceKey()`, repost-on-edit for Bills/Expenses, a fully rewritten Tally export reading the real ledger, a Cash Custody bank picker, and a new Trial Balance report/page. All verified against the real running app (not just unit tests) — see the session's own log for the exact checks. #3 (GST/output-tax segregation) and #9/#10 (nuances, see below) are still open. A one-time reconciliation script (`apps/backend/scripts/reconcile-stale-vouchers.ts`) exists for pre-existing drift on real data — dry-run by default, not yet applied.

**What this is:** a full read-through of every place this codebase touches double-entry accounting — `LedgerAccount`/`Voucher`/`VoucherLine` (`prisma/schema.prisma`), `LedgerPostingService` (auto-posting), `VouchersService`/`LedgerAccountsService` (manual entry, just redesigned this session), and the Tally XML export — checked against what a real petrol pump's books need: Sundry Debtors, Sundry Creditors, Cash, Bank, Sales, Purchase, Direct/Indirect Expense, Capital Account. Every finding below is verified against actual code (file + line), not guessed.

**Severity legend:** same as `docs/production-readiness.md` — **BLOCKER** = the books will be materially wrong/incomplete until fixed. **HIGH** = works but has a real correctness gap. **MEDIUM** = a real gap, not urgent. **LOW** = polish.

---

## Quick summary

The **receivables side is solid**: every credit customer gets a real per-customer Sundry Debtor ledger, correctly posted from Bills and reversed by Payments, with proper double-entry and idempotency. The **manual voucher entry side** (just rebuilt this session) is now a genuinely good Tally-style single-account/particulars grid.

The **payables side is effectively unbuilt**: fuel purchases from IOCL/BPCL/HPCL — probably the single largest cash outflow a petrol pump has — **never touch the ledger at all**. There's no per-supplier Sundry Creditor, no Purchase account, nothing. This is a known, self-documented gap in `docs/master-plan.md` (§3.6/§12), not something introduced by accident — but it means the books this system produces are structurally incomplete for anyone trying to use them as a real set of accounts.

There's also a second, disconnected accounting system: the **Tally XML export reads straight from `Bill`/`Payment`**, not from `LedgerAccount`/`Voucher` at all. It has its own hardcoded ledger names and misses Expenses, Cash Custody, Shift Sales, every manual voucher, and Purchases. A dealer exporting to Tally today gets a different (narrower) picture than the Day Book shows on-screen.

---

## What's implemented correctly

### Sundry Debtors (receivables) — correct
`getOrCreateCustomerLedger()` (`ledger-posting.service.ts:268`) gives every credit customer their own real `LedgerAccount` (group `SUNDRY_DEBTOR`), linked by `linkedCustomerId` (not by name — two customers with the same name can't collide). `postBillVoucher()` debits it on a credit sale, `postPaymentVoucher()` credits it on repayment. Idempotent (`sourceKey` dedupe), balanced, tested (`ledger-posting.service.spec.ts`).

### Cash / Card / UPI clearing — correct
`resolvePaymentTypeLedger()`/`resolveSalesDebitLedger()` (`ledger-posting.service.ts:304-363`) route Cash/Card/UPI to stable system ledgers (`CASH`, `CARD_CLEARING`, `UPI_CLEARING`) via `systemKey`, immune to a dealer renaming "Cash" to "Till".

### Direct expenses — mostly correct
`postExpenseVoucher()` debits a per-category ledger (auto-created under `DIRECT_EXPENSE`), credits whatever the expense was paid via. Simple and correct, with one caveat noted below (everything lands under `DIRECT_EXPENSE`, never `INDIRECT_EXPENSE`).

### Day Book — correct for what it covers
`VouchersService.getDayBook()` correctly computes an opening balance (ledger's own `openingBalance`/`openingBalanceType` plus every prior line) and a closing balance per ledger touched that date, with counterparty names resolved per line. Sound math — see the gaps below for what it *doesn't* see.

### Manual voucher entry (this session's redesign) — correct
The new Account + Particulars grid (`VoucherEntryPage.tsx`) always constructs a provably-balanced voucher (Account's leg = sum of the Particulars columns), with a real auto-generated per-ledger `code` (`ledger-account-code.ts`, mirrors the existing `voucherNumber` counter pattern) and per-line narration. `voucherType` is derived, not chosen, and doesn't gate the math.

---

## Gaps found

### 1. Purchases never post to the ledger at all — BLOCKER
**Files:** `purchases/purchases.service.ts` (full file), `ledger/ledger-posting.service.ts` (no `postPurchaseVoucher` exists anywhere).

`PurchasesService.create()` writes `PurchaseEntry` + increments `Tank.currentStockLitres` (+ optional `DensityLog`) — nothing else. No `LedgerAccount`, no `Voucher`, no `VoucherLine`. Confirmed by checking every module that injects `LedgerPostingService` (`bills`, `expenses`, `cash-custody`, `shift-sales`, `payments` — **not** `purchases`).

Consequence: every tanker delivery — the actual cost of the fuel a pump resells — is invisible to Day Book, Trial Balance (there isn't one, see #8), and Tally export. There's no way to see "how much do I owe IOCL right now" from the books, no Purchase account, no per-supplier Sundry Creditor. `PurchaseEntry.supplierName` is a plain string with no relation to any ledger at all.

This is a **known, already-tracked gap**, not something new: `docs/master-plan.md` §3.6 ("Supplier ledger: amount owed to IOCL/BPCL/HPCL/distributors") and §12's new "Supplier/creditor outstanding report" row both flag it explicitly — "that bullet has existed since v1 but was never turned into a schema field or a report."

### 2. Sundry Creditor is a single generic bucket, never per-supplier — HIGH
**File:** `ledger-posting.service.ts:377-384`.

The *only* code path that ever creates a `SUNDRY_CREDITOR`-group ledger is `resolvePaymentTypeLedger()` when an `ExpenseEntry` is paid via `CREDIT` — and even then it's one shared "Unlinked Credit (Expenses)" ledger for every such expense, not a real per-supplier account (contrast with Sundry Debtors, which does get one ledger per real customer). Combined with #1, there is no supplier-level payables tracking anywhere in this system.

### 3. GST/output tax is blended into Sales, not segregated — MEDIUM
**File:** `ledger-posting.service.ts:78-79` (`postBillVoucher`).

The Sales ledger is credited the bill's *full* amount, which already includes `itemsTaxTotal` (CGST/SGST/IGST on lubricant/other-item lines — see `BillLineItem`). There is no "Output CGST/SGST/IGST Payable" ledger anywhere (`grep -i gst apps/backend/src/ledger` → zero matches). The Sales/Purchase Register report (`sales-purchase-register`) computes `taxAmount` separately for *reporting*, but that number never lands in the double-entry books — so turnover reads as inflated by the tax component, and there's no ledger-derived answer to "how much GST do I currently owe the government."

### 4. Tally export is a second, disconnected accounting pipeline — HIGH
**File:** `tally-export/tally-xml-builder.util.ts` (whole file), `tally-export.service.ts`.

This does **not** read `LedgerAccount`/`Voucher`/`VoucherLine` at all — it pulls straight from `Bill` and `Payment`, and invents its own fixed ledger names (`STATIC_LEDGERS`: `'Cash'`, `'Bank'`, `'UPI'`, `'Sales Account'`) rather than the dealer's real Ledger Master rows (their codes, actual bank names like the "SBI" ledger created this session, opening balances). The file's own header comment says it plainly: *"walk-in sales captured only in ShiftSalesSummary and PurchaseEntry -> Purchase Voucher are explicitly out of scope."*

Concretely: every manual voucher (Toll, Babu Ji, the SBI Contra test from this session), every Expense, every Cash Custody entry, every Shift Sales entry, and every Purchase is **absent** from what an accountant actually receives via Tally export — even though the Day Book/Voucher Entry pages make it look like a complete, unified ledger. A dealer relying on "just export to Tally at month-end" would hand their accountant a materially incomplete picture.

### 5. Editing or deleting a Bill/Expense/Cash-Custody entry never touches its voucher — HIGH
**Files:** `bills.service.ts` (`postBillVoucher` called only from `create()`, line 421 — `update()`/`remove()` never call it), `expenses.service.ts` (same — `postExpenseVoucher` called once, `remove()` exists and doesn't touch it), `cash-custody.service.ts` (same pattern).

Only `ShiftSalesSummary` gets a delete-and-recreate posting (`repostShiftSalesVoucher`) — Bills, Expenses, and Cash Custody are all create-once with **no correcting path**. Editing a bill's amount, changing its payment split, or soft-deleting it (`Bill.deletedAt`) leaves the original voucher exactly as first posted. The ledger silently drifts out of sync with the source records it's supposed to derive from. There's no compensating-entry mechanism either — a dealer has to notice and manually file a correcting Journal voucher.

Also self-documented as a related, narrower known gap: `ledger-posting.service.ts:48-55` flags that the UPI auto-capture webhook path increments `ShiftSalesSummary` without calling `repostShiftSalesVoucher()`, so even the one entity that *does* support reposting can still show a stale figure until the next manual edit.

### 6. `CustomerOpeningBalance` never flows into the customer's ledger — MEDIUM
**Files:** `ledger/` (zero references to `CustomerOpeningBalance` anywhere), `customers/` (where it's actually used, for the customer-facing outstanding statement).

Onboarding an existing credit customer with a real pre-system balance (Section 3.4) sets `CustomerOpeningBalance`, which correctly feeds `GET /customers/:id/outstanding-statement` (used for credit-limit checks, aging, blacklist). But the same customer's `LedgerAccount` (auto-created via `getOrCreateCustomerLedger`) always starts at the schema default `openingBalance: 0` — nothing ever copies the real opening balance across. Result: two different "what does this customer owe" numbers exist in the system and can disagree — the credit-management side (correct) and the double-entry books (understated until the next bill/payment touches that ledger).

### 7. Cash-Custody bank deposits always hit one generic "Bank" ledger — MEDIUM
**File:** `ledger-posting.service.ts:132` — `getOrCreateSystemLedger(log.pumpId, 'BANK_DEFAULT', 'Bank', 'BANK')`.

If a dealer has multiple real bank accounts (this session added a manual "SBI" ledger, group `BANK`), the automatic Cash Custody "deposited to bank" postings can't target a specific one — they always go to one hardcoded `BANK_DEFAULT` system ledger. Multiple bank accounts only work through *manual* Voucher Entry (which does let you pick any Bank-group ledger as the Account); the automatic side has no such choice.

### 8. No Trial Balance / Balance Sheet — only a single-day Day Book — MEDIUM
**File:** `ledger/vouchers.controller.ts` — only two read routes exist: `GET /vouchers` (flat list) and `GET /vouchers/day-book` (one date, **only ledgers touched that date** get a section — a ledger with a real balance that wasn't touched today doesn't appear at all).

There's no "every ledger's balance as of date X" report. An accountant used to a Tally Trial Balance has nothing equivalent here — they'd have to reconstruct it by walking every Day Book from day one, which isn't practical.

### 9. `CAPITAL_ACCOUNT`, `PURCHASE`, `INDIRECT_EXPENSE` groups exist but nothing ever posts to them automatically — LOW
**Files:** `LedgerGroup` enum (`schema.prisma`), `ledger-posting.service.ts` (grep confirms zero automatic use of any of the three).

They're selectable in Ledger Master's "Add ledger account" group dropdown, so a dealer *can* set one up and post to it manually via Voucher Entry — but no auto-posting logic ever targets them. `PURCHASE` in particular is dead weight until #1 is fixed (nothing would ever populate it). `INDIRECT_EXPENSE` exists purely so a dealer can manually classify an expense ledger differently than the auto-created `DIRECT_EXPENSE` default — every `ExpenseEntry` category ledger is created under `DIRECT_EXPENSE` regardless of whether it's genuinely a direct cost.

### 10. Owner's cash draw posts to a generic per-staff "Other" ledger, not Capital/Drawings — LOW
**File:** `ledger-posting.service.ts:286-302` — `getOrCreatePersonalLedger()`, group `OTHER`, linked by `linkedStaffId`.

Cash taken home via Cash Custody (`log.takenHome`) debits a per-staff ledger under group `OTHER`. In standard accounting, an owner's personal draw belongs under Capital Account (as a drawing against equity), not a miscellaneous bucket — this mislabels what should be a Capital Account movement, and (minor) also means a staff member's cash draw and the owner's own draw look identical in the chart of accounts.

---

## How this session's work fits in

Everything built in this session (`code` field, per-line `narration`, the Account+Particulars redesign of Voucher Entry) is entirely on the **manual entry / display** side of the existing, correct double-entry engine — it didn't touch `LedgerPostingService`'s auto-posting logic (beyond the code-allocator refactor needed for the four `getOrCreate*` helpers) and doesn't affect any of the 10 gaps above. Manual vouchers you enter through the redesigned page are correctly balanced and idempotent-safe; they're just not the thing feeding Tally export (#4), and they can't help with Purchases/Creditors (#1/#2) since those never call into the voucher system in the first place.

## Suggested priority if you want to close these

1. **#1 + #2 together** (Purchases → real per-supplier Sundry Creditor + Purchase account) — the highest-value fix; closes the biggest hole and unblocks the "Supplier/creditor outstanding report" the plan already calls for.
2. **#4** (Tally export reading from the real ledger instead of a parallel `Bill`/`Payment`-only pipeline) — otherwise #1's fix wouldn't even reach the accountant's Tally file.
3. **#5** (repost-on-edit/delete for Bill/Expense/CashCustody) — correctness of the existing books, not new coverage.
4. **#6** (customer opening balance → ledger) — one-line fix relative to its impact (two disagreeing "amount owed" numbers is a real accountant-facing confusion).
5. **#3, #7, #8, #9, #10** — real, but lower-stakes; #8 (Trial Balance) is probably the most useful of this group since an accountant will ask for one directly.

Every item above is money-adjacent per `CLAUDE.md` — any fix needs human review before merge, same as this session's Voucher Entry changes.
