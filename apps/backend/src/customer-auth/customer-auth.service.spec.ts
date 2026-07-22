import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CustomerAuthService } from './customer-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { OTP_PROVIDER } from './otp/otp-provider.interface';
import {
  MAX_OTP_REQUESTS_PER_PHONE_PER_WINDOW,
  MAX_OTP_VERIFY_ATTEMPTS,
  OTP_TTL_SECONDS,
} from './otp.constants';

// Section 5 — rule-heavy OTP login logic (CLAUDE.md: write tests for
// rule-heavy logic). Covers: OTP generation/storage, the "one live OTP per
// phone" + rolling-window rate limits on request(), and expiry/lockout/replay
// protection + the "must already have a Customer record" rule on verify().
describe('CustomerAuthService', () => {
  let service: CustomerAuthService;
  let prisma: {
    customerOtp: {
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    customer: { findFirst: jest.Mock };
  };
  let jwtService: { signAsync: jest.Mock };
  let otpProvider: { sendOtp: jest.Mock };
  const originalNodeEnv = process.env.NODE_ENV;

  interface CustomerOtpCreateArgs {
    data: {
      phone: string;
      customerId?: string | null;
      codeHash: string;
      expiresAt: Date;
    };
  }

  interface CustomerOtpUpdateArgs {
    where: { id: string };
    data: { attemptCount?: number; consumedAt?: Date };
  }

  beforeEach(async () => {
    prisma = {
      customerOtp: {
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      customer: { findFirst: jest.fn() },
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.customer.jwt') };
    otpProvider = { sendOtp: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: OTP_PROVIDER, useValue: otpProvider },
      ],
    }).compile();

    service = module.get(CustomerAuthService);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('requestOtp', () => {
    it('creates an OTP row, sends it via the provider, and returns requestId + expiresInSeconds', async () => {
      process.env.NODE_ENV = 'production';
      prisma.customerOtp.findFirst.mockResolvedValue(null);
      prisma.customerOtp.count.mockResolvedValue(0);
      prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
      let capturedCreateArgs: CustomerOtpCreateArgs | undefined;
      prisma.customerOtp.create.mockImplementation((args: CustomerOtpCreateArgs) => {
        capturedCreateArgs = args;
        return Promise.resolve({
          id: 'otp-row-1',
          ...args.data,
          attemptCount: 0,
          consumedAt: null,
          createdAt: new Date(),
        });
      });

      const result = await service.requestOtp({ phone: '9990000001' });

      expect(result.requestId).toBe('otp-row-1');
      expect(result.expiresInSeconds).toBe(OTP_TTL_SECONDS);
      expect((result as { otp?: string }).otp).toBeUndefined(); // never leaked outside dev
      expect(otpProvider.sendOtp).toHaveBeenCalledWith('9990000001', expect.stringMatching(/^\d{6}$/));

      expect(capturedCreateArgs?.data.phone).toBe('9990000001');
      expect(capturedCreateArgs?.data.customerId).toBe('customer-1');
    });

    it('includes the plaintext OTP in the response only when NODE_ENV=development', async () => {
      process.env.NODE_ENV = 'development';
      prisma.customerOtp.findFirst.mockResolvedValue(null);
      prisma.customerOtp.count.mockResolvedValue(0);
      prisma.customer.findFirst.mockResolvedValue(null);
      let capturedCodeHash = '';
      prisma.customerOtp.create.mockImplementation((args: CustomerOtpCreateArgs) => {
        capturedCodeHash = args.data.codeHash;
        return Promise.resolve({
          id: 'otp-row-2',
          ...args.data,
          attemptCount: 0,
          consumedAt: null,
          createdAt: new Date(),
        });
      });

      const result = (await service.requestOtp({ phone: '9990000002' })) as { otp: string };

      expect(result.otp).toMatch(/^\d{6}$/);
      await expect(bcrypt.compare(result.otp, capturedCodeHash)).resolves.toBe(true);
    });

    it('rejects with 429 when a live (unexpired, unconsumed) OTP already exists for the phone', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue({
        id: 'otp-existing',
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
      });

      await expect(service.requestOtp({ phone: '9990000003' })).rejects.toBeInstanceOf(HttpException);
      expect(prisma.customerOtp.create).not.toHaveBeenCalled();
      expect(otpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it('rejects with 429 once the rolling-window request cap is hit, even with no live OTP', async () => {
      prisma.customerOtp.findFirst.mockResolvedValue(null);
      prisma.customerOtp.count.mockResolvedValue(MAX_OTP_REQUESTS_PER_PHONE_PER_WINDOW);

      await expect(service.requestOtp({ phone: '9990000004' })).rejects.toBeInstanceOf(HttpException);
      expect(prisma.customerOtp.create).not.toHaveBeenCalled();
      expect(otpProvider.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    async function makeOtpRow(overrides: Partial<Record<string, unknown>> = {}) {
      const code = '123456';
      const codeHash = await bcrypt.hash(code, 10);
      return {
        row: {
          id: 'otp-row-1',
          phone: '9990000001',
          customerId: null,
          codeHash,
          expiresAt: new Date(Date.now() + 60_000),
          attemptCount: 0,
          consumedAt: null,
          createdAt: new Date(),
          ...overrides,
        },
        code,
      };
    }

    it('issues a customer-scoped JWT + customer summary on correct OTP for a registered phone', async () => {
      const { row, code } = await makeOtpRow();
      prisma.customerOtp.findUnique.mockResolvedValue(row);
      let capturedUpdateArgs: CustomerOtpUpdateArgs | undefined;
      prisma.customerOtp.update.mockImplementation((args: CustomerOtpUpdateArgs) => {
        capturedUpdateArgs = args;
        return Promise.resolve({ ...row, ...args.data });
      });
      prisma.customer.findFirst.mockResolvedValue({
        id: 'customer-1',
        pumpId: 'pump-1',
        name: 'Test Customer',
        phone: '9990000001',
        qrMemberId: 'PUMP001-CUST-00001-8',
        vehicleNumber: 'MH12AB1234',
        account: { tokenVersion: 2 },
      });

      const result = await service.verifyOtp({ phone: '9990000001', otp: code, requestId: 'otp-row-1' });

      expect(result.accessToken).toBe('signed.customer.jwt');
      expect(result.customer).toEqual({
        id: 'customer-1',
        name: 'Test Customer',
        phone: '9990000001',
        qrMemberId: 'PUMP001-CUST-00001-8',
        vehicleNumber: 'MH12AB1234',
      });
      // tokenVersion must be embedded as-is from the account row at
      // issuance time — this is the claim CustomerJwtStrategy re-checks on
      // every request (Phase 0.2: moved from Customer to CustomerAccount).
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'customer-1',
          pumpId: 'pump-1',
          phone: '9990000001',
          scope: 'customer',
          tokenVersion: 2,
          sub: 'customer-1',
        }),
      );
      // Single-use: the row must be marked consumed.
      expect(capturedUpdateArgs?.where).toEqual({ id: 'otp-row-1' });
      expect(capturedUpdateArgs?.data.consumedAt).toBeInstanceOf(Date);
    });

    it('rejects an unknown requestId with UnauthorizedException (no user enumeration)', async () => {
      prisma.customerOtp.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyOtp({ phone: '9990000001', otp: '123456', requestId: 'nope' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the phone does not match the OTP row (requestId/phone mismatch)', async () => {
      const { row, code } = await makeOtpRow({ phone: '9990000009' });
      prisma.customerOtp.findUnique.mockResolvedValue(row);

      await expect(
        service.verifyOtp({ phone: '9990000001', otp: code, requestId: 'otp-row-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired OTP', async () => {
      const { row, code } = await makeOtpRow({ expiresAt: new Date(Date.now() - 1000) });
      prisma.customerOtp.findUnique.mockResolvedValue(row);

      await expect(
        service.verifyOtp({ phone: '9990000001', otp: code, requestId: 'otp-row-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an already-consumed OTP (replay protection)', async () => {
      const { row, code } = await makeOtpRow({ consumedAt: new Date() });
      prisma.customerOtp.findUnique.mockResolvedValue(row);

      await expect(
        service.verifyOtp({ phone: '9990000001', otp: code, requestId: 'otp-row-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // Correct code, but already consumed — must not re-issue a token.
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects a wrong OTP and increments attemptCount', async () => {
      const { row } = await makeOtpRow();
      prisma.customerOtp.findUnique.mockResolvedValue(row);
      prisma.customerOtp.update.mockResolvedValue({ ...row, attemptCount: 1 });

      await expect(
        service.verifyOtp({ phone: '9990000001', otp: '000000', requestId: 'otp-row-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.customerOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp-row-1' },
        data: { attemptCount: 1 },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('locks out (marks consumed) once attemptCount reaches the max on a wrong guess', async () => {
      const { row } = await makeOtpRow({ attemptCount: MAX_OTP_VERIFY_ATTEMPTS - 1 });
      prisma.customerOtp.findUnique.mockResolvedValue(row);
      let capturedUpdateArgs: CustomerOtpUpdateArgs | undefined;
      prisma.customerOtp.update.mockImplementation((args: CustomerOtpUpdateArgs) => {
        capturedUpdateArgs = args;
        return Promise.resolve({ ...row, ...args.data });
      });

      await expect(
        service.verifyOtp({ phone: '9990000001', otp: '000000', requestId: 'otp-row-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(capturedUpdateArgs?.where).toEqual({ id: 'otp-row-1' });
      expect(capturedUpdateArgs?.data.attemptCount).toBe(MAX_OTP_VERIFY_ATTEMPTS);
      expect(capturedUpdateArgs?.data.consumedAt).toBeInstanceOf(Date);
    });

    it('rejects a row already at/over the max attempt count without even checking the code', async () => {
      const { row, code } = await makeOtpRow({ attemptCount: MAX_OTP_VERIFY_ATTEMPTS });
      prisma.customerOtp.findUnique.mockResolvedValue(row);
      prisma.customerOtp.update.mockResolvedValue({ ...row, consumedAt: new Date() });

      // Even the CORRECT code is rejected once locked out.
      await expect(
        service.verifyOtp({ phone: '9990000001', otp: code, requestId: 'otp-row-1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects with a customer-facing NotFoundException when the OTP is correct but no Customer exists for the phone', async () => {
      const { row, code } = await makeOtpRow();
      prisma.customerOtp.findUnique.mockResolvedValue(row);
      prisma.customer.findFirst.mockResolvedValue(null);

      const call = service.verifyOtp({ phone: '9990000001', otp: code, requestId: 'otp-row-1' });
      await expect(call).rejects.toBeInstanceOf(NotFoundException);
      await expect(call).rejects.toMatchObject({
        message: "This number isn't registered yet — ask at the pump counter to get set up.",
      });
      // Not consumed — an unregistered phone shouldn't burn the caller's one
      // valid OTP entry (they may register and retry within the same window).
      expect(prisma.customerOtp.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
