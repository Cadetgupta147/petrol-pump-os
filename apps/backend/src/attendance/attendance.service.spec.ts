import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 12 — staff attendance hours-worked summary. Not explicitly called
// out as "rule-heavy" by the task spec the way aging/loyalty-cost were, but
// the hours computation (open-session handling, day-attribution) is real
// date arithmetic worth a sanity check.
describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: {
    attendanceLog: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      attendanceLog: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  describe('clockIn', () => {
    it('rejects a second clock-in while one is already open for that staff member', async () => {
      prisma.attendanceLog.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.clockIn({ staffId: 'staff-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.attendanceLog.create).not.toHaveBeenCalled();
    });
  });

  describe('clockOut', () => {
    it('404s on an unknown id', async () => {
      prisma.attendanceLog.findUnique.mockResolvedValue(null);

      await expect(service.clockOut('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects clocking out an already-closed session', async () => {
      prisma.attendanceLog.findUnique.mockResolvedValue({
        id: 'log-1',
        clockOut: new Date(),
      });

      await expect(service.clockOut('log-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('getSummary', () => {
    it('sums hours worked per staff member across multiple closed sessions', async () => {
      prisma.attendanceLog.findMany.mockResolvedValue([
        {
          staffId: 'staff-1',
          staff: { name: 'Ramesh' },
          clockIn: new Date('2026-07-01T08:00:00Z'),
          clockOut: new Date('2026-07-01T16:00:00Z'), // 8h
        },
        {
          staffId: 'staff-1',
          staff: { name: 'Ramesh' },
          clockIn: new Date('2026-07-02T08:00:00Z'),
          clockOut: new Date('2026-07-02T12:00:00Z'), // 4h
        },
      ]);

      const summary = await service.getSummary({
        from: '2026-07-01',
        to: '2026-07-31',
      });

      expect(summary.staff).toEqual([
        {
          staffId: 'staff-1',
          staffName: 'Ramesh',
          totalHoursWorked: 12,
          sessionCount: 2,
          stillClockedIn: false,
        },
      ]);
    });

    it('counts a still-open session up to now and flags stillClockedIn', async () => {
      const clockIn = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
      prisma.attendanceLog.findMany.mockResolvedValue([
        {
          staffId: 'staff-1',
          staff: { name: 'Ramesh' },
          clockIn,
          clockOut: null,
        },
      ]);

      const summary = await service.getSummary({
        from: '2026-07-01',
        to: '2026-07-31',
      });

      expect(summary.staff[0].stillClockedIn).toBe(true);
      expect(summary.staff[0].totalHoursWorked).toBeCloseTo(3, 1);
    });

    it('always includes an explicit salaryAndAdvancesNote rather than a silent 0', async () => {
      prisma.attendanceLog.findMany.mockResolvedValue([]);

      const summary = await service.getSummary({
        from: '2026-07-01',
        to: '2026-07-31',
      });

      expect(summary.salaryAndAdvancesNote).toEqual(expect.any(String));
      expect(summary.staff).toEqual([]);
    });

    it('sorts staff by total hours worked, descending', async () => {
      prisma.attendanceLog.findMany.mockResolvedValue([
        {
          staffId: 'staff-low',
          staff: { name: 'Low Hours' },
          clockIn: new Date('2026-07-01T08:00:00Z'),
          clockOut: new Date('2026-07-01T10:00:00Z'), // 2h
        },
        {
          staffId: 'staff-high',
          staff: { name: 'High Hours' },
          clockIn: new Date('2026-07-01T08:00:00Z'),
          clockOut: new Date('2026-07-01T18:00:00Z'), // 10h
        },
      ]);

      const summary = await service.getSummary({
        from: '2026-07-01',
        to: '2026-07-31',
      });

      expect(summary.staff.map((s) => s.staffId)).toEqual([
        'staff-high',
        'staff-low',
      ]);
    });
  });
});
