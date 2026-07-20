import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

// jest's asymmetric matchers are typed `any`; these wrappers give them an
// `unknown` type so they can sit inside object-literal expectations without
// tripping @typescript-eslint/no-unsafe-assignment — same pattern as
// bills-loyalty.spec.ts.
const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

// Section 3.4/6.1 — a phone entered via the web portal (dealer-created
// customer) must be stored in the exact same canonical form
// CustomerAuthService.verifyOtp's `findUnique({ where: { phone } })`
// expects (Section 5's OTP login), regardless of how it was typed/pasted
// in. See the cross-module regression proof in
// customer-onboarding-otp-login.integration.spec.ts for the end-to-end
// version of this same guarantee.
describe('CustomersService — phone normalization', () => {
  let service: CustomersService;
  let prisma: {
    customer: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    memberIdCounter: { update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      memberIdCounter: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    // create() runs its work inside $transaction(async (tx) => ...) — hand
    // the callback the same fake db object so tx.customer.create and
    // tx.memberIdCounter.update resolve to the mocks above.
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );

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
      prisma.memberIdCounter.update.mockResolvedValue({ lastSeq: 1 });
      prisma.customer.create.mockResolvedValue({ id: 'cust-1' });

      await service.create({
        name: 'Ramesh',
        phone: '+919876543210',
        creditLimit: 0,
      });

      expect(prisma.customer.create).toHaveBeenCalledWith(
        containing({
          data: containing({ phone: '9876543210' }),
        }),
      );
    });

    it('stores a spaced/dashed phone as the bare 10-digit canonical form', async () => {
      prisma.memberIdCounter.update.mockResolvedValue({ lastSeq: 2 });
      prisma.customer.create.mockResolvedValue({ id: 'cust-2' });

      await service.create({
        name: 'Suresh',
        phone: '+91 98765-43210',
        creditLimit: 0,
      });

      expect(prisma.customer.create).toHaveBeenCalledWith(
        containing({
          data: containing({ phone: '9876543210' }),
        }),
      );
    });
  });

  describe('update()', () => {
    it('normalizes phone the same way when included in the patch', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.update('cust-1', { phone: '91-98765 43210' });

      expect(prisma.customer.update).toHaveBeenCalledWith(
        containing({
          data: containing({ phone: '9876543210' }),
        }),
      );
    });

    it('leaves phone untouched when omitted from the patch', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      await service.update('cust-1', { vehicleNumber: 'MH12AB1234' });

      // Deliberately not expect.objectContaining({ phone: undefined }) here:
      // that matcher treats a MISSING key the same as a key present with
      // value undefined, which is exactly the ambiguity this assertion
      // needs to rule out — assert directly on the actual call args instead.
      const calls = prisma.customer.update.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { data: Record<string, unknown> };
      expect(Object.prototype.hasOwnProperty.call(call.data, 'phone')).toBe(
        false,
      );
    });
  });
});
