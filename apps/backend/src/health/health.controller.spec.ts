import { Logger } from '@nestjs/common';
import { HealthController } from './health.controller';

// Go-live checklist: this route is @Public() (unauthenticated) — guards
// against the raw Prisma connection error (host/port/connection detail)
// ever riding along in the response body again.
describe('HealthController', () => {
  it('reports database: up when the DB responds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as never);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
    expect(result).not.toHaveProperty('databaseError');
  });

  it('reports database: down without leaking the underlying error to the client', async () => {
    const secretError = new Error(
      "Can't reach database server at `db.abcdef.supabase.co:5432`",
    );
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(secretError) };
    const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const controller = new HealthController(prisma as never);

    const result = await controller.check();

    expect(result.database).toBe('down');
    expect(result).not.toHaveProperty('databaseError');
    expect(JSON.stringify(result)).not.toContain('supabase.co');
    // The real error is still surfaced server-side, just not to the caller.
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.any(String), secretError);
    loggerErrorSpy.mockRestore();
  });
});
