import { NextRequest, NextResponse } from 'next/server';
import { v7 as uuidv7 } from 'uuid';
import { ZodSchema } from 'zod';
import { AppError } from '@rota/shared';
import { verifyAccessToken } from '../auth/jwt';
import { env } from '../config/env';
import { markUserWrite, shouldReadPrimary } from '../data/router';
import { runInRequestContext, TenantScope } from '../data/scope';
import { logger } from '../log';

export type RouteAuth = 'public' | 'access' | 'refresh' | 'webhook';

export interface WithApiOptions<TBody = unknown, TQuery = unknown> {
  auth: RouteAuth;
  status?: number;
  roles?: ('OWNER' | 'MANAGER' | 'STAFF')[];
  rateLimit?: {
    limit: number;
    windowSeconds: number;
  };
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
}

export interface ApiContext<TBody = unknown, TQuery = unknown> {
  req: NextRequest;
  params: Record<string, string | string[] | undefined>;
  requestId: string;
  body: TBody;
  query: TQuery;
  userId?: string;
  teamId?: string;
  role?: 'OWNER' | 'MANAGER' | 'STAFF';
}

export type ApiHandler<TResult, TBody = unknown, TQuery = unknown> = (
  ctx: ApiContext<TBody, TQuery>,
) => Promise<TResult>;

export function withApi<TResult, TBody = unknown, TQuery = unknown>(
  options: WithApiOptions<TBody, TQuery>,
  handler: ApiHandler<TResult, TBody, TQuery>,
) {
  return async function handleRequest(
    req: NextRequest,
    context: { params: Promise<Record<string, string | string[] | undefined>> },
  ): Promise<NextResponse> {
    const requestId = uuidv7();
    const resolvedParams = await context.params;

    try {
      // 1. Rate limiting placeholder (runs before team lookup)

      // 2. Auth check (L-15, SEC-1, SEC-3)
      let userId: string | undefined;
      if (options.auth === 'access') {
        const authHeader = req.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Missing or invalid authorization header');
        }
        const token = authHeader.slice(7).trim();
        const verified = await verifyAccessToken(token);
        userId = verified.userId;
      }

      // 3. Body validation
      let parsedBody = undefined as unknown as TBody;
      if (options.body) {
        let rawBody: unknown;
        try {
          rawBody = await req.json();
        } catch {
          throw new AppError('VALIDATION_FAILED', 400, 'Invalid JSON body');
        }
        const parseResult = options.body.safeParse(rawBody);
        if (!parseResult.success) {
          throw new AppError('VALIDATION_FAILED', 400, parseResult.error.message);
        }
        parsedBody = parseResult.data;
      }

      // 4. Query validation
      let parsedQuery = undefined as unknown as TQuery;
      if (options.query) {
        const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
        const parseResult = options.query.safeParse(searchParams);
        if (!parseResult.success) {
          throw new AppError('VALIDATION_FAILED', 400, parseResult.error.message);
        }
        parsedQuery = parseResult.data;
      }

      // 5. Determine read routing flags and tenant scope (PRD 7.5, 7.10)
      const teamId =
        typeof resolvedParams['teamId'] === 'string' ? resolvedParams['teamId'] : undefined;
      const headerFlag = req.headers.get('x-read-primary') === '1';
      const readPrimary = await shouldReadPrimary({
        userId,
        headerFlag,
      });
      const readSource: 'primary' | 'replica' = readPrimary ? 'primary' : 'replica';

      let scope: TenantScope | undefined;
      if (teamId) {
        scope = { type: 'team', teamId };
      }

      // 6. Invoke handler inside AsyncLocalStorage tenant scope & read-routing context
      const result = await runInRequestContext(
        {
          requestId,
          scope,
          readPrimary,
          readSource,
        },
        async () => {
          return handler({
            req,
            params: resolvedParams,
            requestId,
            body: parsedBody,
            query: parsedQuery,
            userId,
            teamId,
          });
        },
      );

      // 7. Successful write triggers RYOW marker (PRD 7.5, AGENTS.md A-9)
      const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
      if (isWriteMethod && userId) {
        await markUserWrite(userId);
      }

      const responseStatus = options.status ?? 200;
      const response = NextResponse.json(result ?? { ok: true }, { status: responseStatus });
      response.headers.set('X-Request-Id', requestId);
      response.headers.set('Cache-Control', 'private, no-store');

      if (env.NODE_ENV !== 'production') {
        response.headers.set('X-Read-Source', readSource);
      }

      return response;
    } catch (err: unknown) {
      if (err instanceof AppError) {
        logger.warn({ err, requestId }, 'Handled application error');
        const errResponse = NextResponse.json(
          {
            error: {
              code: err.code,
              message: err.message,
              requestId,
            },
          },
          { status: err.status },
        );
        if (err.retryAfter !== undefined) {
          errResponse.headers.set('Retry-After', String(err.retryAfter));
        }
        errResponse.headers.set('X-Request-Id', requestId);
        return errResponse;
      }

      logger.error({ err, requestId }, 'Unhandled internal server error');
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL',
            message: 'An internal error occurred',
            requestId,
          },
        },
        { status: 500 },
      );
    }
  };
}
