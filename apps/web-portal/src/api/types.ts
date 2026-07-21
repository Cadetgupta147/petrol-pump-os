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

export interface StaffSummary {
  id: string;
  name: string;
  phone: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  staff: StaffSummary;
}

export type PaymentTypeTotals = Record<PaymentType, number>;

export interface SalesSummary {
  date: string;
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

export interface Bill {
  id: string;
  customerId: string | null;
  vehicleNumber: string | null;
  customerName: string | null;
  amount: number;
  litres: number;
  productType: string;
  rateApplied: number;
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
  limit?: number;
  offset?: number;
}

export interface BillsListResponse {
  bills: Bill[];
  total: number;
}

// Mirrors apps/backend/src/bills/dto/update-bill.dto.ts — any subset of
// vehicleNumber/customerName/amount/litres/productType/rateApplied/
// customerId/paymentLines (PartialType of CreateBillDto minus enteredById/
// entryChannel, which stay immutable after creation), plus a required
// editedById (no auth-derived actor yet, so the caller passes staff.id
// explicitly — same pattern as CreateBillRequest's enteredById would be).
// paymentLines, if provided, is a FULL REPLACEMENT of the bill's existing
// payment lines, not a merge (see BillsService.update()) — this page only
// edits the scalar fields, so paymentLines is deliberately omitted here.
export interface UpdateBillRequest {
  vehicleNumber?: string;
  customerName?: string;
  amount?: number;
  litres?: number;
  productType?: string;
  rateApplied?: number;
  editedById: string;
}

export interface MeterReading {
  id: string;
  nozzleId: string;
  staffId: string;
  openingReading: number;
  closingReading: number | null;
  shiftStart: string;
  shiftEnd: string | null;
  litresSold: number | null;
}

export interface MeterVariance {
  meterReadingId: string;
  nozzleId: string;
  staffId: string;
  shiftStart: string;
  shiftEnd: string;
  litresSoldFromMeter: number;
  litresBilled: number;
  variance: number;
  toleranceLitres: number;
  flagged: boolean;
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
  qrMemberId: string;
  // Section 6.2 — per-customer earning rate override. null = "uses the
  // dealer default"; 0 is a real override meaning "earns nothing".
  loyaltyRateOverride: number | null;
  creditLimit: number;
  verificationStatus: 'INFORMAL' | 'VERIFIED';
  createdAt: string;
}

// Mirrors apps/backend/src/customers/dto/create-customer.dto.ts. `phone` is
// required here (the DTO's @IsPhoneNumber('IN') is the real enforcement —
// this type just keeps the request body honest, not a validation duplicate).
export interface CreateCustomerRequest {
  name: string;
  phone: string;
  vehicleNumber?: string;
  creditLimit?: number;
}

// Mirrors apps/backend/src/customers/dto/update-customer.dto.ts — every
// field optional (PartialType of CreateCustomerDto) plus verificationStatus,
// which only exists on the PATCH path (the INFORMAL -> VERIFIED upgrade,
// Section 3.4A).
export interface UpdateCustomerRequest {
  name?: string;
  phone?: string;
  vehicleNumber?: string;
  creditLimit?: number;
  verificationStatus?: 'INFORMAL' | 'VERIFIED';
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
  productType: string;
  capacityLitres: number;
  currentStockLitres: number;
  lastDipReading: number | null;
  lastDipAt: string | null;
  calibrationChartRef: string | null;
}

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
// fields here.
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

// Mirrors apps/backend/src/purchases/dto/create-purchase-entry.dto.ts. The
// densityValue/ppmValue/recordedById trio (Section 7.3) is omitted here —
// see the judgment-call note at the top of PurchaseEntryPage.tsx.
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
  type: 'BILL' | 'PAYMENT';
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

// GET /staff — StaffService.findAll(). Deliberately id+name only (no phone/
// role/pinHash/passwordHash) — a minimal picker-list projection, not the
// full Staff model. See StaffController's top comment.
export interface StaffListItem {
  id: string;
  name: string;
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
  createdAt: string;
}

// Mirrors apps/backend/src/cash-custody/dto/create-cash-custody-log.dto.ts.
// cumulativeOutstandingBeforeToday/newOutstanding are deliberately absent —
// CashCustodyService resolves both server-side so a caller can't spoof away
// an outstanding balance (see that DTO's own top comment).
export interface CreateCashCustodyLogRequest {
  date: string;
  totalCashCollected: number;
  depositedToBank: number;
  keptInLocker: number;
  takenHome: number;
  handledById: string;
  broughtBackToday?: number;
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
// getRegister(). Plain register, NOT a tax-rate breakup — see taxModelingGap,
// which must be surfaced prominently in the UI (Section 12 handback note).
export interface SalesRegisterRow {
  date: string;
  partyName: string;
  billNo: string;
  product: string;
  quantityLitres: number;
  rate: number;
  amount: number;
}

export interface PurchaseRegisterRow {
  date: string;
  partyName: string;
  invoiceNo: string | null;
  product: string;
  quantityLitres: number;
  rate: number;
  amount: number;
}

export interface SalesPurchaseRegister {
  from: string;
  to: string;
  salesRegister: SalesRegisterRow[];
  salesTotals: { quantityLitres: number; amount: number };
  purchaseRegister: PurchaseRegisterRow[];
  purchaseTotals: { quantityLitres: number; amount: number };
  taxModelingGap: string;
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
}

export interface AttendanceSummary {
  from: string;
  to: string;
  staff: AttendanceStaffRow[];
  salaryAndAdvancesNote: string;
}
