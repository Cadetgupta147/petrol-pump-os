import {
  allocateQrMemberId,
  formatQrMemberId,
  isValidQrMemberId,
  luhnCheckDigit,
} from './member-id';

// Section 6.1/6.7 — member ID format + checksum. Rule-heavy identity logic:
// the check digit is what makes manual fallback entry (card won't scan, DSM
// types the ID) safe against typos, and the TS implementation must agree
// with the SQL backfill in the human_friendly_member_ids migration.
//
// Phase 0.2 (docs/multi-tenancy-plan.md): pumpCode is now an explicit
// parameter (read from the Pump row for the customer's pump), not a global
// PUMP_CODE env var — every test below passes it explicitly instead of
// relying on process.env.
describe('member-id (Section 6.1/6.7)', () => {
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
    it('formats <pumpCode>-CUST-<padded seq>-<check>', () => {
      expect(formatQrMemberId(1, 'PUMP001')).toBe('PUMP001-CUST-00001-8');
      expect(formatQrMemberId(4521, 'PUMP001')).toBe(
        `PUMP001-CUST-04521-${luhnCheckDigit('04521')}`,
      );
    });

    it('uses whatever pumpCode is passed in', () => {
      expect(formatQrMemberId(1, 'PUMP042')).toBe('PUMP042-CUST-00001-8');
    });

    it('grows past 5 digits without truncation', () => {
      const id = formatQrMemberId(123456, 'PUMP001');
      expect(id).toBe(`PUMP001-CUST-123456-${luhnCheckDigit('123456')}`);
      expect(isValidQrMemberId(id)).toBe(true);
    });

    it('rejects non-positive or fractional sequences', () => {
      expect(() => formatQrMemberId(0, 'PUMP001')).toThrow();
      expect(() => formatQrMemberId(-3, 'PUMP001')).toThrow();
      expect(() => formatQrMemberId(1.5, 'PUMP001')).toThrow();
    });
  });

  describe('isValidQrMemberId (manual fallback entry)', () => {
    it('accepts every generated ID (round-trip)', () => {
      for (const seq of [1, 2, 5, 42, 4521, 99999, 100000]) {
        expect(isValidQrMemberId(formatQrMemberId(seq, 'PUMP001'))).toBe(true);
      }
    });

    it('still accepts IDs minted under a different pump code', () => {
      // Different pump, or a card printed back when this pump's code was
      // different — the validator doesn't pin the pump-code segment at all.
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
    it("increments the given pump's counter atomically and formats the result with that pump's code", async () => {
      const update = jest.fn().mockResolvedValue({ pumpId: 'pump-1', lastSeq: 6 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'pump-1', pumpCode: 'PUMP001' });

      const id = await allocateQrMemberId(
        { memberIdCounter: { update }, pump: { findUniqueOrThrow } } as unknown as Parameters<
          typeof allocateQrMemberId
        >[0],
        'pump-1',
      );

      expect(update).toHaveBeenCalledWith({
        where: { pumpId: 'pump-1' },
        data: { lastSeq: { increment: 1 } },
      });
      expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'pump-1' } });
      expect(id).toBe(`PUMP001-CUST-00006-${luhnCheckDigit('00006')}`);
    });

    it('uses a different pump code for a different pump', async () => {
      const update = jest.fn().mockResolvedValue({ pumpId: 'pump-2', lastSeq: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'pump-2', pumpCode: 'PUMP042' });

      const id = await allocateQrMemberId(
        { memberIdCounter: { update }, pump: { findUniqueOrThrow } } as unknown as Parameters<
          typeof allocateQrMemberId
        >[0],
        'pump-2',
      );

      expect(id).toBe(`PUMP042-CUST-00001-8`);
    });
  });
});
