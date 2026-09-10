export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'Resource not found') =>
  new HttpError(404, 'not_found', message);

export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export const tooManyRequests = (message = 'Too many requests') =>
  new HttpError(429, 'too_many_requests', message);
