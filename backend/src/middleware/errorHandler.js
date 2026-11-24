import { AppError, mapDbError } from '../errors.js';

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
}

export function errorHandler(logger = console) {
  return (err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      err = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
    }
    const appError = err instanceof AppError ? err : mapDbError(err);
    if (appError.status >= 500) logger.error(`[error] ${appError.code}: ${err?.message}`);
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
    });
  };
}
