import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { UpstreamError } from '../clients/http.ts';

export function unconfigured(service: string): HTTPException {
  return new HTTPException(503, {
    res: Response.json({
      error: `${service}_unconfigured`,
      hint: `Set ${service.toUpperCase()}_BASE_URL and optional ${service.toUpperCase()}_TOKEN.`,
    }, { status: 503 }),
  });
}

export function upstreamFailure(error: unknown): Response {
  if (error instanceof UpstreamError) {
    return Response.json({
      error: 'upstream_error',
      service: error.service,
      path: error.path,
      status: error.status,
      message: error.message,
    }, { status: 502 });
  }
  if (error instanceof ZodError) {
    return Response.json({
      error: 'upstream_contract_error',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    }, { status: 502 });
  }
  throw error;
}