import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 6.3 step 2/3 — GET /customers/by-member-id/:qrMemberId, the DSM
// app's QR-scan/manual-entry resolution. Covers: valid lookup returns the
// minimal auto-fill projection (and nothing sensitive), checksum failure is
// a 400 BEFORE any DB access, unknown-but-well-formed ID is a 404.
//
// Soft-delete: Customer has NO deletedAt column in the schema today, so
// "excludes soft-deleted customers" is structurally a no-op — documented on
// findByMemberId() rather than faked here. If customer soft-delete is ever
// added, add the 404 test alongside the schema change.
//
// Role wiring (DSM allowed, 401 unauthenticated) is covered in
// auth/rbac-real-controllers.integration.spec.ts, which exercises the real
// controller + guards over HTTP.
describe('CustomersService.findByMemberId (Section 6.3 scan lookup)', () => {
  let service: CustomersService;
  let prisma: { customer: { findUnique: jest.Mock } };

  // A real backfilled-format ID: Luhn('00042') = 2.
  const memberId = 'PUMP001-CUST-00042-2';

  const customer = {
    id: 'cust-1',
    name: 'Asha Transport',
    phone: '9990001111',
    vehicleNumber: 'KA01AB1234',
    qrMemberId: memberId,
    loyaltyRateOverride: 5,
    creditLimit: 10000,
    verificationStatus: 'VERIFIED',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = { customer: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  it('resolves a valid member ID to the minimal auto-fill projection', async () => {
    prisma.customer.findUnique.mockResolvedValue(customer);

    const result = await service.findByMemberId(memberId);

    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { qrMemberId: memberId },
    });
    expect(result).toEqual({
      customerId: 'cust-1',
      qrMemberId: memberId,
      name: 'Asha Transport',
      vehicleNumber: 'KA01AB1234',
      verificationStatus: 'VERIFIED',
    });
  });

  it('never leaks phone, credit, or loyalty-rate fields to the scanner (Section 6.1: pointer, not wallet)', async () => {
    prisma.customer.findUnique.mockResolvedValue(customer);

    const result = await service.findByMemberId(memberId);

    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('creditLimit');
    expect(result).not.toHaveProperty('loyaltyRateOverride');
    expect(result).not.toHaveProperty('id'); // exposed as customerId only
  });

  it('bad check digit: 400 before any DB lookup (manual-entry typo case)', async () => {
    // Valid ID is ...00042-2; a typo in the sequence breaks the checksum.
    await expect(
      service.findByMemberId('PUMP001-CUST-00043-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('malformed shapes (old cuid, wrong literal, empty): 400 before any DB lookup', async () => {
    for (const bad of [
      'cmrqnttkj0001ujr414b4gae6', // pre-migration raw cuid
      'PUMP001-STAFF-00042-2',
      'PUMP001-CUST-042-2', // sequence too short
      '',
    ]) {
      await expect(service.findByMemberId(bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('well-formed but unknown member ID: 404', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    // Luhn('99999') — compute via a known-valid formatted sibling: 9×2-9=9,
    // so digits sum = 9+9+9+9+9 = 45 -> check (10 - 45 % 10) % 10 = 5.
    await expect(
      service.findByMemberId('PUMP001-CUST-99999-5'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findUnique).toHaveBeenCalledTimes(1);
  });
});
