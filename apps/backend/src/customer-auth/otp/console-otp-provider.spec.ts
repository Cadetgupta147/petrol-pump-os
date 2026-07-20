import { Logger } from '@nestjs/common';
import { ConsoleOtpProvider } from './console-otp-provider';

// Guards against OTP leakage into logs outside development — the same
// concern CustomerAuthService.requestOtp guards for the API response body
// (never include `otp` unless NODE_ENV=development). This provider is the
// ONLY OtpProvider bound in this codebase (see otp-provider.interface.ts),
// including in a hypothetical production deploy until a real SMS/WhatsApp
// gateway is chosen — so an unconditional log call here would leak every
// customer's real login code into production server logs.
describe('ConsoleOtpProvider', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    logSpy.mockRestore();
  });

  it('logs the plaintext OTP when NODE_ENV=development', async () => {
    process.env.NODE_ENV = 'development';
    const provider = new ConsoleOtpProvider();

    await provider.sendOtp('9990000001', '654321');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('654321'));
  });

  it('never logs the plaintext OTP when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const provider = new ConsoleOtpProvider();

    await provider.sendOtp('9990000001', '654321');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [loggedMessage] = logSpy.mock.calls[0] as [string];
    expect(loggedMessage).not.toContain('654321');
  });

  it('never logs the plaintext OTP when NODE_ENV is unset', async () => {
    delete process.env.NODE_ENV;
    const provider = new ConsoleOtpProvider();

    await provider.sendOtp('9990000001', '654321');

    const [loggedMessage] = logSpy.mock.calls[0] as [string];
    expect(loggedMessage).not.toContain('654321');
  });
});
