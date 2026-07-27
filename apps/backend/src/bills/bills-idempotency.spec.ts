import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntryChannel, PaymentDirection, PaymentType, Prisma } from '@prisma/client';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RateMasterService } from '../rate-master/rate-master.service';
import { VehicleBlacklistService } from '../vehicle-blacklist/vehicle-blacklist.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { runInTenantContext } from '../common/tenant-context';

// Section 17.6 — DSM app offline queue idempotency. A queued bill carries a
// client-generated clientRequestId; if the same request is retried (the
// original actually succeeded server-side but the DSM app never saw the
// reply), this must return the ORIGINAL bill rather than creating a
// duplicate — a real money bug otherwise (double-billed sale).
describe('BillsService idempotency (Section 17.6)', () => {
  let service: BillsService;
  let prisma: {
    bill: { create: jest.Mock; findFirst: jest.Mock };
    billAuditLog: { create: jest.Mock };
    creditLimitAlert: { create: jest.Mock };
    loyaltyTransaction: { create: jest.Mock };
    loyaltyConfig: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  const baseDto: CreateBillDto = {
    vehicleNumber: 'KA01AB1234',
    amount: 1000,
    litres: 20,
    productType: 'petrol',
    entryChannel: EntryChannel.DSM_APP,
    clientRequestId: 'offline-queue-uuid-1',
    paymentLines: [{ paymentType: PaymentType.CASH, amount: 1000, direction: PaymentDirection.IN }],
  };

  beforeEach(async () => {
    prisma = {
      bill: {
        create: jest.fn().mockResolvedValue({ id: 'bill-1', clientRequestId: 'offline-queue-uuid-1' }),
        findFirst: jest.fn(),
      },
      billAuditLog: { create: jest.fn().mockResolvedValue({}) },
      creditLimitAlert: { create: jest.fn().mockResolvedValue({}) },
      loyaltyTransaction: { create: jest.fn().mockResolvedValue({}) },
      loyaltyConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        LoyaltyService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CreditConfigService,
          useValue: { getOrCreate: jest.fn().mockResolvedValue({ enforcementMode: 'NOTIFY', defaultInformalCreditLimit: 5000 }) },
        },
        {
          provide: RateMasterService,
          useValue: { getCurrentRate: jest.fn().mockResolvedValue({ rate: 100 }) },
        },
        {
          provide: VehicleBlacklistService,
          useValue: { assertNotBlacklisted: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  function create(dto: CreateBillDto) {
    return runInTenantContext({ pumpId: 'default_pump' }, () => service.create(dto, 'staff-1'));
  }

  it('creates normally and stamps clientRequestId when no prior bill has it', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await create(baseDto);

    expect(prisma.bill.findFirst).toHaveBeenCalledWith({
      where: { clientRequestId: 'offline-queue-uuid-1' },
      include: { paymentLines: true, customer: true },
    });
    expect(prisma.bill.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientRequestId: 'offline-queue-uuid-1' }) }),
    );
  });

  it('returns the existing bill on a replay, without re-running validation/side-effects', async () => {
    const existingBill = { id: 'bill-original', clientRequestId: 'offline-queue-uuid-1' };
    prisma.bill.findFirst.mockResolvedValue(existingBill);

    const result = await create(baseDto);

    expect(result).toBe(existingBill);
    expect(prisma.bill.create).not.toHaveBeenCalled();
    expect(prisma.billAuditLog.create).not.toHaveBeenCalled();
  });

  it('never touches findFirst when clientRequestId is omitted (every other entry point)', async () => {
    const { clientRequestId: _unused, ...withoutClientRequestId } = baseDto;
    void _unused;

    await create(withoutClientRequestId as CreateBillDto);

    expect(prisma.bill.findFirst).not.toHaveBeenCalled();
  });

  it('translates a P2002 race on (pumpId, clientRequestId) into a 409, not an opaque 500', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);
    prisma.bill.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['pumpId', 'clientRequestId'] },
      }),
    );

    await expect(create(baseDto)).rejects.toBeInstanceOf(ConflictException);
  });
});
