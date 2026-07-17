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
  lastEditedById: string | null;
  lastEditedAt: string | null;
  deletedById: string | null;
  deletedAt: string | null;
  paymentLines: BillPaymentLine[];
  customer?: { id: string; name: string; verificationStatus: string } | null;
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
