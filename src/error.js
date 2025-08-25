/**
 * A custom, structured error class for all library-thrown errors.
 * Provides detailed error information and context for better debugging.
 * @class
 * @extends Error
 */
export class VortexError extends Error {
  /**
   * Creates a new VortexError instance.
   * @param {object} params - The error parameters
   * @param {string} params.message - The error message
   * @param {keyof typeof VortexError.TYPES} params.type - The type of error
   * @param {number | null} [params.status=null] - The HTTP status code (if applicable)
   * @param {any} [params.responseBody=null] - The parsed response body from the server
   * @param {object} [params.requestConfig={}] - The configuration of the failed request
   * @param {Error} [params.originalError=null] - The original error that caused this VortexError
   * @param {object} [params.metadata={}] - Additional metadata about the error
   */
  constructor({
    message,
    type,
    status = null,
    responseBody = null,
    requestConfig = {},
    originalError = null,
    metadata = {},
  }) {
    super(message);

    this.name = 'VortexError';
    this.type = type;
    this.status = status;
    this.responseBody = responseBody;
    this.requestConfig = requestConfig;
    this.originalError = originalError;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VortexError);
    }
  }

  /**
   * Enum for error types. Provides type safety and autocompletion.
   * @readonly
   * @enum {string}
   */
  static TYPES = {
    /** HTTP-related errors (4xx, 5xx responses) */
    HTTP: 'HTTP_ERROR',
    /** Network connectivity issues */
    NETWORK: 'NETWORK_ERROR',
    /** Request was aborted/cancelled */
    ABORT: 'ABORT_ERROR',
    /** Configuration or setup errors */
    CONFIG: 'CONFIG_ERROR',
    /** Request timeout errors */
    TIMEOUT: 'TIMEOUT_ERROR',
    /** Response parsing errors */
    PARSE: 'PARSE_ERROR',
    /** Cache-related errors */
    CACHE: 'CACHE_ERROR',
    /** Validation errors */
    VALIDATION: 'VALIDATION_ERROR',
  };

  /**
   * Returns a plain object representation of the error for serialization.
   * @returns {object} The error as a plain object
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      status: this.status,
      responseBody: this.responseBody,
      timestamp: this.timestamp,
      metadata: this.metadata,
      stack: this.stack,
    };
  }

  /**
   * Creates a VortexError from a generic Error.
   * @param {Error} error - The original error
   * @param {keyof typeof VortexError.TYPES} [type=VortexError.TYPES.NETWORK] - The error type
   * @param {object} [requestConfig={}] - The request configuration
   * @returns {VortexError} A new VortexError instance
   */
  static fromError(error, type = VortexError.TYPES.NETWORK, requestConfig = {}) {
    if (error instanceof VortexError) {
      return error;
    }

    // Handle AbortError specifically
    if (error.name === 'AbortError') {
      return new VortexError({
        message: error.message || 'Request was cancelled',
        type: VortexError.TYPES.ABORT,
        originalError: error,
        requestConfig,
      });
    }

    // Handle TimeoutError
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return new VortexError({
        message: error.message || 'Request timed out',
        type: VortexError.TYPES.TIMEOUT,
        originalError: error,
        requestConfig,
      });
    }

    return new VortexError({
      message: error.message || 'An unknown error occurred',
      type,
      originalError: error,
      requestConfig,
    });
  }

  /**
   * Creates an HTTP error from a fetch Response.
   * @param {Response} response - The fetch Response object
   * @param {any} responseBody - The parsed response body
   * @param {object} requestConfig - The request configuration
   * @returns {VortexError} A new VortexError instance
   */
  static fromResponse(response, responseBody, requestConfig) {
    const statusText = response.statusText || 'Unknown Error';
    const message = `HTTP ${response.status}: ${statusText}`;

    return new VortexError({
      message,
      type: VortexError.TYPES.HTTP,
      status: response.status,
      responseBody,
      requestConfig,
      metadata: {
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
      },
    });
  }

  /**
   * Checks if the error is of a specific type.
   * @param {keyof typeof VortexError.TYPES} type - The error type to check
   * @returns {boolean} True if the error is of the specified type
   */
  isType(type) {
    return this.type === type;
  }

  /**
   * Checks if the error is an HTTP error with a specific status code.
   * @param {number} status - The status code to check
   * @returns {boolean} True if the error is an HTTP error with the specified status
   */
  hasStatus(status) {
    return this.type === VortexError.TYPES.HTTP && this.status === status;
  }

  /**
   * Checks if the error is a client error (4xx status code).
   * @returns {boolean} True if the error is a client error
   */
  isClientError() {
    return this.type === VortexError.TYPES.HTTP && this.status >= 400 && this.status < 500;
  }

  /**
   * Checks if the error is a server error (5xx status code).
   * @returns {boolean} True if the error is a server error
   */
  isServerError() {
    return this.type === VortexError.TYPES.HTTP && this.status >= 500 && this.status < 600;
  }
}
