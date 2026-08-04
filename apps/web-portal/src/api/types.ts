// Mirrors apps/backend/prisma/schema.prisma and the dashboard/bills/
// meter-readings/credit-alerts/customers response shapes. Kept local to
// web-portal for now — packages/shared-types is still "not yet scaffolded"
// (see its README), so this duplicates a slice of the backend's types by
// hand rather than importing them. Worth promoting to shared-types once
// mobile-agent's DSM app needs the same shapes.

export type Role = 'OWNER' | 'ACCOUNTANT' | 'MANAGER' | 'DSM' | 'READ_ONLY';
export type PaymentType = 'CASH' | 'CARD' | 'UPI' | 'CREDIT';
export type PaymentDirection = 'IN' | 'OUT';
export type EntryChannel = 'WEB' | 'DSM_APP';

// Deliberately no `phone` field — the backend response doesn't include the
// logged-in staff member's own phone (unused by this app, and would
// otherwise sit as unnecessary PII in localStorage — see AuthContext.tsx).
export interface StaffSummary {
  id: string;
  name: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  staff: StaffSummary;
}

export type PaymentTypeTotals = Record<PaymentType, number>;

export interface SalesSummary {
  from: string;
  to: string;
  totalLitres: number;
  totalAmount: number;
  byPaymentType: PaymentTypeTotals;
}

export interface TankStock {
  id: string;
  productType: string;
  capacityLitres: number;
  currentStockLitres: number;
  lastDipReading: number | null;
  lastDipAt: string | null;
}

export interface RecentBill {
  id: string;
  timestamp: string;
  customerName: string | null;
  vehicleNumber: string | null;
  amount: number;
  litres: number;
  productType: string;
  entryChannel: EntryChannel;
  enteredBy: string;
  byPaymentType: PaymentTypeTotals;
}

export interface BillPaymentLine {
  id: string;
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
  createdAt: string;
}

// Extra (non-fuel) item sold alongside the fuel on a bill — e.g. a can of
// engine oil handed over with the same fill-up. Every money field here is
// server-computed (see apps/backend/src/bills/bills.service.ts's
// resolveLineItems()) — never trust/recompute these client-side.
export interface BillLineItem {
  id: string;
  itemId: string | null;
  itemCode: string | null;
  itemName: string;
  quantity: number;
  rate: number;
  amount: number;
  isInterstate: boolean;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTotal: number;
  sortOrder: number;
}

export interface Bill {
  id: string;
  // Server-generated, human-friendly sequence (<PUMP_CODE>-<seq>, e.g.
  // "PUMP001-000123") — never client-supplied, read-only everywhere it's
  // shown.
  billNumber: string;
  customerId: string | null;
  vehicleNumber: string | null;
  customerName: string | null;
  // Grand total payable — fuel (litres × rateApplied, already VAT-inclusive,
  // no separate fuel tax field) plus itemsSubtotal plus itemsTaxTotal below.
  amount: number;
  litres: number;
  productType: string;
  rateApplied: number;
  // Pre-tax subtotal and GST total of the extra (non-fuel) lineItems below —
  // both 0 when the bill has no line items (the pre-existing
  // single-fuel-product case).
  itemsSubtotal: number;
  itemsTaxTotal: number;
  enteredById: string;
  entryChannel: EntryChannel;
  timestamp: string;
  loyaltyPointsEarned: number;
  // Section 6.3 step 5 — stamped at creation with the basis the credit used;
  // null for walk-ins or bills saved before loyalty was configured.
  loyaltyBasisUsed: EarningBasis | null;
  // Present only on the POST /bills response, and only when a
  // customer-linked bill was saved while LoyaltyConfig was unset (the
  // backend's loud "zero points were credited" signal).
  loyaltyWarning?: string;
  lastEditedById: string | null;
  lastEditedAt: string | null;
  deletedById: string | null;
  deletedAt: string | null;
  paymentLines: BillPaymentLine[];
  lineItems: BillLineItem[];
  customer?: { id: string; name: string; verificationStatus: string } | null;
}

// GET /bills?... query params — Section 3.2 bill register filters, mirrors
// apps/backend/src/bills/dto/list-bills-query.dto.ts. Every field is
// optional/independently combinable; limit/offset are opt-in pagination —
// omitting both preserves the old "every non-deleted bill" behavior (still
// used by DashboardPage's unfiltered call).
export interface ListBillsFilters {
  from?: string;
  to?: string;
  customerId?: string;
  staffId?: string;
  paymentType?: PaymentType;
  vehicleNumber?: string;
  customerName?: string;
  billNumber?: string;
  limit?: number;
  offset?: number;
}

export interface BillsListResponse {
  bills: Bill[];
  total: number;
}

// Mirrors apps/backend/src/bills/dto/create-bill-payment-line.dto.ts —
// Section 5A.1, one line of a bill's payment breakdown.
export interface CreateBillPaymentLineRequest {
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
}

// Mirrors apps/backend/src/bills/dto/quick-add-customer.dto.ts — Section
// 3.4A inline quick-add of an informal credit customer at bill time.
export interface QuickAddCustomerRequest {
  name: string;
  vehicleNumber: string;
}

// Mirrors apps/backend/src/bills/dto/create-bill-line-item.dto.ts. Every
// money field the server actually stores (amount, cgst/sgst/igst,
// lineTotal) is computed server-side from quantity/rate/taxRate — see
// BillsService.resolveLineItems() — this request shape only carries the
// inputs.
export interface CreateBillLineItemRequest {
  itemId?: string;
  itemCode?: string;
  itemName?: string;
  quantity: number;
  rate: number;
  isInterstate?: boolean;
  taxRate?: number;
}

// Mirrors apps/backend/src/bills/dto/create-bill.dto.ts — Section 3.2 manual
// bill entry (web/DSM parity). rateApplied and loyalty points are NOT
// fields here: the server resolves both authoritatively (Rate Master +
// LoyaltyConfig) rather than trusting client-supplied values, per CLAUDE.md's
// "never trust the frontend" rule for money fields — see BillsService.create().
// amount must equal fuel (litres × the server-resolved rate) plus whatever
// lineItems add up to (base + GST) — the server validates this, it isn't
// just trusted.
export interface CreateBillRequest {
  customerId?: string;
  quickAddCustomer?: QuickAddCustomerRequest;
  vehicleNumber?: string;
  customerName?: string;
  amount: number;
  litres: number;
  productType: string;
  entryChannel: EntryChannel;
  paymentLines: CreateBillPaymentLineRequest[];
  lineItems?: CreateBillLineItemRequest[];
  // 'YYYY-MM-DD' — backdates the bill's recorded date (entering a past
  // day's sale after the fact). Omit for "now" (the pre-existing default).
  // Server combines this with the current time-of-day, not midnight — see
  // BillsService.resolveBillTimestamp(); rejected if it's a future date.
  billDate?: string;
}

// Mirrors apps/backend/src/bills/dto/update-bill.dto.ts — any subset of
// vehicleNumber/customerName/amount/litres/productType/rateApplied/
// customerId/paymentLines (PartialType of CreateBillDto minus entryChannel,
// which stays immutable after creation). paymentLines, if provided, is a
// FULL REPLACEMENT of the bill's existing payment lines, not a merge (see
// BillsService.update()) — this page only edits the scalar fields, so
// paymentLines is deliberately omitted here.
//
// Finding A1 (docs/production-readiness.md) — editedById is NOT sent here
// anymore. BillsController.update() now derives the actor from the
// authenticated caller's JWT (req.user.staffId) server-side; a client-
// supplied value would be rejected outright by the global ValidationPipe's
// forbidNonWhitelisted.
export interface UpdateBillRequest {
  vehicleNumber?: string;
  customerName?: string;
  amount?: number;
  litres?: number;
  productType?: string;
  rateApplied?: number;
  // 'YYYY-MM-DD' — corrects an already-saved bill's recorded date. Omit to
  // leave the existing timestamp untouched.
  billDate?: string;
}

// ---------- Item Master ----------

export type ItemCategory = 'FUEL' | 'LUBRICANT' | 'OTHER';
export type ItemUnit = 'LITRE' | 'KG' | 'PIECE';

// GET /items — Item Master: everything this pump sells (Petrol, Diesel,
// Speed, Urea/AdBlue, lubricant SKUs, and anything else an Owner/Manager/
// Accountant registers). Nozzle.itemId references this directly.
export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  unit: ItemUnit;
  // Item code (the "Code" column on a bill's line-item grid). Optional —
  // meaningless for FUEL items, since fuel's rate is already tax-inclusive.
  // No taxRate here — that's TaxRateConfig (Section 17.22, /tax-rate-config,
  // TaxRateSettingsPage), keyed by this item's name, so there's one place to
  // configure it rather than two that could drift apart.
  code: string | null;
  isActive: boolean;
  createdAt: string;
}

// Mirrors apps/backend/src/items/dto/create-item.dto.ts.
export interface CreateItemRequest {
  name: string;
  category: ItemCategory;
  unit: ItemUnit;
  code?: string;
}

// Mirrors apps/backend/src/items/dto/update-item.dto.ts — any subset.
export interface UpdateItemRequest {
  name?: string;
  category?: ItemCategory;
  unit?: ItemUnit;
  code?: string;
  isActive?: boolean;
}

// GET /nozzles — Section 3.3/4 Nozzle master (Settings: "how many nozzles/
// meters does this pump have"). nextOpeningReading is server-computed on
// every read (never persisted) — the carry-forward rule's result: this
// nozzle's last closed shift's closingReading, or startingReading if it's
// never had one. This is what the DSM app's/web portal's shift-open picker
// shows as a READ-ONLY preview before submitting — never an editable field.
// rolloverAt is null unless this nozzle's physical meter is configured to
// roll over to zero at a fixed digit count (older mechanical/electronic
// totalizers) — see CloseShiftRequest.meterRolledOver.
// tankId/tank — Section 3.3.1 nozzle-to-tank link: which physical
// underground tank this nozzle is plumbed to. Nullable — an unlinked nozzle
// falls back to the backend's productType-string match against Tank
// (MeterReadingsService.deductTankStock()) exactly like before this field
// existed.
export interface Nozzle {
  id: string;
  label: string;
  itemId: string;
  item: Item;
  tankId: string | null;
  tank: Tank | null;
  startingReading: number;
  rolloverAt: number | null;
  isActive: boolean;
  createdAt: string;
  nextOpeningReading: number;
}

// Mirrors apps/backend/src/nozzles/dto/create-nozzle.dto.ts.
export interface CreateNozzleRequest {
  label: string;
  itemId: string;
  tankId?: string;
  startingReading: number;
  rolloverAt?: number;
}

// Mirrors apps/backend/src/nozzles/dto/update-nozzle.dto.ts — any subset.
// NozzlesService.update() rejects a startingReading change once the nozzle
// has any shift history (409), and rejects isActive:false while an open
// shift exists on this nozzle (409) — both surfaced as an ApiError, not
// re-validated client-side. clearTank unlinks this nozzle's tank — a plain
// `tankId: undefined` is indistinguishable from "not sent" (see the DTO's
// comment), so unlinking needs this separate flag.
export interface UpdateNozzleRequest {
  label?: string;
  itemId?: string;
  tankId?: string;
  clearTank?: boolean;
  startingReading?: number;
  rolloverAt?: number;
  isActive?: boolean;
}

// Meter Reading redesign (Section 3.3) — GET /shift-schedule: the Owner-
// configurable shift schedule (Settings), a flat dealer-managed list like
// Nozzle/Item, NOT a singleton config. startTime/endTime are wall-clock
// "HH:mm" (24h) strings with no date/timezone — endTime may be numerically
// "before" startTime for a shift that wraps past midnight (e.g.
// "22:00"-"06:00"). Used PURELY to label which shift a batch-closing-
// readings submission belongs to (see MeterReading's batch-close flow) —
// never a blocking gate.
export interface ShiftDefinition {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: string;
}

// Mirrors apps/backend/src/shift-schedule/dto/create-shift-definition.dto.ts.
export interface CreateShiftDefinitionRequest {
  label: string;
  startTime: string;
  endTime: string;
}

// Mirrors apps/backend/src/shift-schedule/dto/update-shift-definition.dto.ts
// — any subset, plus isActive (soft-disable).
export interface UpdateShiftDefinitionRequest {
  label?: string;
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
}

// GET /shift-schedule/current — the resolved current/most-recent shift
// window, for display only (e.g. a header showing "Now closing: Shift 2").
// null when nothing is configured, or "now" falls in a genuine gap between
// shifts — never a blocking error, just a missing label.
export interface CurrentShiftWindow {
  shiftDefinition: ShiftDefinition;
  windowStart: string;
  windowEnd: string;
}

export interface MeterReading {
  id: string;
  nozzleId: string;
  // Section 3.3/4 — the full Nozzle master row this reading's nozzleId
  // points at, always included server-side (see MeterReadingsService's
  // `include: { nozzle: true }`) so every table/label in this app can show
  // the dealer-facing label/productType without a second round trip.
  nozzle: Nozzle;
  staffId: string;
  openingReading: number;
  closingReading: number | null;
  // Section 7.2 — product dispensed by this nozzle for this shift, captured
  // at open-shift time. Nullable only for legacy pre-Nozzle-master rows —
  // every shift opened from here on derives it from nozzle.item.name.
  productType: string | null;
  shiftStart: string;
  shiftEnd: string | null;
  litresSold: number | null;
  // True when this shift's meter physically rolled over to zero — see
  // CloseShiftRequest.meterRolledOver / Nozzle.rolloverAt.
  meterRolledOver: boolean;
  correctedById: string | null;
  correctedAt: string | null;
  // Present only on the PATCH /meter-readings/:id/close response, mirroring
  // Bill.loyaltyWarning's pattern: the shift still closes successfully, but
  // if productType is missing or no Tank matches it, tank stock wasn't
  // auto-deducted and this says so loudly instead of silently.
  tankWarning?: string;
  // Present only on a batch-close response, and only on the FIRST close of
  // the (server-local) day, when a product in that batch is still priced
  // off an earlier day's Rate Master entry — see MeterReadingsService.
  // buildRateReminder(). The SAME string on every reading in that response
  // (not per-nozzle) — grab it off any one of them, same pattern as
  // tankWarning above.
  rateReminder?: string;
}

// One nozzle's entry within POST /meter-readings/batch-close — Meter Reading
// redesign (Section 3.3). Replaces the old two-step Open/Close flow: every
// active nozzle's closing reading is submitted at once. Opening a nozzle's
// very first shift, and re-opening its next one right after this closes,
// both happen server-side automatically — there is no separate "open"
// request anymore.
//
// staffId is OPTIONAL and resolved via resolveAssignableActorId() server-side
// — kept PER ROW (not once for the whole batch) since staff rotate across
// nozzles; attributing every nozzle to whoever submitted would blur the
// accountability the variance flag exists to catch.
export interface BatchCloseReadingRequest {
  nozzleId: string;
  closingReading: number;
  meterRolledOver?: boolean;
  staffId?: string;
}

// POST /meter-readings/batch-close's full request body. shiftEnd is a
// WHOLE-BATCH backdating override (mirrors CloseShiftRequest.shiftEnd) —
// non-DSM-only (assertNonDsmOverride() on the backend) — for "missed a
// day, entering it today" instead of the DSM app's real-time flow. See
// BatchCloseDto.shiftEnd's comment on the backend.
export interface BatchCloseRequest {
  readings: BatchCloseReadingRequest[];
  shiftEnd?: string;
}

// Mirrors apps/backend/src/meter-readings/dto/close-shift.dto.ts. shiftEnd
// is a non-DSM-only backdating override (assertNonDsmOverride() on the
// backend) — the manual single-nozzle close fallback (CloseShiftModal) is
// Owner/Accountant/Manager only for this field. meterRolledOver is only
// valid when closingReading < openingReading AND the nozzle has a
// configured rolloverAt — see CloseShiftModal's comment.
export interface CloseShiftRequest {
  closingReading: number;
  meterRolledOver?: boolean;
  shiftEnd?: string;
}

// Mirrors apps/backend/src/meter-readings/dto/correct-meter-reading.dto.ts
// — PATCH /meter-readings/:id/correct, Owner/Accountant only. See that
// file's comment for the exact rules (openingReading only correctable on a
// nozzle's first-ever shift; closingReading blocked if a later shift on the
// same nozzle is already closed too).
export interface CorrectMeterReadingRequest {
  openingReading?: number;
  closingReading?: number;
}

// Section 8A.2 fix — variance is netted against ShiftSalesSummary.walkInLitres
// once a shift's walk-in (non-itemized) sales are reconciled, since ordinary
// uncaptured walk-in volume isn't fraud. `walkInLitresReconciled` is null
// until that reconciliation exists; `reconciliationPending` is true when
// there's a positive, still-unreconciled gap worth logging a walk-in summary
// for. `flagged` is never true purely because of an unreconciled walk-in gap
// — see MeterReadingsService.checkVariance()'s own comment for the full
// direction-aware logic (a negative gap — billed more than the meter shows
// dispensed — always flags, since that direction can never be walk-in).
export interface MeterVariance {
  meterReadingId: string;
  nozzleId: string;
  nozzleLabel: string;
  staffId: string;
  shiftStart: string;
  shiftEnd: string;
  litresSoldFromMeter: number;
  litresBilled: number;
  walkInLitresReconciled: number | null;
  variance: number;
  toleranceLitres: number;
  flagged: boolean;
  reconciliationPending: boolean;
}

// CreditAlertsService.findAll()/findOne()/update() all use
// `include: { bill: true, customer: true }` — a bare `include: true` only
// pulls each model's own scalar columns, not further relations, so `bill`
// here has every Bill scalar field (NOT paymentLines) and `customer` is the
// same scalar-only shape as the `Customer` type below.
export interface CreditLimitAlert {
  id: string;
  billId: string;
  customerId: string;
  outstandingBefore: number;
  billNetCredit: number;
  creditLimit: number;
  overageAmount: number;
  reminderRequested: boolean | null;
  reminderRequestedAt: string | null;
  createdAt: string;
  customer: Customer;
  bill: Omit<Bill, 'paymentLines' | 'customer'>;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  vehicleNumber: string | null;
  // Fleet/company this vehicle bills under, if any — Section 3.4B, used
  // only for company-scope blacklist matching + reporting.
  companyName: string | null;
  qrMemberId: string;
  // Section 6.2 — per-customer earning rate override. null = "uses the
  // dealer default"; 0 is a real override meaning "earns nothing".
  loyaltyRateOverride: number | null;
  creditLimit: number;
  verificationStatus: 'INFORMAL' | 'VERIFIED';
  createdAt: string;
  // Section 17.11 — DPDP Act compliance scaffolding. Both null means no
  // consent has been recorded yet (a real gap, not "assumed consented") —
  // see CustomerLedgerPage's "Data privacy" section.
  dataConsentAt: string | null;
  dataConsentVersion: string | null;
  dataDeletedAt: string | null;
  // Section 17.24 — ID-document capture, optional/dealer's-discretion. Both
  // null or both set — never one without the other (enforced server-side).
  // Type + number only, no scanned image (see prisma/schema.prisma's
  // comment on why: no file-storage backend exists in this codebase yet).
  idDocumentType: string | null;
  idDocumentNumber: string | null;
}

// GET /customers/:id/data-export response — Section 17.11 right to access.
// Every field is `unknown[]`/`unknown` deliberately: this page only ever
// renders the raw JSON as a downloadable file, it never reads into these
// arrays' shape, so there's no value in mirroring Bill/LoyaltyTransaction/
// RedemptionTransaction/Payment's full types here.
export interface CustomerDataExport {
  customer: Customer;
  bills: unknown[];
  loyaltyTransactions: unknown[];
  redemptionTransactions: unknown[];
  payments: unknown[];
}

// Mirrors apps/backend/src/customers/dto/create-customer.dto.ts. `phone` is
// required here (the DTO's @IsPhoneNumber('IN') is the real enforcement —
// this type just keeps the request body honest, not a validation duplicate).
export interface CreateCustomerRequest {
  name: string;
  phone: string;
  vehicleNumber?: string;
  companyName?: string;
  creditLimit?: number;
  // Section 17.24 — both or neither; the backend rejects one without the
  // other (CustomersService.assertIdDocumentPairConsistent()).
  idDocumentType?: string;
  idDocumentNumber?: string;
}

// Mirrors apps/backend/src/customers/dto/update-customer.dto.ts — every
// field optional (PartialType of CreateCustomerDto) plus verificationStatus,
// which only exists on the PATCH path (the INFORMAL -> VERIFIED upgrade,
// Section 3.4A).
export interface UpdateCustomerRequest {
  name?: string;
  phone?: string;
  vehicleNumber?: string;
  companyName?: string;
  creditLimit?: number;
  idDocumentType?: string;
  idDocumentNumber?: string;
  verificationStatus?: 'INFORMAL' | 'VERIFIED';
}

// ---------- Vehicle/Company Blacklist (Section 3.4B) ----------

export type BlacklistScope = 'VEHICLE' | 'COMPANY';
export type BlacklistStatus = 'ACTIVE' | 'RESOLVED';

// Mirrors prisma VehicleBlacklist.
export interface VehicleBlacklistEntry {
  id: string;
  scope: BlacklistScope;
  vehicleNumber: string | null;
  companyName: string | null;
  customerId: string | null;
  reason: string;
  outstandingAmount: number;
  status: BlacklistStatus;
  referencePhotoUrl: string | null;
  blacklistedById: string;
  blacklistedAt: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

// Mirrors apps/backend/src/vehicle-blacklist/dto/create-vehicle-blacklist.dto.ts.
export interface CreateVehicleBlacklistRequest {
  scope: BlacklistScope;
  vehicleNumber?: string;
  companyName?: string;
  customerId?: string;
  reason: string;
  outstandingAmount?: number;
  referencePhotoUrl?: string;
}

// Mirrors apps/backend/src/vehicle-blacklist/dto/resolve-vehicle-blacklist.dto.ts.
export interface ResolveVehicleBlacklistRequest {
  resolutionNote?: string;
}

export type EarningBasis = 'RUPEE' | 'LITRE';
export type RedemptionType = 'CASH' | 'GIFT' | 'BOTH';

// Mirrors prisma LoyaltyConfig (singleton). GET /loyalty-config answers 404
// until the Owner has configured it (translated to null in api/loyalty.ts) —
// there are no hardcoded defaults for earningBasis/defaultRate (open
// decision, master-plan Section 17).
export interface LoyaltyConfig {
  id: string;
  earningBasis: EarningBasis;
  defaultRate: number;
  redemptionTypeAllowed: RedemptionType | null;
  customerCanChooseRedemption: boolean;
  defaultRedemptionMode: RedemptionType | null;
  cashRedemptionRatio: number | null;
  minRedeemablePoints: number | null;
  updatedAt: string;
}

// Mirrors apps/backend/src/loyalty/dto/upsert-loyalty-config.dto.ts —
// earningBasis + defaultRate required on every PUT; redemption-side fields
// exist on the DTO but are deliberately not sent from this UI yet (Section
// 6.4 redemption settings are a later slice).
export interface UpsertLoyaltyConfigRequest {
  earningBasis: EarningBasis;
  defaultRate: number;
}

export type CreditEnforcementMode = 'NOTIFY' | 'BLOCK';

// Mirrors prisma CreditConfig (singleton). Unlike loyalty-config, GET
// /credit-config never 404s — CreditConfigService.getOrCreate() upserts a
// row on first read, so there is no "not configured yet" empty state here
// (Section 3.4A).
export interface CreditConfig {
  id: string;
  enforcementMode: CreditEnforcementMode;
  defaultInformalCreditLimit: number;
  updatedAt: string;
}

// Mirrors apps/backend/src/credit-config/dto/update-credit-config.dto.ts —
// PATCH body, any subset of the two fields.
export interface UpdateCreditConfigRequest {
  enforcementMode?: CreditEnforcementMode;
  defaultInformalCreditLimit?: number;
}

// Mirrors CustomersService.qrCard() — Section 6.1. The QR itself encodes
// ONLY qrMemberId; name/vehicleNumber are for the printed card's
// human-readable caption, not inside the code.
export interface CustomerQrCard {
  customerId: string;
  qrMemberId: string;
  name: string;
  vehicleNumber: string | null;
  pngDataUrl: string;
  svg: string;
}

// GET /tanks — Section 7.1. Full standalone shape for the dedicated Tank
// Stock page, deliberately separate from the dashboard's compact TankStock
// widget above (that one omits calibrationChartRef, which this page shows).
export interface Tank {
  id: string;
  tankNumber: string;
  productType: string;
  capacityLitres: number;
  currentStockLitres: number;
  lastDipReading: number | null;
  lastDipAt: string | null;
  calibrationChartRef: string | null;
}

// Mirrors apps/backend/src/tanks/dto/create-tank.dto.ts — Tank Master
// (Settings), add/delete just like Nozzle Master. tankNumber must be unique
// per pump; currentStockLitres is optional (defaults to 0 server-side).
export interface CreateTankRequest {
  tankNumber: string;
  productType: string;
  capacityLitres: number;
  currentStockLitres?: number;
  calibrationChartRef?: string;
}

// Mirrors apps/backend/src/tanks/dto/update-tank.dto.ts — any subset.
export type UpdateTankRequest = Partial<CreateTankRequest>;

// One physical DIP stick reading, as embedded in a VarianceReportRow (GET
// /tanks/variance-report) — see TanksService.varianceReport(). Not the same
// shape as a standalone DipReading row from GET /tanks/:id/dip-readings
// (that history endpoint isn't used by any of these four pages).
export interface DipReading {
  id: string;
  reading: number;
  systemStockAtReading: number;
  variance: number;
  flagged: boolean;
  recordedAt: string;
}

// GET /tanks/variance-report — Section 7.2 step 3. One row per tank,
// including tanks that have never been dipped (latestDipReading: null).
export interface VarianceReportRow {
  tankId: string;
  productType: string;
  currentStockLitres: number;
  latestDipReading: DipReading | null;
  toleranceLitres: number;
}

// Mirrors prisma PurchaseEntry — Section 7.1/7.2/7.4. densityValue/ppmValue
// (Section 7.3) live on a separate DensityLog row linked by
// purchaseEntryId, not on PurchaseEntry itself, so they're deliberately not
// fields here — see the DensityLog interface below and
// api/densityLogs.ts's getDensityLogs({ purchaseEntryId }).
export interface PurchaseEntry {
  id: string;
  supplierName: string;
  productType: string;
  quantityLitres: number;
  amount: number;
  ratePerLitre: number;
  invoiceNo: string | null;
  tankerNo: string | null;
  invoiceImageUrl: string | null;
  ocrExtracted: boolean;
  createdAt: string;
}

// Mirrors apps/backend/src/purchases/dto/create-purchase-entry.dto.ts.
// densityValue/ppmValue (Section 7.3) are optional — recordedById is NOT a
// DTO field here or on the backend; PurchasesController derives it from the
// authenticated caller whenever densityValue is sent (see that DTO's
// comment — this used to require a client-supplied recordedById, that
// requirement was already dropped backend-side).
export interface CreatePurchaseEntryRequest {
  supplierName: string;
  productType: string;
  quantityLitres: number;
  amount: number;
  ratePerLitre: number;
  invoiceNo?: string;
  tankerNo?: string;
  invoiceImageUrl?: string;
  ocrExtracted?: boolean;
  densityValue?: number;
  ppmValue?: number;
}

// Mirrors prisma DensityLog — Section 7.3. Linked to the PurchaseEntry
// (purchaseEntryId) or DipReading (dipReadingId) that prompted it; both are
// nullable since a DensityLog can also stand alone. `flagged` is computed
// server-side (DensityLogsService.computeDensityFlag()) against a hardcoded
// per-product acceptable range — no range values are duplicated here.
export interface DensityLog {
  id: string;
  tankId: string;
  densityValue: number;
  ppmValue: number | null;
  recordedById: string;
  purchaseEntryId: string | null;
  dipReadingId: string | null;
  flagged: boolean;
  recordedAt: string;
}

// Mirrors prisma DensityRangeConfig — Section 17.19. One row per
// (pump, productType); a product with no row here falls back to the
// backend's built-in placeholder default (density-logs.service.ts's
// DEFAULT_DENSITY_RANGE_BY_PRODUCT).
export interface DensityRangeConfig {
  id: string;
  productType: string;
  minDensity: number;
  maxDensity: number;
  updatedAt: string;
}

export interface UpsertDensityRangeConfigRequest {
  productType: string;
  minDensity: number;
  maxDensity: number;
}

// Mirrors apps/backend/src/ocr/invoice-text-parser.util.ts's
// ExtractedInvoiceFields — every field is nullable, best-effort OCR
// (Section 9, Google Cloud Vision DOCUMENT_TEXT_DETECTION). invoiceDate is
// informational only: there's no `date` field on PurchaseEntry to map it
// to, so the form displays it but never submits it anywhere.
export interface OcrExtractedFields {
  supplierName: string | null;
  productType: string | null;
  quantityLitres: number | null;
  ratePerLitre: number | null;
  amount: number | null;
  invoiceNo: string | null;
  tankerNo: string | null;
  invoiceDate: string | null;
}

// POST /purchase-entries/ocr-extract response. This is pure pre-fill data —
// see PurchaseEntryPage.tsx for the human-review step that always sits
// between this call and the actual POST /purchase-entries.
export interface OcrExtractionResult {
  extractedFields: OcrExtractedFields;
  rawText: string;
}

// Mirrors prisma ExpenseEntry — dashboard "Today's expenses" slice.
export interface ExpenseEntry {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  paidVia: PaymentType;
  expenseDate: string;
  createdAt: string;
}

// Mirrors apps/backend/src/expenses/dto/create-expense.dto.ts.
export interface CreateExpenseRequest {
  category: string;
  description?: string;
  amount: number;
  paidVia: PaymentType;
  expenseDate?: string;
}

// Mirrors prisma GeneratorDieselLog — dashboard "Generator diesel used"
// slice. tankId isn't echoed back as its own field on the raw API response
// (it's a plain relation column) but is still sent on create.
export interface GeneratorDieselLog {
  id: string;
  tankId: string;
  quantityLitres: number;
  notes: string | null;
  recordedAt: string;
}

// Mirrors apps/backend/src/generator-diesel/dto/create-generator-diesel-log.dto.ts.
export interface CreateGeneratorDieselLogRequest {
  tankId: string;
  quantityLitres: number;
  notes?: string;
}

// Mirrors prisma MachineTestingLog — dashboard "Machine testing/calibration"
// slice. Deliberately unrelated to MeterReading (see the schema comment) —
// this is a standalone audit-trail + tank-stock-effect entity.
export interface MachineTestingLog {
  id: string;
  tankId: string;
  litresDrawnOff: number;
  result: string;
  deviationFound: number | null;
  calibrationChartRef: string | null;
  notes: string | null;
  performedAt: string;
}

// Mirrors apps/backend/src/machine-testing/dto/create-machine-testing-log.dto.ts.
export interface CreateMachineTestingLogRequest {
  tankId: string;
  litresDrawnOff?: number;
  result: string;
  deviationFound?: number;
  calibrationChartRef?: string;
  notes?: string;
}

// Mirrors prisma LubricantItem (post-finish, Section 7.1) — the SKU/
// pricing/stock extension for an Item already registered with category
// LUBRICANT. `item` is embedded because LubricantItemsService.findAll()/
// findOne() always `include: { item: true }` (identity lives on Item now,
// not a standalone `name` field here).
export interface LubricantItem {
  id: string;
  itemId: string;
  item: Item;
  sku: string | null;
  costPrice: number | null;
  salePrice: number;
  stockQty: number;
  reorderAt: number;
}

// Mirrors apps/backend/src/lubricant-items/dto/create-lubricant-item.dto.ts.
export interface CreateLubricantItemRequest {
  itemId: string;
  sku?: string;
  costPrice?: number;
  salePrice: number;
  stockQty: number;
  reorderAt: number;
}

// Mirrors apps/backend/src/lubricant-items/dto/update-lubricant-item.dto.ts.
export type UpdateLubricantItemRequest = Partial<Omit<CreateLubricantItemRequest, 'itemId'>>;

// Mirrors prisma ItemSale — dashboard "Lubricant sale"/"Urea/DEF sale"
// slice. `item` is embedded because ItemSalesService.findAll() always
// `include: { item: true }`.
export interface ItemSale {
  id: string;
  itemId: string;
  item: Item;
  quantity: number;
  unitPrice: number;
  amount: number;
  paymentType: PaymentType;
  soldAt: string;
}

// Mirrors apps/backend/src/item-sales/dto/create-item-sale.dto.ts. amount is
// deliberately absent — the backend computes it server-side (see that DTO's
// comment).
export interface CreateItemSaleRequest {
  itemId: string;
  quantity: number;
  unitPrice: number;
  paymentType: PaymentType;
}

// Mirrors prisma RateHistory — Section 7.4. Append-only price history per
// product; no update/delete request type exists on purpose (see
// RateMasterService — a correction is a new dated row, not an edit).
export interface RateHistory {
  id: string;
  productType: string;
  rate: number;
  effectiveFrom: string;
}

// Mirrors apps/backend/src/rate-master/dto/create-rate-history.dto.ts.
export interface CreateRateHistoryRequest {
  productType: string;
  rate: number;
  effectiveFrom: string;
}

export interface LedgerEntry {
  type: 'BILL' | 'PAYMENT' | 'OPENING_BALANCE';
  id: string;
  timestamp: string;
  netCreditImpact: number;
  runningBalance: number;
  data: unknown;
}

export interface CustomerLedger {
  customer: Customer;
  entries: LedgerEntry[];
  outstandingBalance: number;
  creditLimit: number;
}

// Section 3.4 — onboarding an existing (pre-system) credit customer with a
// real outstanding balance. See prisma/schema.prisma's CustomerOpeningBalance
// comment for why this is its own ledger event type rather than a stored
// Customer field or a fake Bill.
export interface CustomerOpeningBalance {
  id: string;
  pumpId: string;
  customerId: string;
  amount: number;
  note: string | null;
  effectiveAt: string;
  recordedById: string;
  createdAt: string;
}

export interface CreateOpeningBalanceRequest {
  amount: number;
  note?: string;
  effectiveAt?: string;
}

// GET /staff — StaffService.findAll(). Deliberately id+name only (no phone/
// role/pinHash/passwordHash) — a minimal picker-list projection, not the
// full Staff model. See StaffController's top comment.
export interface StaffListItem {
  id: string;
  name: string;
}

// ---------- Section 3.7 — Staff Management ----------

// GET /staff-management — StaffManagementService's safe projection (never
// pinHash/passwordHash). Mirrors apps/backend/src/staff-management.
export interface Staff {
  id: string;
  name: string;
  phone: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // Section 17.23 — fixed monthly salary. null = not yet configured.
  monthlySalary: number | null;
}

// Mirrors apps/backend/src/staff-management/dto/create-staff.dto.ts. Exactly
// one of pin/password is expected, matching `role` (pin for DSM, password
// for everyone else) — StaffManagementService rejects the wrong one for the
// role rather than silently ignoring it.
export interface CreateStaffRequest {
  name: string;
  phone: string;
  role: Role;
  pin?: string;
  password?: string;
}

// Mirrors apps/backend/src/staff-management/dto/update-staff.dto.ts. Role is
// not editable (see that DTO's comment for why). pin/password are only sent
// to reset a credential — omit both to leave the existing one unchanged.
export interface UpdateStaffRequest {
  name?: string;
  phone?: string;
  active?: boolean;
  pin?: string;
  password?: string;
  monthlySalary?: number;
}

// GET /attendance — AttendanceService.findAll(). Every clock-in/out session,
// newest first, with the staff name already joined in.
export interface AttendanceLogRow {
  id: string;
  staffId: string;
  clockIn: string;
  clockOut: string | null;
  staff: { id: string; name: string };
}

// POST /attendance/clock-in / PATCH /attendance/:id/clock-out responses —
// AttendanceService.clockIn()/clockOut() return the bare AttendanceLog row
// (no joined staff name, unlike AttendanceLogRow above).
export interface AttendanceLog {
  id: string;
  staffId: string;
  clockIn: string;
  clockOut: string | null;
}

// ---------- Section 3.9 — Settings ----------

export type OmcBrand = 'IOCL' | 'BPCL' | 'HPCL' | 'OTHER' | 'NONE';

// GET /business-profile — BusinessProfileService.getOrCreate(). Every field
// is null until the Owner fills it in (no placeholder defaults server-side).
export interface BusinessProfile {
  id: string;
  businessName: string | null;
  gstin: string | null;
  pumpLicenseNo: string | null;
  address: string | null;
  // Section 5B — credit statement letterhead.
  phone: string | null;
  omcBrand: OmcBrand;
  logoImageData: string | null;
  letterheadImageData: string | null;
  useUploadedLetterhead: boolean;
  updatedAt: string;
}

// Mirrors apps/backend/src/business-profile/dto/update-business-profile.dto.ts.
export interface UpdateBusinessProfileRequest {
  businessName?: string;
  gstin?: string;
  pumpLicenseNo?: string;
  address?: string;
  phone?: string;
  omcBrand?: OmcBrand;
  useUploadedLetterhead?: boolean;
}

// ---------- Section 5B — Credit Customer Outstanding Statement ----------

export interface OutstandingStatementBillLine {
  type: 'BILL';
  billId: string;
  timestamp: string;
  vehicleNumber: string | null;
  customerNameOnBill: string | null;
  productType: string;
  litres: number;
  rateApplied: number;
  billAmount: number;
  outstandingAmount: number;
}

export interface OutstandingStatementOpeningBalanceLine {
  type: 'OPENING_BALANCE';
  openingBalanceId: string;
  timestamp: string;
  note: string | null;
  amount: number;
  outstandingAmount: number;
}

export type OutstandingStatementLine =
  | OutstandingStatementBillLine
  | OutstandingStatementOpeningBalanceLine;

// GET /customers/:id/outstanding-statement — CustomersService.outstandingStatement().
// `lines` are oldest-first, same FIFO ordering as the credit aging report.
export interface OutstandingStatement {
  customer: Customer;
  asOf: string;
  lines: OutstandingStatementLine[];
  totalOutstanding: number;
}

// ---------- Section 12 — Nozzle-wise / Vehicle-wise sales reports ----------

export interface NozzleSalesRow {
  nozzleId: string | null;
  label: string;
  totalLitres: number;
  totalAmount: number;
  billCount: number;
}

export interface NozzleWiseSalesReport {
  from: string;
  to: string;
  rows: NozzleSalesRow[];
  totalLitres: number;
  totalAmount: number;
}

export interface VehicleSalesRow {
  vehicleNumber: string | null;
  customerName: string | null;
  totalLitres: number;
  totalAmount: number;
  billCount: number;
}

export interface VehicleWiseSalesReport {
  from: string;
  to: string;
  rows: VehicleSalesRow[];
  totalLitres: number;
  totalAmount: number;
}

// ---------- Section 12B — Daily Sales Report ----------

export type StockProvenance = 'MEASURED' | 'COMPUTED' | 'UNAVAILABLE';

export interface DsrFuelShift {
  shiftDefinitionId: string | null;
  label: string;
  litres: number;
  value: number | null; // null when no Rate Master entry covers this shift's rate lookup
}

export interface DsrFuel {
  productType: string;
  shifts: DsrFuelShift[];
  totalLitres: number;
  totalValue: number;
}

export interface DsrStockMovementRow {
  tankId: string;
  tankNumber: string;
  productType: string;
  openingStock: number | null;
  openingStockProvenance: StockProvenance;
  receipts: number;
  sales: number;
  closingStock: number | null;
  closingStockProvenance: StockProvenance;
}

export interface DsrReport {
  date: string;
  fuels: DsrFuel[];
  stockMovement: DsrStockMovementRow[];
  collections: { cash: number; card: number; upi: number; credit: number };
  shortExcess: number;
}

// ---------- Section 8 — Cash Custody ----------

// Mirrors prisma CashCustodyLog + CashCustodyService.create()'s return shape.
// cumulativeOutstandingBeforeToday/broughtBackToday/newOutstanding are always
// server-resolved (see CreateCashCustodyLogRequest below) — never trust a
// client-supplied value for these three.
export interface CashCustodyLog {
  id: string;
  date: string;
  totalCashCollected: number;
  depositedToBank: number;
  keptInLocker: number;
  takenHome: number;
  cumulativeOutstandingBeforeToday: number;
  broughtBackToday: number;
  newOutstanding: number;
  handledById: string;
  handledBy?: { id: string; name: string };
  // Section 12 fix — which Bank-group ledger the deposit went into; null
  // means the single generic system Bank ledger (every row before this
  // field existed, or an entry that didn't name one).
  bankLedgerAccountId: string | null;
  createdAt: string;
}

// Mirrors apps/backend/src/cash-custody/dto/create-cash-custody-log.dto.ts.
// cumulativeOutstandingBeforeToday/newOutstanding are deliberately absent —
// CashCustodyService resolves both server-side so a caller can't spoof away
// an outstanding balance (see that DTO's own top comment).
//
// Finding A1 (docs/production-readiness.md) — handledById is optional:
// omitted, it defaults server-side to the authenticated caller; a non-DSM
// caller may still set it to record for someone else
// (resolveAssignableActorId()).
export interface CreateCashCustodyLogRequest {
  date: string;
  totalCashCollected: number;
  depositedToBank: number;
  keptInLocker: number;
  takenHome: number;
  handledById?: string;
  broughtBackToday?: number;
  bankLedgerAccountId?: string;
}

// GET /cash-custody/report — CashCustodyService.getReport(). Already sorted
// server-side (outstanding-first, then biggest balance) — don't re-sort.
export interface CashCustodyReportRow {
  staffId: string;
  staffName: string;
  currentOutstanding: number;
  isCurrentlyOutstanding: boolean;
  outstandingSinceDate: string | null;
  daysHeld: number;
  lastEntryDate: string;
}

// ---------- Section 12 — Ledger / Day Book ----------
//
// A dealer-configurable chart of accounts + double-entry voucher engine
// (LedgerAccount/Voucher/VoucherLine), so the Day Book can show real named
// account heads (credit parties, personal draws, expense categories, bank/
// clearing accounts — e.g. "BABU JI", "JEEP 0711", "TOLL", "STATE BANK OF
// INDIA") the way a Tally Day Book does. Two ways lines get in: MANUAL
// (typed in via the Voucher Entry page — Ledger Master's whole reason for
// existing) or auto-posted by the backend's LedgerPostingService from an
// already-existing Bill/ExpenseEntry/CashCustodyLog/ShiftSalesSummary row.

export type LedgerGroup =
  | 'CASH_IN_HAND'
  | 'BANK'
  | 'SALES'
  | 'PURCHASE'
  | 'SUNDRY_DEBTOR'
  | 'SUNDRY_CREDITOR'
  | 'DIRECT_EXPENSE'
  | 'INDIRECT_EXPENSE'
  | 'CAPITAL_ACCOUNT'
  | 'OTHER';

export type DrCr = 'DEBIT' | 'CREDIT';

export type VoucherType = 'PAYMENT' | 'RECEIPT' | 'CONTRA' | 'JOURNAL' | 'SALES' | 'PURCHASE';

// Section 12A — was missing PAYMENT/PURCHASE/OPENING_BALANCE (see backend's
// VoucherSource enum in prisma/schema.prisma) before the Chronological View
// needed to render entries of every source type, not just the four the
// Ledger View happened to exercise so far.
export type VoucherSource =
  | 'MANUAL'
  | 'BILL'
  | 'EXPENSE'
  | 'CASH_CUSTODY'
  | 'SHIFT_SALES'
  | 'PAYMENT'
  | 'PURCHASE'
  | 'OPENING_BALANCE';

// Mirrors prisma LedgerAccount. isSystemManaged ledgers (Cash, Sales, Card,
// UPI, Bank, and lazily-created per-customer/per-staff ledgers) are shown
// alongside dealer-created ones but can't be deleted (LedgerAccountsPage
// disables that action for them) — see ledger-accounts.service.ts's remove().
export interface LedgerAccount {
  id: string;
  // Short per-pump reference number (e.g. "0001"), always server-generated
  // (allocateLedgerAccountCode() on the backend) — shown as its own column
  // in Voucher Entry next to the name, never editable here.
  code: string;
  name: string;
  group: LedgerGroup;
  openingBalance: number;
  openingBalanceType: DrCr;
  isSystemManaged: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLedgerAccountRequest {
  name: string;
  group: LedgerGroup;
  openingBalance?: number;
  openingBalanceType?: DrCr;
}

export interface UpdateLedgerAccountRequest {
  name?: string;
  group?: LedgerGroup;
  openingBalance?: number;
  openingBalanceType?: DrCr;
}

export interface VoucherLineInput {
  ledgerAccountId: string;
  amount: number;
  drCr: DrCr;
  // Per-line note (Voucher Entry's Particulars grid) — separate from the
  // voucher's own optional narration field.
  narration?: string;
}

// POST /vouchers — manual entry only; source is always stamped MANUAL
// server-side (VouchersService.create()), never client-supplied.
export interface CreateVoucherRequest {
  date: string;
  voucherType: VoucherType;
  narration?: string;
  lines: VoucherLineInput[];
}

// GET /vouchers / GET /vouchers/:id — full ledger detail per line (unlike
// the Day Book's lines, which only carry the ledger's name — see
// DayBookVoucherLine below).
export interface VoucherListItem {
  id: string;
  voucherNumber: string;
  date: string;
  voucherType: VoucherType;
  narration: string | null;
  source: VoucherSource;
  createdBy: { name: string };
  lines: {
    ledgerAccount: { id: string; name: string };
    amount: number;
    drCr: DrCr;
    narration: string | null;
  }[];
}

export interface DayBookVoucherLine {
  ledgerAccountName: string;
  amount: number;
  drCr: DrCr;
}

export interface DayBookVoucher {
  id: string;
  voucherNumber: string;
  date: string;
  voucherType: VoucherType;
  narration: string | null;
  source: VoucherSource;
  lines: DayBookVoucherLine[];
}

// One ledger's day: the OTHER leg(s) of each voucher touching it are
// resolved into counterpartyNames (e.g. Cash's entries show "Sales",
// "Toll", "Babu Ji" — the same convention as the dealer's Tally printout).
export interface DayBookLedgerEntry {
  voucherId: string;
  voucherNumber: string;
  voucherType: VoucherType;
  narration: string | null;
  counterpartyNames: string[];
  amount: number;
  drCr: DrCr;
}

// A single signed balance rendered as a side: 'DR' when the ledger's net is
// debit-heavy, 'CR' when credit-heavy — same convention Tally itself prints
// ("O/B Dr 147269.00", "C/B Dr 143349.00").
export interface DayBookBalance {
  side: 'DR' | 'CR';
  amount: number;
}

export interface DayBookLedgerSection {
  ledgerAccountId: string;
  name: string;
  group: LedgerGroup;
  openingBalance: DayBookBalance;
  closingBalance: DayBookBalance;
  entries: DayBookLedgerEntry[];
}

// GET /vouchers/day-book?date= — every ledger touched that date (not just
// Cash/Bank/Sales — see VouchersService.getDayBook()'s comment for why),
// sorted Cash/Bank/Sales first then alphabetically, plus the flat
// chronological voucher list (the "vanilla" Day Book view).
export interface DayBookReport {
  date: string;
  vouchers: DayBookVoucher[];
  ledgers: DayBookLedgerSection[];
}

// Section 12A — the second Day Book view: same Voucher/VoucherLine data as
// DayBookReport above, grouped by shift and sorted in time order instead of
// by ledger account. Kept as a sibling type, not a union with DayBookReport
// — the two shapes share only `date`, forcing them into one discriminated
// type would just add noise at every call site.
export type PaymentModeLabel = 'CASH' | 'CARD' | 'UPI' | 'CREDIT' | 'OTHER';

export interface DayBookChronologicalEntry {
  voucherId: string;
  voucherNumber: string;
  time: string;
  voucherType: VoucherType;
  narration: string | null;
  source: VoucherSource;
  sourceKey: string | null;
  lines: {
    ledgerAccountId: string;
    ledgerAccountName: string;
    group: LedgerGroup;
    amount: number;
    drCr: DrCr;
  }[];
  paymentMode: PaymentModeLabel;
  partyName: string | null;
  cashDelta: number;
  runningCashBalance: DayBookBalance;
}

export interface DayBookChronologicalShift {
  shiftDefinitionId: string | null;
  label: string;
  windowStart: string | null;
  windowEnd: string | null;
  openingCashBalance: DayBookBalance;
  closingCashBalance: DayBookBalance;
  entries: DayBookChronologicalEntry[];
}

export interface DayBookCashMismatch {
  cashCustodyLogs: {
    id: string;
    handledById: string;
    handledByName: string;
    totalCashCollected: number;
    depositedToBank: number;
    keptInLocker: number;
    takenHome: number;
    newOutstanding: number;
  }[];
  shiftSalesVariances: {
    id: string;
    shiftId: string;
    dsmId: string;
    nozzleId: string;
    expectedValue: number;
    variance: number;
  }[];
}

export interface DayBookChronologicalReport {
  date: string;
  view: 'chronological';
  shifts: DayBookChronologicalShift[];
  cashMismatch: DayBookCashMismatch;
}

// GET /vouchers/trial-balance?asOf= — Section 12 fix (finding #8). Every
// active ledger's running balance as of a date, reusing DayBookBalance's
// {side, amount} shape — no entries/vouchers list, unlike the Day Book,
// since this is a snapshot, not a per-day register.
export interface TrialBalanceRow {
  ledgerAccountId: string;
  name: string;
  group: LedgerGroup;
  balance: DayBookBalance;
}

export interface TrialBalanceReport {
  asOf: string;
  rows: TrialBalanceRow[];
  totals: { dr: number; cr: number };
}

// ---------- Section 8A — Walk-in Shift Sales ----------

// Mirrors prisma ShiftSalesSummary. Read-only view in this app (no create/
// update form wired up here) — see CashCustodyStatusPage's secondary section.
export interface ShiftSalesSummary {
  id: string;
  shiftId: string;
  dsmId: string;
  nozzleId: string;
  walkInLitres: number;
  walkInCashCollected: number;
  walkInUpiCollected: number;
  walkInCardCollected: number;
  expectedValue: number;
  variance: number;
  createdAt: string;
}

export type UpiMerchantProvider = 'PHONEPE' | 'PAYTM';

// Mirrors apps/backend/src/upi-capture-config's SafeUpiCaptureConfig — never
// carries raw secrets (see UpiCaptureConfigService.toSafeView()), only
// whether each credential is currently set. GET never 404s (singleton
// upsert-on-read, same pattern as CreditConfig).
export interface UpiCaptureConfig {
  id: string;
  pumpId: string;
  autoCaptureEnabled: boolean;
  provider: UpiMerchantProvider | null;
  phonePeWebhookUsernameSet: boolean;
  phonePeWebhookPasswordSet: boolean;
  paytmMerchantKeySet: boolean;
  updatedAt: string;
}

// Mirrors apps/backend/src/upi-capture-config/dto/update-upi-capture-config.dto.ts.
// Credential fields are write-only — a successful PATCH is reflected back
// as the corresponding *Set boolean on the next GET, never as the raw value.
export interface UpdateUpiCaptureConfigRequest {
  autoCaptureEnabled?: boolean;
  provider?: UpiMerchantProvider;
  phonePeWebhookUsername?: string;
  phonePeWebhookPassword?: string;
  paytmMerchantKey?: string;
}

// ---------- Section 12 — Reports ----------

// GET /credit-aging/report — CreditAgingService.getReport(). Already sorted
// server-side (outstanding-first, biggest balance first) — don't re-sort.
export interface CreditAgingRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  creditLimit: number;
  oldestUnpaidBillDate: string | null;
  bucket0to15: number;
  bucket15to30: number;
  bucket30Plus: number;
  totalOutstanding: number;
  hasOutstandingBalance: boolean;
}

export interface CreditAgingReport {
  asOf: string;
  customers: CreditAgingRow[];
  totals: {
    bucket0to15: number;
    bucket15to30: number;
    bucket30Plus: number;
    total: number;
  };
}

// GET /loyalty/cost-report — LoyaltyService.getCostReport(). All-time
// balance-sheet-style snapshot, no date filter (see that method's comment).
export interface LoyaltyCostReport {
  pointsIssued: number;
  pointsRedeemed: number;
  pointsOutstanding: number;
  redemptionBreakdown: {
    cash: { redemptionCount: number; pointsRedeemed: number; cashValuePaidOut: number };
    gift: { redemptionCount: number; pointsRedeemed: number };
  };
  cashRedemptionRatio: number | null;
  outstandingLiabilityValue: number | null;
}

// GET /gift-catalog/redemption-report — GiftCatalogService.getRedemptionReport().
// Every catalog item, including never-redeemed and retired ones. Already
// sorted most-redeemed-first server-side — don't re-sort.
export interface GiftRedemptionReportRow {
  giftItemId: string;
  giftName: string;
  pointsRequired: number;
  stockQuantity: number | null;
  activeFlag: boolean;
  timesRedeemed: number;
  totalPointsSpent: number;
}

// GET /sales-purchase-register?from=&to= — SalesPurchaseRegisterService.
// getRegister(). NOT a certified GST tax breakup — see taxModelingGap, which
// must be surfaced prominently in the UI (Section 12 handback note).
// taxRatePercent/taxAmount (Section 17.22) reflect a dealer-configured rate
// (see TaxRateConfig below), applied additively on `amount`. null (not 0)
// means no rate is configured for this row's product.
export interface SalesRegisterRow {
  date: string;
  partyName: string;
  billNo: string;
  product: string;
  quantityLitres: number;
  rate: number;
  amount: number;
  taxRatePercent: number | null;
  taxAmount: number | null;
}

export interface PurchaseRegisterRow {
  date: string;
  partyName: string;
  invoiceNo: string | null;
  product: string;
  quantityLitres: number;
  rate: number;
  amount: number;
  taxRatePercent: number | null;
  taxAmount: number | null;
}

export interface SalesPurchaseRegister {
  from: string;
  to: string;
  salesRegister: SalesRegisterRow[];
  salesTotals: { quantityLitres: number; amount: number; taxAmount: number };
  purchaseRegister: PurchaseRegisterRow[];
  purchaseTotals: { quantityLitres: number; amount: number; taxAmount: number };
  taxModelingGap: string;
}

// Mirrors prisma TaxRateConfig — Section 17.22. One row per (pump,
// productType); a product with no row here is treated as untaxed in the
// sales/purchase register, not defaulted to a guessed rate.
export interface TaxRateConfig {
  id: string;
  productType: string;
  taxRatePercent: number;
  updatedAt: string;
}

export interface UpsertTaxRateConfigRequest {
  productType: string;
  taxRatePercent: number;
}

// GET /attendance/summary?from=&to= — AttendanceService.getSummary().
// Hours-worked half only — salaryAndAdvancesNote must be surfaced prominently
// in the UI, not silently omitted (Section 12 handback note).
export interface AttendanceStaffRow {
  staffId: string;
  staffName: string;
  totalHoursWorked: number;
  sessionCount: number;
  stillClockedIn: boolean;
  // Section 17.23 — monthlySalary null means not yet configured, not 0.
  // outstandingAdvances is the current running unpaid balance, not scoped
  // to [from, to] — see AttendanceService.getSummary()'s comment.
  monthlySalary: number | null;
  outstandingAdvances: number;
}

export interface AttendanceSummary {
  from: string;
  to: string;
  staff: AttendanceStaffRow[];
  salaryAndAdvancesNote: string;
}

// Mirrors prisma StaffAdvance — Section 17.23. repaidAt null = outstanding;
// set = fully settled (all-or-nothing, no partial-repayment ledger — see
// prisma/schema.prisma's comment).
export interface StaffAdvance {
  id: string;
  staffId: string;
  staff: { id: string; name: string };
  amount: number;
  givenAt: string;
  note: string | null;
  repaidAt: string | null;
  recordedById: string;
}

export interface CreateStaffAdvanceRequest {
  staffId?: string;
  amount: number;
  note?: string;
}

// GET /credit-limit-suggestions — Section 17.25. A transparent rule-based
// suggestion, never auto-applied — see CreditLimitSuggestionsTab for the
// Approve/Adjust/Reject flow, and credit-limit-suggestions.util.ts for the
// full methodology (uses CURRENT aging status, not a historical "N late
// payments" count — that data doesn't exist in this schema).
export type CreditLimitSuggestedAction = 'INCREASE' | 'NO_CHANGE' | 'FREEZE_OR_REDUCE';

export interface CreditLimitSuggestionRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  currentLimit: number;
  totalOutstanding: number;
  bucket30Plus: number;
  action: CreditLimitSuggestedAction;
  suggestedLimit: number;
  reasoning: string;
}

export interface CreditLimitSuggestionsReport {
  asOf: string;
  suggestions: CreditLimitSuggestionRow[];
}
