import { VortexError } from './error.js';

/**
 * @typedef {Object} ProgressEvent
 * @property {number} loaded - Bytes loaded
 * @property {number} total - Total bytes
 * @property {boolean} lengthComputable - Whether total is known
 * @property {number} progress - Progress as decimal (0-1)
 * @property {string} type - Event type
 */

/**
 * @typedef {Object} RequestSettings
 * @property {number} [timeout] - Request timeout in milliseconds
 * @property {number} [maxRetries=10] - Maximum number of retries allowed in interceptors
 * @property {'follow' | 'manual' | 'error'} [redirect='follow'] - How to handle HTTP redirects
 * @property {Record<string, string>} [headers] - HTTP headers to include
 * @property {import('./vortex.js').CacheConfig} [cache] - Cache configuration
 * @property {(config: Object) => Object | Promise<Object>} [requestInterceptor] - Function to modify request before sending
 * @property {(response: any, config: Object) => any} [responseInterceptor] - Function to modify response after receiving
 * @property {(error: VortexError, config: Object, retry: Function) => any} [errorInterceptor] - Function to handle errors with retry capability
 * @property {'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData'} [responseType='json'] - Expected response type
 * @property {(status: number) => boolean} [validateStatus] - Function to determine if status code is valid
 * @property {Function | Function[]} [responseMapper] - Function(s) to transform successful response data
 * @property {Function | Function[]} [errorMapper] - Function(s) to transform error data
 * @property {boolean} [inheritMappers=true] - Whether to inherit mappers from parent levels
 * @property {boolean} [disableMappers=false] - Whether to completely disable all mappers
 * @property {() => void} [onStart] - Callback executed at request start
 * @property {(response: any) => void} [onSuccess] - Callback executed on successful response
 * @property {(revalidatedData: any) => void} [onRevalidate] - Callback for stale-while-revalidate fresh data
 * @property {(progress: ProgressEvent) => void} [onDownloadProgress] - Callback for download progress updates
 * @property {(progress: ProgressEvent) => void} [onUploadProgress] - Callback for upload progress updates
 * @property {(error: VortexError) => void} [onError] - Callback executed on error
 * @property {() => void} [onFinally] - Callback executed regardless of outcome
 */

/**
 * @typedef {Object} RequestConfig
 * @property {string} baseURL - The base URL for the request
 * @property {string} path - The endpoint path
 * @property {string} httpMethod - The HTTP method
 * @property {Record<string, string | number>} pathParams - Path parameters to substitute
 * @property {Record<string, string | number | boolean>} searchParams - Query parameters
 * @property {any} body - Request body data
 * @property {AbortSignal} signal - Abort signal for cancellation
 * @property {number} maxRetries - Maximum retries allowed
 * @property {'follow' | 'manual' | 'error'} redirect - Redirect behavior
 */

/**
 * Builder class for constructing and executing HTTP requests.
 * Provides a fluent interface for building requests with various configurations.
 *
 * @class
 * @example
 * // Basic GET request
 * const users = await client.get('users').send();
 *
 * @example
 * // Complex request with all options
 * const result = await client.post('users')
 * .pathParams({ id: 123 })
 * .search({ filter: 'active' })
 * .body({ name: 'John', email: 'john@example.com' })
 * .settings({
 * timeout: 5000,
 * headers: { 'X-Custom': 'value' },
 * responseMapper: (data) => data.users
 * })
 * .send();
 */
export class RequestBuilder {
  /** @private @type {Map<string, Promise>} */
  static inflightRequests = new Map();

  /** @private @type {number} */
  static maxInflightAge = 5 * 60 * 1000; // 5 minutes

  /** @private @type {NodeJS.Timeout | null} */
  static cleanupInterval = null;

  /**
   * Initializes the cleanup interval for inflight requests.
   * @private
   * @static
   */
  static _initCleanup() {
    if (!RequestBuilder.cleanupInterval) {
      RequestBuilder.cleanupInterval = setInterval(() => {
        RequestBuilder._cleanupInflightRequests();
      }, 60000); // Run every minute

      // Allow process to exit even with this interval running
      if (RequestBuilder.cleanupInterval.unref) {
        RequestBuilder.cleanupInterval.unref();
      }
    }
  }

  /**
   * Cleans up old inflight requests to prevent memory leaks.
   * @private
   * @static
   */
  static _cleanupInflightRequests() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, promise] of RequestBuilder.inflightRequests) {
      // @ts-ignore - _timestamp is added dynamically
      if (promise && promise._timestamp && now - promise._timestamp > RequestBuilder.maxInflightAge) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      RequestBuilder.inflightRequests.delete(key);
    }

    // Stop cleanup if map is empty
    if (RequestBuilder.inflightRequests.size === 0 && RequestBuilder.cleanupInterval) {
      clearInterval(RequestBuilder.cleanupInterval);
      RequestBuilder.cleanupInterval = null;
    }
  }

  /**
   * Stores an inflight request with metadata for automatic cleanup.
   * @private
   * @static
   * @param {string} key - The cache key
   * @param {Promise} promise - The promise to store
   * @returns {Promise} The stored promise
   */
  static _storeInflightRequest(key, promise) {
    // @ts-ignore - Adding timestamp for cleanup
    promise._timestamp = Date.now();
    RequestBuilder.inflightRequests.set(key, promise);

    // Ensure cleanup is running
    RequestBuilder._initCleanup();

    // Clean up when promise resolves
    promise
      .finally(() => {
        if (RequestBuilder.inflightRequests.get(key) === promise) {
          RequestBuilder.inflightRequests.delete(key);
        }
      })
      .catch(() => {}); // Ignore errors for cleanup

    return promise;
  }

  /**
   * Cleans up all static resources.
   * @static
   */
  static destroy() {
    if (RequestBuilder.cleanupInterval) {
      clearInterval(RequestBuilder.cleanupInterval);
      RequestBuilder.cleanupInterval = null;
    }
    RequestBuilder.inflightRequests.clear();
  }

  /**
   * Creates a new RequestBuilder instance.
   * @param {Object} params - Constructor parameters
   * @param {string} params.httpMethod - The HTTP method (GET, POST, etc.)
   * @param {Object} params.endpointConfig - The endpoint configuration from client config
   * @param {import('./vortex.js').Vortex} params.clientInstance - The parent Vortex client instance
   */
  constructor({ httpMethod, endpointConfig, clientInstance }) {
    /** @private @type {string} */
    this.httpMethod = httpMethod.toUpperCase();

    /** @private @type {Object} */
    this.endpointConfig = endpointConfig || {};

    /** @private @type {Object} */
    this.methodConfig = endpointConfig?.methods?.[httpMethod.toLowerCase()] || {};

    /** @private @type {Object} */
    this.clientConfig = clientInstance.config || {};

    /** @private @type {import('./vortex.js').Vortex} */
    this.clientInstance = clientInstance;

    /** @private @type {RequestConfig} */
    this.requestConfig = {
      pathParams: {},
      searchParams: {},
      body: null,
      settings: {}, // Always initialize as empty object
    };

    /** @private @type {AbortController} */
    this.abortController = new AbortController();

    // Initialize cleanup on first RequestBuilder creation
    RequestBuilder._initCleanup();
  }

  /**
   * Sets path parameters for URL substitution.
   *
   * @param {Record<string, string | number>} params - Key-value pairs for path substitution
   * @returns {RequestBuilder} This RequestBuilder instance for method chaining
   *
   * @example
   * // Replace :id in /users/:id with 123
   * client.get('user').pathParams({ id: 123 }).send();
   * // Results in: /users/123
   *
   * @example
   * // Multiple path parameters
   * client.get('userPost').pathParams({ userId: 1, postId: 5 }).send();
   * // /users/:userId/posts/:postId becomes /users/1/posts/5
   */
  pathParams(params) {
    if (params !== null && params !== undefined) {
      if (typeof params !== 'object' || Array.isArray(params)) {
        throw new VortexError({
          message: 'pathParams must be an object',
          type: VortexError.TYPES.VALIDATION,
          metadata: { providedValue: params, expectedType: 'object' },
        });
      }
      this.requestConfig.pathParams = { ...this.requestConfig.pathParams, ...params };
    }
    return this;
  }

  /**
   * Sets URL search parameters (query string).
   *
   * @param {Record<string, string | number | boolean>} params - Key-value pairs for query parameters
   * @returns {RequestBuilder} This RequestBuilder instance for method chaining
   *
   * @example
   * // Add query parameters
   * client.get('users').search({ page: 1, limit: 10 }).send();
   * // Results in: /users?page=1&limit=10
   *
   * @example
   * // Boolean and number parameters are converted to strings
   * client.get('users').search({ active: true, minAge: 18 }).send();
   * // Results in: /users?active=true&minAge=18
   */
  search(params) {
    if (params !== null && params !== undefined) {
      if (typeof params !== 'object' || Array.isArray(params)) {
        throw new VortexError({
          message: 'search params must be an object',
          type: VortexError.TYPES.VALIDATION,
          metadata: { providedValue: params, expectedType: 'object' },
        });
      }
      this.requestConfig.searchParams = { ...this.requestConfig.searchParams, ...params };
    }
    return this;
  }

  /**
   * Sets the request body data.
   *
   * @param {any} data - The request body data
   * @returns {RequestBuilder} This RequestBuilder instance for method chaining
   *
   * @example
   * // JSON body (automatically stringified)
   * client.post('users').body({ name: 'John', email: 'john@example.com' }).send();
   *
   * @example
   * // FormData for file uploads
   * const formData = new FormData();
   * formData.append('file', fileBlob);
   * client.post('upload').body(formData).send();
   *
   * @example
   * // URLSearchParams for form-encoded data
   * const params = new URLSearchParams();
   * params.append('username', 'john');
   * client.post('login').body(params).send();
   */
  body(data) {
    this.requestConfig.body = data;
    return this;
  }

  /**
   * Sets additional request settings.
   *
   * @param {RequestSettings} settings - Request configuration settings
   * @returns {RequestBuilder} This RequestBuilder instance for method chaining
   *
   * @example
   * // Set custom timeout and headers
   * client.get('users').settings({
   * timeout: 5000,
   * headers: { 'X-API-Key': 'secret' }
   * }).send();
   *
   * @example
   * // Configure response transformation
   * client.get('users').settings({
   * responseMapper: (data) => data.users,
   * inheritMappers: false // Don't inherit parent mappers
   * }).send();
   *
   * @example
   * // Add callbacks
   * client.get('users').settings({
   * onStart: () => console.log('Request started'),
   * onSuccess: (data) => console.log('Got data:', data),
   * onError: (error) => console.error('Failed:', error),
   * onFinally: () => console.log('Request completed')
   * }).send();
   */
  settings(settings) {
    if (settings !== null && settings !== undefined) {
      if (typeof settings !== 'object' || Array.isArray(settings)) {
        throw new VortexError({
          message: 'settings must be an object',
          type: VortexError.TYPES.VALIDATION,
          metadata: { providedValue: settings, expectedType: 'object' },
        });
      }
      this.requestConfig.settings = { ...this.requestConfig.settings, ...settings };
    }
    return this;
  }

  /**
   * Cancels the request with an optional message.
   *
   * @param {string} [message='Request was cancelled by the user.'] - Cancellation message
   * @returns {void}
   *
   * @example
   * // Cancel a long-running request
   * const request = client.get('large-dataset');
   * const promise = request.send();
   *
   * // Cancel after 5 seconds
   * setTimeout(() => request.cancel('Taking too long'), 5000);
   *
   * try {
   * await promise;
   * } catch (error) {
   * if (error.type === VortexError.TYPES.ABORT) {
   * console.log('Request was cancelled');
   * }
   * }
   */
  cancel(message = 'Request was cancelled by the user.') {
    if (this.abortController) {
      const error = new VortexError({
        message,
        type: VortexError.TYPES.ABORT,
        requestConfig: this._buildFinalConfig(),
      });
      this.abortController.abort(error);
    }
  }

  /**
   * Executes the request and returns the response.
   *
   * @returns {Promise<any>} The response data
   * @throws {VortexError} When the request fails
   *
   * @example
   * // Simple request
   * const users = await client.get('users').send();
   *
   * @example
   * // With error handling
   * try {
   * const user = await client.get('user')
   * .pathParams({ id: 123 })
   * .send();
   * } catch (error) {
   * if (error.status === 404) {
   * console.log('User not found');
   * } else if (error.type === VortexError.TYPES.NETWORK) {
   * console.log('Connection failed');
   * }
   * }
   */
  async send() {
    let mergedConfig;

    try {
      mergedConfig = this._buildFinalConfig();

      // Execute onStart callback
      const onStart = mergedConfig.onStart;
      if (typeof onStart === 'function') {
        try {
          onStart();
        } catch (error) {
          console.warn('onStart callback failed:', error);
        }
      }

      // Handle stale-while-revalidate caching
      if (mergedConfig.cache?.enabled && mergedConfig.cache.strategy === 'swr') {
        return await this._handleStaleWhileRevalidate(mergedConfig);
      }

      // Execute normal request
      return await this._executeRequestAndHandleCallbacks(mergedConfig);
    } catch (error) {
      this._cleanup();
      throw error;
    }
  }

  /**
   * Cleans up the request builder resources.
   * @private
   */
  _cleanup() {
    if (this.abortController) {
      this.abortController = null;
    }
    this.requestConfig = null;
    this.endpointConfig = null;
    this.methodConfig = null;
    this.clientConfig = null;
    this.clientInstance = null;
  }

  /**
   * Builds the final merged configuration from all sources.
   * @private
   * @returns {Object} The merged configuration
   */
  _buildFinalConfig() {
    // Ensure all config objects exist with safe defaults
    const safeClientConfig = this.clientConfig || {};
    const safeEndpointConfig = this.endpointConfig || {};
    const safeMethodConfig = this.methodConfig || {};
    const safeRequestSettings = this.requestConfig?.settings || {};

    // Deep merge configurations with proper precedence:
    // client config < endpoint config < method config < request settings
    const mergedConfig = {
      // Default values
      timeout: 30000,
      responseType: 'json',
      validateStatus: (status) => status >= 200 && status < 300,
      maxRetries: 10,
      redirect: 'follow',
      cache: {
        enabled: false,
        strategy: 'simple',
        ttl: 60000,
      },
      headers: {},

      // Merge in order of precedence
      ...safeClientConfig,
      ...safeEndpointConfig,
      ...safeMethodConfig,
      ...safeRequestSettings,

      // Special handling for nested objects
      cache: {
        enabled: false,
        strategy: 'simple',
        ttl: 60000,
        instance: safeClientConfig.cache?.instance,
        ...(safeClientConfig.cache || {}),
        ...(safeEndpointConfig.cache || {}),
        ...(safeMethodConfig.cache || {}),
        ...(safeRequestSettings.cache || {}),
      },
      headers: {
        ...(safeClientConfig.headers || {}),
        ...(safeEndpointConfig.headers || {}),
        ...(safeMethodConfig.headers || {}),
        ...(safeRequestSettings.headers || {}),
      },

      // Request-specific data
      httpMethod: this.httpMethod,
      pathParams: this.requestConfig?.pathParams || {},
      searchParams: this.requestConfig?.searchParams || {},
      body: this.requestConfig?.body ?? null,
      signal: this.abortController?.signal,

      // Cascade redirect and maxRetries properly
      redirect:
        safeRequestSettings.redirect ||
        safeMethodConfig.redirect ||
        safeEndpointConfig.redirect ||
        safeClientConfig.redirect ||
        'follow',

      maxRetries:
        safeRequestSettings.maxRetries ||
        safeMethodConfig.maxRetries ||
        safeEndpointConfig.maxRetries ||
        safeClientConfig.maxRetries ||
        10,
    };

    // Special handling for manual redirects - adjust validateStatus
    if (mergedConfig.redirect === 'manual') {
      const originalValidateStatus = mergedConfig.validateStatus;
      mergedConfig.validateStatus = (status) => {
        // 3xx are "successful" when redirect is manual
        if (status >= 300 && status < 400) {
          return true;
        }
        // Otherwise use original validation
        return originalValidateStatus(status);
      };
    }

    return mergedConfig;
  }

  /**
   * Creates a retry function that can be used in interceptors.
   * @private
   * @param {Object} originalConfig - The original request configuration
   * @returns {Function} A retry function that interceptors can call
   */
  _createRetryFunction(originalConfig) {
    return async (overrides = {}) => {
      // Get max retry limit from config
      const maxRetries = originalConfig.maxRetries || 10;
      const retryCount = originalConfig._retryCount || 0;

      if (retryCount >= maxRetries) {
        // Return undefined to signal retry limit reached
        return undefined;
      }

      // Merge configurations for retry
      const retryConfig = {
        ...originalConfig,
        ...overrides,
        headers: {
          ...originalConfig.headers,
          ...overrides.headers,
        },
        pathParams: {
          ...originalConfig.pathParams,
          ...overrides.pathParams,
        },
        searchParams: {
          ...originalConfig.searchParams,
          ...overrides.searchParams,
        },
        _retryCount: retryCount + 1,
        _isRetry: true,
      };

      // Execute the request again with merged config
      return this._executeRequestAndHandleCallbacks(retryConfig);
    };
  }

  /**
   * Executes the request and handles callbacks.
   * @private
   * @param {Object} mergedConfig - The merged request configuration
   * @returns {Promise<any>} The response data
   */
  async _executeRequestAndHandleCallbacks(mergedConfig) {
    try {
      // Execute request
      let responseData = await this._executeFetch(mergedConfig);

      // Apply response mappers (after interceptors)
      responseData = this._applyResponseMappers(responseData, mergedConfig);

      // Execute onSuccess callback
      if (typeof mergedConfig.onSuccess === 'function') {
        try {
          mergedConfig.onSuccess(responseData);
        } catch (error) {
          console.warn('onSuccess callback failed:', error);
        }
      }

      return responseData;
    } catch (error) {
      // ALWAYS ensure it's a VortexError
      let finalError =
        error instanceof VortexError ? error : VortexError.fromError(error, VortexError.TYPES.NETWORK, mergedConfig);

      // Create retry function for error interceptor
      const retry = this._createRetryFunction(mergedConfig);

      // Apply error interceptor with retry function
      if (typeof mergedConfig.errorInterceptor === 'function') {
        try {
          const interceptResult = await mergedConfig.errorInterceptor(finalError, mergedConfig, retry);
          if (interceptResult !== undefined) {
            return interceptResult;
          }
          // If interceptor returns undefined, continue to throw the error
        } catch (interceptedError) {
          // Wrap interceptor errors
          finalError =
            interceptedError instanceof VortexError
              ? interceptedError
              : new VortexError({
                  message: `Error interceptor failed: ${interceptedError.message}`,
                  type: VortexError.TYPES.CONFIG,
                  originalError: interceptedError,
                  requestConfig: mergedConfig,
                });
        }
      }

      // Apply error mappers
      finalError = this._applyErrorMappers(finalError, mergedConfig);

      // Execute onError callback
      if (typeof mergedConfig.onError === 'function') {
        try {
          mergedConfig.onError(finalError);
        } catch (error) {
          console.warn('onError callback failed:', error);
        }
      }

      // CRITICAL FIX: Always throw the error at the end
      throw finalError;
    } finally {
      if (typeof mergedConfig.onFinally === 'function') {
        try {
          mergedConfig.onFinally();
        } catch (error) {
          console.warn('onFinally callback failed:', error);
        }
      }
      this._cleanup();
    }
  }

  /**
   * Applies response mappers with clean chaining logic.
   * @private
   * @param {any} data - The response data to transform
   * @param {Object} config - The merged configuration
   * @returns {any} The transformed data
   */
  _applyResponseMappers(data, config) {
    // Check if mappers are completely disabled
    if (this._areMappersDisabled('response')) {
      return data;
    }

    // Collect mappers from all levels
    const mappers = this._collectMappers('responseMapper');

    // Apply each mapper in sequence
    let currentData = data;
    for (const { mapper, level } of mappers) {
      try {
        const result = mapper(currentData);
        currentData = result !== undefined ? result : currentData;
      } catch (error) {
        console.warn(`Response mapper at ${level} level failed:`, error);
      }
    }

    return currentData;
  }

  /**
   * Applies error mappers with the same chaining logic.
   * @private
   * @param {VortexError} error - The error to transform
   * @param {Object} config - The merged configuration
   * @returns {VortexError} The transformed error
   */
  _applyErrorMappers(error, config) {
    if (this._areMappersDisabled('error')) {
      return error;
    }

    const mappers = this._collectMappers('errorMapper');

    let currentError = error;
    for (const { mapper, level } of mappers) {
      try {
        const result = mapper(currentError);
        currentError = result !== undefined ? result : currentError;
      } catch (err) {
        console.warn(`Error mapper at ${level} level failed:`, err);
      }
    }

    return currentError;
  }

  /**
   * Collects mappers from all levels respecting inheritance settings.
   * @private
   * @param {string} mapperType - 'responseMapper' or 'errorMapper'
   * @returns {Array<{mapper: Function, level: string}>} Array of mappers to apply
   */
  _collectMappers(mapperType) {
    const mappers = [];

    // Levels from top to bottom (client → endpoint → method → request)
    const levels = [
      { config: this.clientConfig, name: 'client' },
      { config: this.endpointConfig, name: 'endpoint' },
      { config: this.methodConfig, name: 'method' },
      { config: this.requestConfig?.settings, name: 'request' },
    ];

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      if (!level.config) continue;

      // Check if this level disables inheritance
      if (level.config.inheritMappers === false && mappers.length > 0) {
        mappers.length = 0; // Clear all previously collected mappers
      }

      // Add mappers from this level
      if (level.config[mapperType]) {
        const levelMappers = Array.isArray(level.config[mapperType])
          ? level.config[mapperType]
          : [level.config[mapperType]];

        for (const mapper of levelMappers) {
          if (typeof mapper === 'function') {
            mappers.push({ mapper, level: level.name });
          }
        }
      }
    }

    return mappers;
  }

  /**
   * Checks if mappers are disabled at any level.
   * @private
   * @param {string} type - 'response' or 'error'
   * @returns {boolean} True if mappers should be disabled
   */
  _areMappersDisabled(type) {
    const levels = [this.requestConfig?.settings, this.methodConfig, this.endpointConfig, this.clientConfig];

    for (const level of levels) {
      if (!level) continue;

      if (level.disableMappers === true) {
        return true;
      }

      if (type === 'response' && level.disableResponseMapper === true) {
        return true;
      }

      if (type === 'error' && level.disableErrorMapper === true) {
        return true;
      }
    }

    return false;
  }

  /**
   * Executes the actual request with environment-aware progress tracking.
   * @private
   * @param {Object} config - The request configuration
   * @returns {Promise<any>} The response data
   */
  async _executeFetch(config) {
    try {
      // Apply request interceptor
      let finalConfig = config;
      if (typeof config.requestInterceptor === 'function') {
        try {
          const interceptorConfig = {
            url: config.baseURL + config.path,
            method: config.httpMethod,
            headers: { ...config.headers },
            body: config.body,
            timeout: config.timeout,
            responseType: config.responseType,
            pathParams: { ...config.pathParams },
            searchParams: { ...config.searchParams },
            _original: config,
          };

          const modifiedConfig = await config.requestInterceptor(interceptorConfig);

          if (!modifiedConfig) {
            throw new VortexError({
              message: 'Request interceptor must return a config object',
              type: VortexError.TYPES.CONFIG,
              requestConfig: config,
            });
          }

          finalConfig = {
            ...config,
            headers: modifiedConfig.headers || config.headers,
            body: 'body' in modifiedConfig ? modifiedConfig.body : config.body,
            timeout: modifiedConfig.timeout || config.timeout,
            pathParams: modifiedConfig.pathParams || config.pathParams,
            searchParams: modifiedConfig.searchParams || config.searchParams,
          };
        } catch (error) {
          if (error instanceof VortexError) throw error;
          throw new VortexError({
            message: `Request interceptor failed: ${error.message}`,
            type: VortexError.TYPES.CONFIG,
            originalError: error,
            requestConfig: config,
          });
        }
      }

      // Check cache first
      const cacheKey = this._generateCacheKey(finalConfig);
      if (finalConfig.cache?.enabled && finalConfig.cache.strategy === 'simple') {
        try {
          const cached = await finalConfig.cache.instance.get(cacheKey);
          if (cached !== null) {
            return cached;
          }
        } catch (error) {
          console.warn('Cache retrieval failed:', error);
        }
      }

      // Decide whether to use XHR or fetch based on environment and progress needs
      const needsProgressTracking = finalConfig.onUploadProgress || finalConfig.onDownloadProgress;
      const hasXHR = typeof XMLHttpRequest !== 'undefined';

      let response;
      let responseData;

      if (needsProgressTracking && hasXHR) {
        // Use XMLHttpRequest for real progress tracking (browser)
        responseData = await this._executeXHRWithProgress(finalConfig);
      } else {
        // Use fetch for Node.js or when no progress tracking needed
        if (needsProgressTracking && !hasXHR) {
          // Show info about progress limitations in Node.js
          console.info('Progress tracking has limited support in Node.js environment. Using fetch fallback.');
        }

        response = await this._executeFetchRequest(finalConfig);

        // Apply response interceptor
        if (typeof finalConfig.responseInterceptor === 'function') {
          try {
            response = await finalConfig.responseInterceptor(response, finalConfig);
          } catch (error) {
            if (error instanceof VortexError) throw error;
            throw new VortexError({
              message: `Response interceptor failed: ${error.message}`,
              type: VortexError.TYPES.CONFIG,
              originalError: error,
              requestConfig: finalConfig,
            });
          }
        }

        // Validate response status
        const isValidStatus =
          typeof finalConfig.validateStatus === 'function'
            ? finalConfig.validateStatus(response.status)
            : response.status >= 200 && response.status < 300;

        if (!isValidStatus) {
          const errorBody = await this._parseResponseBody(response, 'json').catch(() => null);
          throw VortexError.fromResponse(response, errorBody, finalConfig);
        }

        // Handle 204 No Content
        if (response.status === 204) {
          responseData = null;
        } else {
          responseData = await this._parseResponseBody(response, finalConfig.responseType || 'json');
        }
      }

      // Store in cache if enabled
      if (finalConfig.cache?.enabled && responseData !== null) {
        try {
          await finalConfig.cache.instance.set(cacheKey, responseData, finalConfig.cache.ttl);
        } catch (error) {
          console.warn('Cache storage failed:', error);
        }
      }

      return responseData;
    } catch (error) {
      if (error instanceof VortexError) {
        throw error;
      }
      throw new VortexError({
        message: error.message || 'Request failed',
        type: VortexError.TYPES.NETWORK,
        status: null,
        originalError: error,
        requestConfig: config,
      });
    }
  }

  /**
   * Executes request using XMLHttpRequest with real progress tracking.
   * @private
   * @param {Object} config - The request configuration
   * @returns {Promise<any>} The response data
   */
  async _executeXHRWithProgress(config) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = this._buildRequestUrl(config);

      // Open the request
      xhr.open(config.httpMethod, url.toString(), true);

      // Set headers
      const headers = new Headers(config.headers || {});

      // Prepare body and auto-detect Content-Type
      let finalBody = config.body;
      if (finalBody && !headers.has('content-type')) {
        this._setAutoContentType(headers, finalBody);
      }

      // Serialize body if needed (but not FormData)
      if (finalBody && !(finalBody instanceof FormData) && typeof finalBody === 'object') {
        try {
          finalBody = JSON.stringify(finalBody);
        } catch (error) {
          reject(
            new VortexError({
              message: 'Failed to serialize request body to JSON',
              type: VortexError.TYPES.VALIDATION,
              originalError: error,
              requestConfig: config,
            })
          );
          return;
        }
      }

      // Set headers on XHR
      for (const [key, value] of headers.entries()) {
        try {
          xhr.setRequestHeader(key, value);
        } catch (error) {
          console.warn(`Failed to set header ${key}:`, error);
        }
      }

      // Configure response type for XHR
      const xhrResponseType = this._getXHRResponseType(config.responseType || 'json');
      if (xhrResponseType !== 'text') {
        try {
          xhr.responseType = xhrResponseType;
        } catch (error) {
          console.warn('Failed to set responseType:', error);
        }
      }

      // Configure timeout
      if (config.timeout > 0) {
        xhr.timeout = config.timeout;
      }

      // Handle upload progress
      if (config.onUploadProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            try {
              config.onUploadProgress({
                loaded: event.loaded,
                total: event.total,
                lengthComputable: true,
                progress: event.loaded / event.total,
                type: 'progress',
              });
            } catch (error) {
              console.warn('onUploadProgress callback failed:', error);
            }
          }
        });

        xhr.upload.addEventListener('loadstart', () => {
          try {
            config.onUploadProgress({
              loaded: 0,
              total: 0,
              lengthComputable: false,
              progress: 0,
              type: 'loadstart',
            });
          } catch (error) {
            console.warn('onUploadProgress callback failed:', error);
          }
        });

        xhr.upload.addEventListener('loadend', () => {
          try {
            config.onUploadProgress({
              loaded: 0,
              total: 0,
              lengthComputable: false,
              progress: 1,
              type: 'loadend',
            });
          } catch (error) {
            console.warn('onUploadProgress callback failed:', error);
          }
        });
      }

      // Handle download progress
      if (config.onDownloadProgress) {
        xhr.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            try {
              config.onDownloadProgress({
                loaded: event.loaded,
                total: event.total,
                lengthComputable: true,
                progress: event.loaded / event.total,
                type: 'progress',
              });
            } catch (error) {
              console.warn('onDownloadProgress callback failed:', error);
            }
          }
        });
      }

      // Handle timeout
      xhr.addEventListener('timeout', () => {
        reject(
          new VortexError({
            message: `Request timeout after ${config.timeout}ms`,
            type: VortexError.TYPES.TIMEOUT,
            requestConfig: config,
          })
        );
      });

      // Handle abort/cancellation
      xhr.addEventListener('abort', () => {
        const abortReason = config.signal?.reason;
        if (abortReason instanceof VortexError) {
          reject(abortReason);
        } else {
          reject(
            new VortexError({
              message: 'Request was cancelled',
              type: VortexError.TYPES.ABORT,
              requestConfig: config,
            })
          );
        }
      });

      // Handle network errors
      xhr.addEventListener('error', () => {
        reject(
          new VortexError({
            message: 'Network request failed',
            type: VortexError.TYPES.NETWORK,
            requestConfig: config,
          })
        );
      });

      // Handle successful response
      xhr.addEventListener('loadend', async () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
          return;
        }

        if (xhr.status === 0) {
          // This was an error or abort, already handled above
          return;
        }

        try {
          // Create a Response-like object for interceptors
          const mockResponse = {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: this._parseXHRHeaders(xhr.getAllResponseHeaders()),
            url: url.toString(),
          };

          // Apply response interceptor
          if (typeof config.responseInterceptor === 'function') {
            try {
              await config.responseInterceptor(mockResponse, config);
            } catch (error) {
              if (error instanceof VortexError) throw error;
              throw new VortexError({
                message: `Response interceptor failed: ${error.message}`,
                type: VortexError.TYPES.CONFIG,
                originalError: error,
                requestConfig: config,
              });
            }
          }

          // Validate status
          const isValidStatus =
            typeof config.validateStatus === 'function'
              ? config.validateStatus(xhr.status)
              : xhr.status >= 200 && xhr.status < 300;

          if (!isValidStatus) {
            const errorBody = this._parseXHRResponse(xhr, 'json');
            throw new VortexError({
              message: `HTTP ${xhr.status}: ${xhr.statusText}`,
              type: VortexError.TYPES.HTTP,
              status: xhr.status,
              responseBody: errorBody,
              requestConfig: config,
              metadata: {
                url: url.toString(),
                headers: mockResponse.headers,
              },
            });
          }

          // Handle 204 No Content
          if (xhr.status === 204) {
            resolve(null);
            return;
          }

          // Parse response
          const responseData = this._parseXHRResponse(xhr, config.responseType || 'json');
          resolve(responseData);
        } catch (error) {
          reject(
            error instanceof VortexError
              ? error
              : new VortexError({
                  message: `Failed to process XHR response: ${error.message}`,
                  type: VortexError.TYPES.PARSE,
                  originalError: error,
                  requestConfig: config,
                })
          );
        }
      });

      // Set up abort signal handling
      if (config.signal) {
        if (config.signal.aborted) {
          xhr.abort();
          return;
        }
        config.signal.addEventListener('abort', () => xhr.abort());
      }

      // Send the request
      try {
        xhr.send(finalBody ?? null);
      } catch (error) {
        reject(
          new VortexError({
            message: `Failed to send XHR request: ${error.message}`,
            type: VortexError.TYPES.NETWORK,
            originalError: error,
            requestConfig: config,
          })
        );
      }
    });
  }

  /**
   * Executes request using fetch (when no progress tracking needed).
   * @private
   * @param {Object} config - The request configuration
   * @returns {Promise<Response>} The fetch Response
   */
  async _executeFetchRequest(config) {
    const url = this._buildRequestUrl(config);
    const headers = new Headers(config.headers || {});

    // Prepare body
    let finalBody = config.body;
    if (finalBody && !headers.has('content-type')) {
      this._setAutoContentType(headers, finalBody);
    }

    if (finalBody && !(finalBody instanceof FormData) && typeof finalBody === 'object') {
      try {
        finalBody = JSON.stringify(finalBody);
      } catch (error) {
        throw new VortexError({
          message: 'Failed to serialize request body to JSON',
          type: VortexError.TYPES.VALIDATION,
          originalError: error,
          requestConfig: config,
        });
      }
    }

    // Handle timeout and cancellation
    let timeoutSignal = config.signal;
    let timeoutId = null;

    if (config.timeout && config.timeout > 0) {
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        const signals = [config.signal, AbortSignal.timeout(config.timeout)].filter(Boolean);
        timeoutSignal =
          signals.length > 1 ? AbortSignal.any(signals) : signals[0] || AbortSignal.timeout(config.timeout);
      } else {
        const timeoutController = new AbortController();

        if (config.signal) {
          config.signal.addEventListener('abort', () => {
            timeoutController.abort(config.signal.reason);
          });
        }

        timeoutId = setTimeout(() => {
          const timeoutError = new VortexError({
            message: `Request timeout after ${config.timeout}ms`,
            type: VortexError.TYPES.TIMEOUT,
            requestConfig: config,
          });
          timeoutController.abort(timeoutError);
        }, config.timeout);

        timeoutController.signal.addEventListener('abort', () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        });

        timeoutSignal = timeoutController.signal;
      }
    }

    try {
      const response = await fetch(url.toString(), {
        method: config.httpMethod,
        headers,
        body: finalBody ?? null,
        signal: timeoutSignal,
        redirect: config.redirect || 'follow',
      });

      return response;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (error.name === 'AbortError') {
        const abortReason = timeoutSignal?.reason || config.signal?.reason;
        if (abortReason instanceof VortexError) {
          throw abortReason;
        }

        if (error.message && error.message.toLowerCase().includes('timeout')) {
          throw new VortexError({
            message: `Request timeout after ${config.timeout}ms`,
            type: VortexError.TYPES.TIMEOUT,
            originalError: error,
            requestConfig: config,
          });
        }

        throw new VortexError({
          message: 'Request was cancelled',
          type: VortexError.TYPES.ABORT,
          originalError: error,
          requestConfig: config,
        });
      }

      if (error.message && error.message.toLowerCase().includes('timeout')) {
        throw new VortexError({
          message: error.message || `Request timeout after ${config.timeout}ms`,
          type: VortexError.TYPES.TIMEOUT,
          originalError: error,
          requestConfig: config,
        });
      }

      throw new VortexError({
        message: error.message || 'Network request failed',
        type: VortexError.TYPES.NETWORK,
        originalError: error,
        requestConfig: config,
      });
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  }

  /**
   * Converts Vortex response type to XHR response type.
   * @private
   * @param {string} responseType - The Vortex response type
   * @returns {string} The XHR response type
   */
  _getXHRResponseType(responseType) {
    switch (responseType) {
      case 'json':
        return 'text'; // We'll parse JSON manually for better error handling
      case 'text':
        return 'text';
      case 'blob':
        return 'blob';
      case 'arrayBuffer':
        return 'arraybuffer';
      case 'formData':
        return 'text'; // XHR doesn't support formData responseType
      default:
        return 'text';
    }
  }

  /**
   * Parses XHR response headers into an object.
   * @private
   * @param {string} headerString - Raw header string from XHR
   * @returns {Object} Parsed headers object
   */
  _parseXHRHeaders(headerString) {
    const headers = {};
    if (!headerString) return headers;

    const lines = headerString.trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts.shift().trim().toLowerCase();
        const value = parts.join(':').trim();
        headers[key] = value;
      }
    }
    return headers;
  }

  /**
   * Parses XHR response based on the expected type.
   * @private
   * @param {XMLHttpRequest} xhr - The XHR instance
   * @param {string} responseType - Expected response type
   * @returns {any} Parsed response data
   */
  _parseXHRResponse(xhr, responseType) {
    try {
      switch (responseType) {
        case 'json':
          const text = xhr.responseText;
          if (!text.trim()) return null;
          return JSON.parse(text);

        case 'text':
          return xhr.responseText;

        case 'blob':
          return xhr.response || new Blob([xhr.responseText]);

        case 'arrayBuffer':
          return xhr.response || new TextEncoder().encode(xhr.responseText).buffer;

        case 'formData':
          // XHR doesn't natively support FormData response, so return empty FormData
          return new FormData();

        default:
          return xhr.responseText;
      }
    } catch (error) {
      throw new VortexError({
        message: `Failed to parse XHR response as ${responseType}`,
        type: VortexError.TYPES.PARSE,
        originalError: error,
        metadata: {
          responseText: xhr.responseText,
          responseStatus: xhr.status,
        },
      });
    }
  }

  /**
   * Generates a cache key for the request.
   * @private
   * @param {Object} config - The request configuration
   * @returns {string} The cache key
   */
  _generateCacheKey(config) {
    try {
      const url = this._buildRequestUrl(config);

      // Include method and relevant headers in cache key
      const relevantHeaders = ['content-type', 'accept', 'authorization'];
      const headerPairs = relevantHeaders
        .filter((header) => config.headers?.[header] || config.headers?.[header.toLowerCase()])
        .map((header) => {
          const value = config.headers[header] || config.headers[header.toLowerCase()];
          return `${header.toLowerCase()}:${value}`;
        })
        .sort();

      let cacheKey = `${config.httpMethod}::${url.toString()}`;

      if (headerPairs.length > 0) {
        cacheKey += `::headers:${headerPairs.join('|')}`;
      }

      // Include body hash for requests with body
      if (config.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(config.httpMethod)) {
        const bodyString = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
        const bodyHash = this._simpleHash(bodyString);
        cacheKey += `::body:${bodyHash}`;
      }

      return cacheKey;
    } catch (error) {
      // Fallback cache key
      const fallbackParts = [
        config.httpMethod,
        config.baseURL,
        config.path,
        JSON.stringify(config.pathParams || {}),
        JSON.stringify(config.searchParams || {}),
        Date.now(),
      ];
      return fallbackParts.join('::');
    }
  }

  /**
   * Simple hash function for generating consistent hashes.
   * @private
   * @param {string} str - String to hash
   * @returns {string} Hash value
   */
  _simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString();

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * Handles stale-while-revalidate caching strategy.
   * @private
   * @param {Object} config - The request configuration
   * @returns {Promise<any>} The cached data or fresh data
   */
  async _handleStaleWhileRevalidate(config) {
    const cacheKey = this._generateCacheKey(config);

    try {
      // Try to get stale data from cache
      const staleData = await config.cache.instance.get(cacheKey);

      // Check if there's already a revalidation in progress
      const revalidationKey = `revalidate::${cacheKey}`;

      let revalidationPromise = RequestBuilder.inflightRequests.get(revalidationKey);

      if (!revalidationPromise) {
        // Start revalidation request
        revalidationPromise = this._executeRequestAndHandleCallbacks(config)
          .then((freshData) => {
            if (freshData !== undefined && config.onRevalidate) {
              try {
                config.onRevalidate(freshData);
              } catch (error) {
                console.warn('onRevalidate callback failed:', error);
              }
            }
            return freshData;
          })
          .catch((error) => {
            // Silently ignore revalidation errors for SWR
            return null;
          })
          .finally(() => {
            RequestBuilder.inflightRequests.delete(revalidationKey);
          });

        // Store with automatic cleanup
        RequestBuilder._storeInflightRequest(revalidationKey, revalidationPromise);
      }

      // Return stale data if available, otherwise wait for fresh data
      if (staleData !== null) {
        return staleData;
      }

      return await revalidationPromise;
    } catch (error) {
      // If cache fails, fall back to normal request
      return this._executeRequestAndHandleCallbacks(config);
    }
  }

  /**
   * Builds the complete request URL with path and search parameters.
   * Handles both absolute and relative baseURLs.
   * @private
   * @param {Object} config - The request configuration
   * @returns {URL} The complete URL
   */
  _buildRequestUrl(config) {
    try {
      let url;
      const pathIsAbsolute = config.path.startsWith('http://') || config.path.startsWith('https://');
      const origin = (typeof window !== 'undefined' && window?.location?.origin) || 'http://localhost';

      if (pathIsAbsolute) {
        url = new URL(config.path);
      } else if (!config.baseURL || config.baseURL === '') {
        // Empty baseURL means same origin
        url = new URL(config.path, origin);
      } else if (config.baseURL.startsWith('/')) {
        // Relative path like '/api'
        const fullPath = config.baseURL + (config.path.startsWith('/') ? config.path : '/' + config.path);
        url = new URL(fullPath, origin);
      } else if (config.baseURL.startsWith('http://') || config.baseURL.startsWith('https://')) {
        // Full URL
        url = new URL(config.path, config.baseURL);
      } else {
        // Try to parse as full URL, fallback to treating as relative
        try {
          url = new URL(config.path, config.baseURL);
        } catch {
          // Treat as relative path
          const basePath = config.baseURL.startsWith('/') ? config.baseURL : '/' + config.baseURL;
          const fullPath = basePath + (config.path.startsWith('/') ? config.path : '/' + config.path);
          url = new URL(fullPath, origin);
        }
      }

      const originalPathname = url.pathname;

      // Replace path parameters
      Object.entries(config.pathParams || {}).forEach(([key, value]) => {
        const placeholder = `:${key}`;
        if (url.pathname.includes(placeholder)) {
          url.pathname = url.pathname.replace(new RegExp(placeholder, 'g'), encodeURIComponent(String(value)));
        } else {
          console.warn(
            `Path parameter '${key}' not found in path '${originalPathname}'. Available parameters: ${
              this._extractPathParams(originalPathname).join(', ') || 'none'
            }`
          );
        }
      });

      // Check for missing path parameters
      const remainingParams = this._extractPathParams(url.pathname);
      if (remainingParams.length > 0) {
        throw new VortexError({
          message: `Missing required path parameters: ${remainingParams.join(', ')}`,
          type: VortexError.TYPES.VALIDATION,
          requestConfig: config,
          metadata: {
            missingParams: remainingParams,
            providedParams: Object.keys(config.pathParams || {}),
            path: originalPathname,
          },
        });
      }

      // Add search parameters
      Object.entries(config.searchParams || {}).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });

      return url;
    } catch (error) {
      if (error instanceof VortexError) {
        throw error;
      }
      throw new VortexError({
        message: `Invalid URL configuration: ${config.baseURL}${config.path}`,
        type: VortexError.TYPES.CONFIG,
        originalError: error,
        requestConfig: config,
      });
    }
  }

  /**
   * Extracts path parameters from a URL path.
   * @private
   * @param {string} path - The URL path
   * @returns {string[]} Array of parameter names
   */
  _extractPathParams(path) {
    const matches = path.match(/:([^\/\?]+)/g);
    return matches ? matches.map((match) => match.substring(1)) : [];
  }

  /**
   * Automatically sets the Content-Type header based on the request body type.
   * @private
   * @param {Headers} headers - The headers object to modify
   * @param {any} body - The request body
   */
  _setAutoContentType(headers, body) {
    const hasContentType = Array.from(headers.keys()).some((key) => key.toLowerCase() === 'content-type');

    if (hasContentType) {
      return;
    }

    // FormData: Let the browser set multipart/form-data with boundary
    if (body instanceof FormData) {
      return;
    }

    // URLSearchParams: Form URL encoded
    if (body instanceof URLSearchParams) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
      return;
    }

    // Blob: Use the blob's type if available
    if (body instanceof Blob) {
      headers.set('Content-Type', body.type || 'application/octet-stream');
      return;
    }

    if (body instanceof ArrayBuffer || (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(body))) {
      headers.set('Content-Type', 'application/octet-stream');
      return;
    }

    // String: Check if it looks like XML, otherwise plain text
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed.startsWith('<') && (trimmed.includes('<?xml') || trimmed.includes('<!DOCTYPE'))) {
        headers.set('Content-Type', 'application/xml');
      } else {
        headers.set('Content-Type', 'text/plain; charset=utf-8');
      }
      return;
    }

    // Objects: Default to JSON
    if (typeof body === 'object' && body !== null) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }
  }

  /**
   * Parses the response body according to the specified type.
   * @private
   * @param {Response} response - The fetch Response object
   * @param {string} responseType - The expected response type
   * @returns {Promise<any>} The parsed response data
   */
  async _parseResponseBody(response, responseType) {
    try {
      switch (responseType) {
        case 'text':
          return await response.text();
        case 'blob':
          return await response.blob();
        case 'arrayBuffer':
          return await response.arrayBuffer();
        case 'formData':
          return await response.formData();
        case 'json':
        default:
          const text = await response.text();
          if (!text.trim()) return null;

          try {
            return JSON.parse(text);
          } catch (jsonError) {
            const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
            throw new VortexError({
              message: `Invalid JSON response from ${response.url}. Response body: ${preview}`,
              type: VortexError.TYPES.PARSE,
              originalError: jsonError,
              requestConfig: { responseType, url: response.url },
              metadata: {
                responseText: text,
                responseStatus: response.status,
                responseHeaders: Object.fromEntries(response.headers.entries()),
              },
            });
          }
      }
    } catch (error) {
      if (error instanceof VortexError) {
        throw error;
      }
      throw new VortexError({
        message: `Failed to parse response as ${responseType} from ${response.url}`,
        type: VortexError.TYPES.PARSE,
        originalError: error,
        requestConfig: { responseType, url: response.url },
      });
    }
  }
}
