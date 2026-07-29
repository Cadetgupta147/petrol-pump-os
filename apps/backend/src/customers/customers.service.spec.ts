import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';

// jest's asymmetric matchers are typed `any`; these wrappers give them an
// `unknown` type so they can sit inside object-literal expectations without
// tripping @typescript-eslint/no-unsafe-assignment — same pattern as
// bills-loyalty.spec.ts.
const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

// Section 3.4/6.1 — a phone entered via the web portal (dealer-created
// customer) must be stored in the exact same canonical form
// CustomerAuthService.verifyOtp's phone lookup expects (Section 5's OTP
// login), regardless of how it was typed/pasted in. See the cross-module
// regression proof in customer-onboarding-otp-login.integration.spec.ts for
// the end-to-end version of this same guarantee.
//
// Phase 0.2 (docs/multi-tenancy-plan.md): create()/update() now run inside
// $transaction(async (tx) => {...}) and also find-or-create a
// CustomerAccount by phone (tx.customerAccount.upsert) before creating/
// updating the Customer (membership) row — the mocked tx below exposes
// customerAccount/memberIdCounter/pump/customer, all resolving through the
// same `prisma` fake object.
describe('CustomersService — phone normalization', () => {
  let service: CustomersService;
  let prisma: {
    customer: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    customerAccount: { upsert: jest.Mock };
    memberIdCounter: { update: jest.Mock };
    pump: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      customerAccount: { upsert: jest.fn() },
      memberIdCounter: { update: jest.fn() },
      pump: { findUniqueOrThrow: jest.fn() },
      $transaction: jest.fn(),
    };
    // create()/update() run their work inside $transaction(async (tx) => ...)
    // — hand the callback the same fake db object so tx.customer.create,
    // tx.customerAccount.upsert, tx.memberIdCounter.update, and
    // tx.pump.findUniqueOrThrow all resolve to the mocks above.
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
    prisma.customerAccount.upsert.mockResolvedValue({ id: 'account-1' });
    prisma.memberIdCounter.update.mockResolvedValue({ lastSeq: 1 });
    prisma.pump.findUniqueOrThrow.mockResolvedValue({ id: 'default_pump', pumpCode: 'PUMP001' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('create()', () => {
    it('stores a +91-prefixed phone as the bare 10-digit canonical form', async () => {
      prisma.customer.create.mockResolvedValue({ id: 'cust-1' });

      await runInTenantContext({ pumpId: 'default_pump' }, () =>
        service.create({
          name: 'Ramesh',
          phone: '+919876543210',
          creditLimit: 0,
        }),
      );

      expect(prisma.customerAccount.upsert).toHaveBeenCalledWith(
        containing({ where: { phone: '9876543210' } }),
      );
      expect(prisma.customer.create).toHaveBeenCalledWith(
        containing({
          data: containing({ phone: '9876543210', accountId: 'account-1' }),
        }),
      );
    });

    it('stores a spaced/dashed phone as the bare 10-digit canonical form', async () => {
      prisma.customer.create.mockResolvedValue({ id: 'cust-2' });

      await runInTenantContext({ pumpId: 'default_pump' }, () =>
        service.create({
          name: 'Suresh',
          phone: '+91 98765-43210',
          creditLimit: 0,
        }),
      );

      expect(prisma.customer.create).toHaveBeenCalledWith(
        containing({
          data: containing({ phone: '9876543210' }),
        }),
      );
    });
  });

  describe('update()', () => {
    it('normalizes phone the same way when included in the patch, and links/creates the matching account', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', accountId: null, name: 'Old Name' });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.update('cust-1', { phone: '91-98765 43210' });

      expect(prisma.customerAccount.upsert).toHaveBeenCalledWith(
        containing({ where: { phone: '9876543210' } }),
      );
      expect(prisma.customer.update).toHaveBeenCalledWith(
        containing({
          data: containing({ phone: '9876543210', accountId: 'account-1' }),
        }),
      );
    });

    it('leaves phone (and accountId) untouched when phone is omitted from the patch', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', accountId: 'existing-account', name: 'A' });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.update('cust-1', { vehicleNumber: 'MH12AB1234' });

      expect(prisma.customerAccount.upsert).not.toHaveBeenCalled();
      // Deliberately not expect.objectContaining({ phone: undefined }) here:
      // that matcher treats a MISSING key the same as a key present with
      // value undefined, which is exactly the ambiguity this assertion
      // needs to rule out — assert directly on the actual call args instead.
      const calls = prisma.customer.update.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { data: Record<string, unknown> };
      expect(Object.prototype.hasOwnProperty.call(call.data, 'phone')).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(call.data, 'accountId')).toBe(
        false,
      );
    });
  });

  // Section 17.24 — ID-document capture, optional/dealer's-discretion. Both
  // fields must be set together or neither.
  describe('idDocument pair validation', () => {
    it('rejects a create with only idDocumentType set', async () => {
      await expect(
        service.create({
          name: 'Ramesh',
          phone: '9990000001',
          idDocumentType: 'Aadhaar',
        }),
      ).rejects.toThrow();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('rejects a create with only idDocumentNumber set', async () => {
      await expect(
        service.create({
          name: 'Ramesh',
          phone: '9990000001',
          idDocumentNumber: '1234',
        }),
      ).rejects.toThrow();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('allows a create with both idDocument fields set', async () => {
      prisma.customer.create.mockResolvedValue({ id: 'cust-1' });

      await runInTenantContext({ pumpId: 'default_pump' }, () =>
        service.create({
          name: 'Ramesh',
          phone: '9990000001',
          idDocumentType: 'Aadhaar',
          idDocumentNumber: '1234 5678 9012',
        }),
      );

      expect(prisma.customer.create).toHaveBeenCalledWith(
        containing({
          data: containing({ idDocumentType: 'Aadhaar', idDocumentNumber: '1234 5678 9012' }),
        }),
      );
    });

    it('allows an update that only touches idDocumentNumber when a type already exists', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        accountId: 'account-1',
        idDocumentType: 'Aadhaar',
        idDocumentNumber: null,
      });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.update('cust-1', { idDocumentNumber: '1234 5678 9012' });

      expect(prisma.customer.update).toHaveBeenCalledWith(
        containing({ data: containing({ idDocumentNumber: '1234 5678 9012' }) }),
      );
    });

    it('rejects an update that would clear the number but leave the type set', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        accountId: 'account-1',
        idDocumentType: 'Aadhaar',
        idDocumentNumber: '1234',
      });

      await expect(service.update('cust-1', { idDocumentNumber: '' })).rejects.toThrow();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });
});

// Section 17.11 — DPDP Act compliance scaffolding (go-live blocker, Section
// 18.1). Separate describe block/mock shape from the transaction-heavy
// create()/update() tests above — these three methods never touch
// $transaction.
describe('CustomersService — DPDP compliance scaffolding', () => {
  let service: CustomersService;
  let prisma: {
    customer: { findUnique: jest.Mock; update: jest.Mock };
    bill: { findMany: jest.Mock };
    loyaltyTransaction: { findMany: jest.Mock };
    redemptionTransaction: { findMany: jest.Mock };
    payment: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn(), update: jest.fn() },
      bill: { findMany: jest.fn().mockResolvedValue([]) },
      loyaltyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      redemptionTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('recordConsent', () => {
    it('404s on an unknown customer', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.recordConsent('nope', { version: 'v1' })).rejects.toThrow();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('stamps dataConsentAt and dataConsentVersion', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.recordConsent('cust-1', { version: 'privacy-policy-v1' });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { dataConsentAt: expect.any(Date) as Date, dataConsentVersion: 'privacy-policy-v1' },
      });
    });
  });

  describe('exportData', () => {
    it('gathers the customer profile plus every linked personal-data table', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', name: 'Ramesh' });

      const result = await service.exportData('cust-1');

      expect(prisma.bill.findMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
      expect(prisma.loyaltyTransaction.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
      });
      expect(prisma.redemptionTransaction.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
      });
      expect(prisma.payment.findMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
      expect(result.customer).toEqual({ id: 'cust-1', name: 'Ramesh' });
    });
  });

  describe('requestDeletion', () => {
    it('anonymizes name/phone/vehicleNumber/companyName/idDocument* and stamps dataDeletedAt', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', dataDeletedAt: null });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.requestDeletion('cust-1');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: {
          name: 'Deleted Customer',
          phone: null,
          vehicleNumber: null,
          companyName: null,
          idDocumentType: null,
          idDocumentNumber: null,
          dataDeletedAt: expect.any(Date) as Date,
        },
      });
    });

    it('refuses to re-anonymize an already-deleted customer', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        dataDeletedAt: new Date('2026-01-01T00:00:00Z'),
      });

      await expect(service.requestDeletion('cust-1')).rejects.toThrow();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });
});

// Section 3.4 — onboarding an existing (pre-system) credit customer with a
// real outstanding balance. addOpeningBalance() writes a CustomerOpeningBalance
// row; ledger() must fold it into the same chronological running-balance walk
// as bills/payments.
describe('CustomersService — opening balance & ledger', () => {
  let service: CustomersService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    bill: { findMany: jest.Mock };
    payment: { findMany: jest.Mock };
    customerOpeningBalance: { findMany: jest.Mock; create: jest.Mock };
  };
  const user: AuthenticatedUser = {
    staffId: 'staff-1',
    pumpId: 'default_pump',
    role: 'ACCOUNTANT',
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      bill: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      customerOpeningBalance: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('addOpeningBalance', () => {
    it('404s on an unknown customer', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.addOpeningBalance('nope', { amount: 500 }, user),
      ).rejects.toThrow();
      expect(prisma.customerOpeningBalance.create).not.toHaveBeenCalled();
    });

    it('rejects a zero amount', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });

      await expect(
        service.addOpeningBalance('cust-1', { amount: 0 }, user),
      ).rejects.toThrow();
      expect(prisma.customerOpeningBalance.create).not.toHaveBeenCalled();
    });

    it('creates a row with the recording staff as recordedById, defaulting effectiveAt to now', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      prisma.customerOpeningBalance.create.mockResolvedValue({ id: 'ob-1' });

      await runInTenantContext({ pumpId: 'default_pump' }, () =>
        service.addOpeningBalance(
          'cust-1',
          { amount: 5000, note: 'Carried over from paper ledger' },
          user,
        ),
      );

      expect(prisma.customerOpeningBalance.create).toHaveBeenCalledWith(
        containing({
          data: containing({
            pumpId: 'default_pump',
            customerId: 'cust-1',
            amount: 5000,
            note: 'Carried over from paper ledger',
            recordedById: 'staff-1',
            effectiveAt: expect.any(Date) as Date,
          }),
        }),
      );
    });

    it('honors an explicit backdated effectiveAt', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      prisma.customerOpeningBalance.create.mockResolvedValue({ id: 'ob-1' });

      await runInTenantContext({ pumpId: 'default_pump' }, () =>
        service.addOpeningBalance(
          'cust-1',
          { amount: 5000, effectiveAt: '2026-01-01T00:00:00.000Z' },
          user,
        ),
      );

      expect(prisma.customerOpeningBalance.create).toHaveBeenCalledWith(
        containing({
          data: containing({ effectiveAt: new Date('2026-01-01T00:00:00.000Z') }),
        }),
      );
    });
  });

  describe('ledger()', () => {
    it('folds an opening balance in as the oldest entry when it predates every bill/payment', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', creditLimit: 10000 });
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'bill-1',
          timestamp: new Date('2026-02-01T00:00:00Z'),
          paymentLines: [{ paymentType: 'CREDIT', direction: 'IN', amount: 1000 }],
        },
      ]);
      prisma.payment.findMany.mockResolvedValue([
        { id: 'pay-1', createdAt: new Date('2026-02-15T00:00:00Z'), amount: 2000 },
      ]);
      prisma.customerOpeningBalance.findMany.mockResolvedValue([
        {
          id: 'ob-1',
          effectiveAt: new Date('2026-01-01T00:00:00Z'),
          amount: 5000,
        },
      ]);

      const result = await service.ledger('cust-1');

      expect(result.entries.map((e) => e.type)).toEqual([
        'OPENING_BALANCE',
        'BILL',
        'PAYMENT',
      ]);
      // 5000 (opening) + 1000 (credit bill) - 2000 (payment) = 4000
      expect(result.outstandingBalance).toBe(4000);
      expect(result.entries[0].runningBalance).toBe(5000);
      expect(result.entries[2].runningBalance).toBe(4000);
    });
  });
});
