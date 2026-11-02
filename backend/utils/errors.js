/**
 * AppError - Operational error with HTTP status code.
 * These errors are safe to send to the client.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * ValidationError - Multiple validation errors with HTTP status code.
 * Can hold multiple validation issues.
 *
 * @param {string[]|string} errors
 * @param {number} statusCode
 * @param {object} [options]
 * @param {object} [options.fieldErrors] fieldApiName → message, so a client can
 *   highlight the specific inputs that failed rather than just showing a toast.
 * @param {string} [options.message]     overrides the default (first error).
 */
class ValidationError extends Error {
  constructor(errors, statusCode = 400, { fieldErrors = null, message, issues = null } = {}) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(message || list[0]);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errors = list;
    this.isValidationError = true;
    if (fieldErrors && Object.keys(fieldErrors).length > 0) {
      this.fieldErrors = fieldErrors;
    }
    // Every problem as { message, errorField } ('' = top of record), so a
    // client can list them all at once (BRD 6.2).
    if (issues?.length) this.issues = issues;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * asyncHandler - Wraps async route handlers to catch errors.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * sendSuccess - Standard success response.
 */
const sendSuccess = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    ...data,
  });
};

/**
 * paginate - Build pagination response.
 */
const paginate = (data, total, page, limit) => ({
  data,
  pagination: {
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  },
});

export { AppError, ValidationError, asyncHandler, sendSuccess, paginate };
