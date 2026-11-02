import logger from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errors.js';

/**
 * Global error handler middleware.
 * Normalizes all errors into consistent API responses.
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  // Log the error
  if (err.statusCode >= 500 || !err.isOperational) {
    logger.error(`[${req.method}] ${req.path}`, {
      message: err.message,
      stack: err.stack,
      userId: req.user?._id,
      tenantId: req.tenantId,
    });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const value = err.keyValue?.[field];
    error = new AppError(`Duplicate value for ${field}: "${value}". Please use a different value.`, 409);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    error = new AppError(messages.join('. '), 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token.', 401);
  }
  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired.', 401);
  }

  // Joi validation errors
  if (err.isJoi || err.name === 'ValidationError' && err.details) {
    const messages = err.details.map(d => d.message).join('. ');
    error = new AppError(messages, 400);
  }

  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal server error';

  const response = {
    success: false,
    message,
    data: null,
  };

  // Add validation errors if present
  if (error.isValidationError && error.errors) {
    response.validationErrors = error.errors;
  }

  if (error.issues?.length) response.issues = error.issues;

  // Per-field messages so the client can highlight the offending inputs.
  if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
    response.fieldErrors = error.fieldErrors;
  }

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.error = err;
  }

  res.status(statusCode).json(response);
};

export default errorHandler;
