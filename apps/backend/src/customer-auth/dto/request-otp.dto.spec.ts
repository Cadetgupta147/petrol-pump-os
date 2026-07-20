import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestOtpDto } from './request-otp.dto';

// Confirms the actual Nest request pipeline (main.ts's global ValidationPipe
// runs plainToInstance THEN validate — the same two calls reproduced here)
// normalizes phone BEFORE validating it, not just that the standalone
// normalizeIndianMobile() helper works in isolation (see ../phone.util.spec.ts).
describe('RequestOtpDto — phone normalization through the validation pipeline', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
  ])('normalizes %s to %s and passes validation', async (input, expected) => {
    const instance = plainToInstance(RequestOtpDto, { phone: input });
    const errors = await validate(instance);

    expect(errors).toHaveLength(0);
    expect(instance.phone).toBe(expected);
  });

  it('rejects a value that still isn\'t a valid 10-digit Indian mobile after normalization', async () => {
    const instance = plainToInstance(RequestOtpDto, { phone: '12345' });
    const errors = await validate(instance);

    expect(errors.length).toBeGreaterThan(0);
  });
});
