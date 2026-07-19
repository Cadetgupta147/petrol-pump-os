import {
  allocateQrMemberId,
  formatQrMemberId,
  isValidQrMemberId,
  luhnCheckDigit,
  pumpCode,
} from './member-id';

// Section 6.1/6.7 — member ID format + checksum. Rule-heavy identity logic:
// the check digit is what makes manual fallback entry (card won't scan, DSM
// types the ID) safe against typos, and the TS implementation must agree
// with the SQL backfill in the human_friendly_member_ids migration.
describe('member-id (Section 6.1/6.7)', () => {
  const originalPumpCode = process.env.PUMP_CODE;

  afterEach(() => {
    if (originalPumpCode === undefined) {
      delete process.env.PUMP_CODE;
    } else {
      process.env.PUMP_CODE = originalPumpCode;
    }
  });

  describe('luhnCheckDigit', () => {
    it('matches the classic Luhn reference value', () => {
      // Textbook example: payload 7992739871 -> check digit 3.
      expect(luhnCheckDigit('7992739871')).toBe(3);
    });

    it('matches the SQL backfill values observed in the dev DB', () => {
      // The migration produced PUMP001-CUST-00001-8 ... -00005-9; if these
      // ever disagree, the TS generator and the SQL backfill have drifted.
      expect(luhnCheckDigit('00001')).toBe(8);
      expect(luhnCheckDigit('00002')).toBe(6);
      expect(luhnCheckDigit('00003')).toBe(4);
      expect(luhnCheckDigit('00004')).toBe(2);
      expect(luhnCheckDigit('00005')).toBe(9);
    });

    it('rejects non-digit input loudly', () => {
      expect(() => luhnCheckDigit('12a45')).toThrow();
      expect(() => luhnCheckDigit('')).toThrow();
    });
  });

  describe('formatQrMemberId', () => {
    it('formats <PUMP_CODE>-CUST-<padded seq>-<check>', () => {
      delete process.env.PUMP_CODE;
      expect(formatQrMemberId(1)).toBe('PUMP001-CUST-00001-8');
      expect(formatQrMemberId(4521)).toBe(
        `PUMP001-CUST-04521-${luhnCheckDigit('04521')}`,
      );
    });

    it('respects the PUMP_CODE env var for new IDs', () => {
      process.env.PUMP_CODE = 'PUMP042';
      expect(formatQrMemberId(1)).toBe('PUMP042-CUST-00001-8');
      expect(pumpCode()).toBe('PUMP042');
    });

    it('grows past 5 digits without truncation', () => {
      delete process.env.PUMP_CODE;
      const id = formatQrMemberId(123456);
      expect(id).toBe(`PUMP001-CUST-123456-${luhnCheckDigit('123456')}`);
      expect(isValidQrMemberId(id)).toBe(true);
    });

    it('rejects non-positive or fractional sequences', () => {
      expect(() => formatQrMemberId(0)).toThrow();
      expect(() => formatQrMemberId(-3)).toThrow();
      expect(() => formatQrMemberId(1.5)).toThrow();
    });
  });

  describe('isValidQrMemberId (manual fallback entry)', () => {
    it('accepts every generated ID (round-trip)', () => {
      delete process.env.PUMP_CODE;
      for (const seq of [1, 2, 5, 42, 4521, 99999, 100000]) {
        expect(isValidQrMemberId(formatQrMemberId(seq))).toBe(true);
      }
    });

    it('still accepts IDs minted under an older pump code', () => {
      process.env.PUMP_CODE = 'PUMPNEW';
      // Card printed back when the code was PUMP001 must keep validating.
      expect(isValidQrMemberId('PUMP001-CUST-00001-8')).toBe(true);
    });

    it('catches a single-digit typo via the check digit', () => {
      // Valid: PUMP001-CUST-00001-8. Typo in the sequence:
      expect(isValidQrMemberId('PUMP001-CUST-00002-8')).toBe(false);
      // Typo in the check digit itself:
      expect(isValidQrMemberId('PUMP001-CUST-00001-9')).toBe(false);
    });

    it('rejects malformed shapes outright', () => {
      expect(isValidQrMemberId('')).toBe(false);
      expect(isValidQrMemberId('PUMP001-CUST-00001')).toBe(false); // no check
      expect(isValidQrMemberId('PUMP001-STAFF-00001-8')).toBe(false);
      expect(isValidQrMemberId('PUMP001-CUST-001-8')).toBe(false); // < 5 digits
      expect(isValidQrMemberId('cmrqnttkj0001ujr414b4gae6')).toBe(false); // old cuid
    });
  });

  describe('allocateQrMemberId', () => {
    it('increments the singleton counter atomically and formats the result', async () => {
      delete process.env.PUMP_CODE;
      const update = jest.fn().mockResolvedValue({ id: 'singleton', lastSeq: 6 });

      const id = await allocateQrMemberId({
        memberIdCounter: { update },
      } as unknown as Parameters<typeof allocateQrMemberId>[0]);

      expect(update).toHaveBeenCalledWith({
        where: { id: 'singleton' },
        data: { lastSeq: { increment: 1 } },
      });
      expect(id).toBe(`PUMP001-CUST-00006-${luhnCheckDigit('00006')}`);
    });
  });
});
