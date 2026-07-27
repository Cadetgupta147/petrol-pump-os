import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// The shape returned to every client for every unhandled/unexpected error.
// Deliberately minimal — no `error` field carrying the original exception's
// message, no `stack`, nothing DB- or filesystem-shaped. Deliberately-thrown
// HttpExceptions (see below) bypass this and keep their own message.
interface SafeErrorResponse {
  statusCode: number;
  message: string;
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again or contact support.';

// Catches every exception that reaches Nest's exception zone — thrown
// HttpExceptions (NotFoundException, BadRequestException, etc. — the large
// majority of errors this codebase throws deliberately, e.g.
// auth.service.ts, staff-management.service.ts), raw Prisma errors that
// escaped a service's own try/catch (Prisma.PrismaClientKnownRequestError,
// PrismaClientValidationError, ...), and anything else (a bug throwing a
// plain Error, a string, etc.).
//
// The rule (CLAUDE.md): the client NEVER sees internals — no stack trace,
// no raw Prisma error message (which can contain SQL/column/table names),
// no file paths — in any environment. There is deliberately no
// "verbose in development" branch here; that's not a carve-out CLAUDE.md
// allows for this filter.
//
// `@Catch()` with no argument means "catch everything", not just
// HttpException subclasses — that's what lets this filter also intercept
// raw/unexpected errors instead of only ones the framework already
// recognises as HTTP-shaped.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Always log the full, real error server-side — this is the only place
    // that information survives once this filter runs, since the response
    // to the client is about to be sanitized.
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.originalUrl ?? request.url}`,
      exception as Error,
    );

    const safeResponse = this.toSafeResponse(exception);
    response.status(safeResponse.statusCode).json(safeResponse);
  }

  // Deliberately-thrown HttpExceptions (UnauthorizedException,
  // NotFoundException, ConflictException, etc.) already carry a status code
  // and a message application code chose on purpose to be safe to show a
  // client — preserve both as-is. Everything else (raw Prisma errors,
  // plain Errors, non-Error throws) is an UNEXPECTED failure and always
  // collapses to a generic 500, regardless of what the underlying error
  // actually says, so nothing it contains can leak.
  private toSafeResponse(exception: unknown): SafeErrorResponse {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // HttpException's response body can be a plain string (the common
      // case, e.g. `throw new NotFoundException('Customer not found')`) or
      // an object with a `message` field (e.g. class-validator's
      // ValidationPipe errors, or `{ message, error, statusCode }` some
      // Nest internals construct) — normalize both to a plain string.
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] })?.message ?? exception.message);
      return {
        statusCode: status,
        message: Array.isArray(message) ? message.join(', ') : message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: GENERIC_MESSAGE,
    };
  }
}
