import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter';

// Builds a minimal ArgumentsHost stand-in exposing just what
// GlobalExceptionFilter reads: switchToHttp().getResponse()/getRequest().
// Mirrors the ExecutionContext-mocking convention used elsewhere in this
// repo (see src/auth/guards/roles.guard.spec.ts) rather than pulling in a
// full Nest testing module / real HTTP server for a filter this small.
function makeHost(request: { method: string; originalUrl: string }) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  it('passes a deliberately-thrown HttpException through with its own status and message unchanged', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = makeHost({ method: 'GET', originalUrl: '/customers/123' });

    filter.catch(new NotFoundException('Customer not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Customer not found',
      correlationId: expect.any(String) as string,
    });
  });

  it('normalizes an HttpException whose response body is an object (e.g. ValidationPipe-style errors)', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = makeHost({ method: 'POST', originalUrl: '/staff' });

    // class-validator/ValidationPipe throws a BadRequestException whose
    // getResponse() is an object with a `message` array, not a plain
    // string — confirm the filter flattens that instead of leaking
    // `[object Object]` or crashing.
    const exception = new (class extends NotFoundException {
      getResponse() {
        return { statusCode: 400, message: ['phone must be a valid phone number'], error: 'Bad Request' };
      }
    })();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'phone must be a valid phone number',
      correlationId: expect.any(String) as string,
    });
  });

  it('collapses a raw Error to a generic 500 and does not leak its message or stack to the client', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = makeHost({ method: 'GET', originalUrl: '/bills' });

    const secretError = new Error('connect ECONNREFUSED 10.0.0.5:5432 at /home/app/dist/prisma.js:42');

    filter.catch(secretError, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).not.toContain('ECONNREFUSED');
    expect(body.message).not.toContain('10.0.0.5');
    expect(body.message).not.toContain('.js:42');
    expect(body).not.toHaveProperty('stack');
    expect(typeof body.correlationId).toBe('string');
  });

  it('collapses a raw Prisma error (e.g. a unique constraint violation that escaped application code) to a generic 500', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = makeHost({ method: 'POST', originalUrl: '/customers' });

    // Constructed the way Prisma itself constructs these — includes an
    // internal `meta` payload (column/constraint names) that must never
    // reach the client.
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`phone`)',
      { code: 'P2002', clientVersion: '6.19.3', meta: { target: ['phone'] } },
    );

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: 500,
      message: expect.any(String),
      correlationId: expect.any(String) as string,
    });
    expect(body.message).not.toContain('Unique constraint');
    expect(body.message).not.toContain('phone');
    expect(body.message).not.toContain('P2002');
  });

  it('collapses a non-Error throw (e.g. a plain string) to a generic 500', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = makeHost({ method: 'GET', originalUrl: '/reports' });

    filter.catch('something went wrong internally', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: expect.any(String),
      correlationId: expect.any(String) as string,
    });
  });

  it('logs the real underlying error (message, stack, and request path) via Logger.error, regardless of what is sent to the client', () => {
    const filter = new GlobalExceptionFilter();
    const loggerErrorSpy = jest.spyOn((filter as unknown as { logger: { error: jest.Mock } }).logger, 'error');
    const { host } = makeHost({ method: 'DELETE', originalUrl: '/staff/42' });

    const realError = new Error('unexpected null reference in staff-management.service.ts');

    filter.catch(realError, host);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('DELETE /staff/42'),
      realError,
    );
  });

  it('stamps the client-facing correlationId into the same log line, so a client-reported id can be grepped straight back to the full error', () => {
    const filter = new GlobalExceptionFilter();
    const loggerErrorSpy = jest.spyOn((filter as unknown as { logger: { error: jest.Mock } }).logger, 'error');
    const { host, json } = makeHost({ method: 'GET', originalUrl: '/bills' });

    filter.catch(new Error('boom'), host);

    const { correlationId } = json.mock.calls[0][0] as { correlationId: string };
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(correlationId),
      expect.any(Error),
    );
  });
});
