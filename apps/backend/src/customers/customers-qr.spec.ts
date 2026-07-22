import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 6.1 — the QR is a pointer, not a wallet. This spec pins the core
// privacy rule: the ONLY thing handed to the QR encoder is qrMemberId —
// never name, phone, points, or rate. If someone later "helpfully" encodes
// a JSON blob with personal data into the card, this test fails.
//
// The qrcode module is wrapped (not stubbed): payloads are recorded, then
// the real encoder runs, so the PNG/SVG assertions below exercise real
// output.
const mockQrPayloads: { toDataURL: string[]; toString: string[] } = {
  toDataURL: [],
  toString: [],
};

jest.mock('qrcode', () => {
  const actual = jest.requireActual<typeof import('qrcode')>('qrcode');
  return {
    toDataURL: (text: string, options?: Record<string, unknown>) => {
      mockQrPayloads.toDataURL.push(text);
      return actual.toDataURL(text, options as never);
    },
    toString: (text: string, options?: Record<string, unknown>) => {
      mockQrPayloads.toString.push(text);
      return actual.toString(text, options as never);
    },
  };
});

describe('CustomersService.qrCard (Section 6.1)', () => {
  let service: CustomersService;
  let prisma: { customer: { findUnique: jest.Mock } };

  const customer = {
    id: 'cust-1',
    name: 'Asha Transport',
    phone: '9990001111',
    vehicleNumber: 'KA01AB1234',
    qrMemberId: 'PUMP001-CUST-00042-2',
    loyaltyRateOverride: 5,
    creditLimit: 10000,
    verificationStatus: 'VERIFIED',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    mockQrPayloads.toDataURL = [];
    mockQrPayloads.toString = [];
    prisma = { customer: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  // Explicit 15s timeout on both real-encoding tests below (Jest's 5000ms
  // default): this test uses the REAL qrcode encoder (see the module mock's
  // own comment — payloads recorded, not stubbed), which takes ~2.7s in
  // isolation but crosses the 5s default under full-suite CPU contention
  // (all 42 spec files running in parallel) — found flaky, not a
  // regression from any particular change.
  it('encodes ONLY qrMemberId in the QR payload', async () => {
    prisma.customer.findUnique.mockResolvedValue(customer);

    await service.qrCard('cust-1');

    expect(mockQrPayloads.toDataURL).toEqual(['PUMP001-CUST-00042-2']);
    expect(mockQrPayloads.toString).toEqual(['PUMP001-CUST-00042-2']);
  }, 15000);

  it('returns scannable PNG + SVG renderings plus the human-readable caption fields', async () => {
    prisma.customer.findUnique.mockResolvedValue(customer);

    const result = await service.qrCard('cust-1');

    expect(result.qrMemberId).toBe('PUMP001-CUST-00042-2');
    expect(result.pngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.svg).toContain('<svg');
    // Printed on the card next to the QR (Section 14 mockup), NOT inside it.
    expect(result.name).toBe('Asha Transport');
    expect(result.vehicleNumber).toBe('KA01AB1234');
  }, 15000);

  it('unknown customer is a 404', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(service.qrCard('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
