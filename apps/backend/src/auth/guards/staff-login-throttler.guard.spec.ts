import { StaffLoginThrottlerGuard } from './staff-login-throttler.guard';

// Focused unit test on getTracker() directly, without spinning up a full
// HTTP server — same style as jwt.strategy.spec.ts's direct test of
// JwtStrategy.validate(). getTracker is `protected`, so we reach through
// the prototype exactly as `strategy.validate(...)` does for JwtStrategy;
// TypeScript's `protected` is a compile-time-only restriction, so this is a
// completely ordinary runtime call, not a hack.
describe('StaffLoginThrottlerGuard', () => {
  // ThrottlerGuard's own constructor requires options/storage/reflector
  // (see @nestjs/throttler's ThrottlerGuard) — none of which getTracker()
  // touches, so Object.create sidesteps needing to construct a real
  // instance just to call one method on it (mirrors this repo's general
  // preference for the smallest test setup that exercises the real code
  // path — see this guard's own getTracker() for why the composite key
  // matters).
  const guard = Object.create(
    StaffLoginThrottlerGuard.prototype,
  ) as StaffLoginThrottlerGuard;

  // Cast through `any` only to reach the protected method from a test —
  // getTracker's own signature (Record<string, any>) is preserved for the
  // call itself.
  const getTracker = (guard as any).getTracker.bind(guard) as (
    req: Record<string, unknown>,
  ) => Promise<string>;

  it('combines IP and phone into a composite tracker key when phone is present', async () => {
    const tracker = await getTracker({ ip: '10.0.0.5', body: { phone: '9990000001' } });
    expect(tracker).toBe('10.0.0.5-9990000001');
  });

  it('produces different keys for different phones at the same IP (so one shared office IP does not share one budget)', async () => {
    const trackerA = await getTracker({ ip: '10.0.0.5', body: { phone: '9990000001' } });
    const trackerB = await getTracker({ ip: '10.0.0.5', body: { phone: '9990000002' } });
    expect(trackerA).not.toBe(trackerB);
  });

  it('falls back to IP-only keying when body is missing entirely', async () => {
    const tracker = await getTracker({ ip: '10.0.0.5' });
    expect(tracker).toBe('10.0.0.5');
  });

  it('falls back to IP-only keying when body.phone is missing', async () => {
    const tracker = await getTracker({ ip: '10.0.0.5', body: {} });
    expect(tracker).toBe('10.0.0.5');
  });

  it('falls back to IP-only keying when body.phone is not a string (malformed body, pre-ValidationPipe)', async () => {
    const tracker = await getTracker({ ip: '10.0.0.5', body: { phone: 12345 } });
    expect(tracker).toBe('10.0.0.5');
  });

  it('falls back to IP-only keying when body.phone is an empty string', async () => {
    const tracker = await getTracker({ ip: '10.0.0.5', body: { phone: '' } });
    expect(tracker).toBe('10.0.0.5');
  });
});
