import { VortexError } from './error.js';
import { SimpleCache } from './cache.js';
import { RequestBuilder } from './requestBuilder.js';

/**
 * @typedef {Object} CacheConfig
 * @property {boolean} [enabled=false] - Whether caching is enabled for requests
 * @property {number} [ttl=60000] - Time-to-live for cached items in milliseconds (default: 1 minute)
 * @property {'simple' | 'swr'} [strategy='simple'] - Caching strategy. 'simple' = standard caching, 'swr' = stale-while-revalidate
 * @property {import('./cache.js').CacheInterface} [instance] - Custom cache instance. Must implement get/set/clear methods
 */

/**
 * @typedef {Object} MethodConfig
 * @property {number} [maxRetries=10] - Maximum number of retries allowed in interceptors
 * @property {'follow' | 'manual' | 'error'} [redirect='follow'] - How to handle HTTP redirects. 'follow' = auto-follow, 'manual' = return 3xx response, 'error' = throw on redirect
 * @property {Function | Function[]} [responseMapper] - Transform successful response data. Can be a single function or array of functions
 * @property {Function | Function[]} [errorMapper] - Transform error responses. Can be a single function or array of functions
 * @property {boolean} [inheritMappers=true] - Whether to inherit mappers from parent levels. Set to false to use only this level's mappers
 * @property {boolean} [disableMappers=false] - Completely disable all mappers for this method
 * @property {boolean} [disableResponseMapper=false] - Disable only response mappers
 * @property {boolean} [disableErrorMapper=false] - Disable only error mappers
 * @property {number} [timeout] - Request timeout override for this method
 * @property {CacheConfig} [cache] - Cache configuration override for this method
 * @property {Record<string, string>} [headers] - HTTP headers override for this method
 * @property {(config: Object) => Object | Promise<Object>} [requestInterceptor] - Request interceptor
 * @property {(response: any, config: Object) => any} [responseInterceptor] - Response interceptor
 * @property {(error: VortexError, config: Object, retry: Function) => any} [errorInterceptor] - Error interceptor with retry capability
 * @property {'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData'} [responseType='json'] - Expected response type
 * @property {(status: number) => boolean} [validateStatus] - Function to determine if status code indicates success
 * @property {() => void} [onStart] - Callback executed when request starts
 * @property {(data: any) => void} [onSuccess] - Callback executed on successful response
 * @property {(revalidatedData: any) => void} [onRevalidate] - Callback for stale-while-revalidate fresh data
 * @property {(progress: ProgressEvent) => void} [onDownloadProgress] - Callback for download progress updates
 * @property {(progress: ProgressEvent) => void} [onUploadProgress] - Callback for upload progress updates
 * @property {(error: VortexError) => void} [onError] - Callback executed on error
 * @property {() => void} [onFinally] - Callback executed regardless of outcome
 */

/**
 * @typedef {Object} EndpointConfig
 * @property {string} path - The endpoint path. Can include :param placeholders for dynamic segments
 * @property {Record<string, MethodConfig>} [methods] - HTTP method-specific configurations
 * @property {number} [maxRetries=10] - Maximum retries for this endpoint
 * @property {'follow' | 'manual' | 'error'} [redirect='follow'] - How to handle redirects for this endpoint
 * @property {Function | Function[]} [responseMapper] - Default response mapper(s) for this endpoint
 * @property {Function | Function[]} [errorMapper] - Default error mapper(s) for this endpoint
 * @property {boolean} [inheritMappers=true] - Whether to inherit mappers from client level
 * @property {boolean} [disableMappers=false] - Disable all mappers for this endpoint
 * @property {boolean} [disableResponseMapper=false] - Disable only response mappers
 * @property {boolean} [disableErrorMapper=false] - Disable only error mappers
 * @property {number} [timeout] - Default timeout for this endpoint
 * @property {CacheConfig} [cache] - Default cache config for this endpoint
 * @property {Record<string, string>} [headers] - Default headers for this endpoint
 * @property {(config: Object) => Object | Promise<Object>} [requestInterceptor] - Default request interceptor for this endpoint
 * @property {(response: any, config: Object) => any} [responseInterceptor] - Default response interceptor for this endpoint
 * @property {(error: VortexError, config: Object, retry: Function) => any} [errorInterceptor] - Default error interceptor for this endpoint
 * @property {'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData'} [responseType='json'] - Default response type
 * @property {(status: number) => boolean} [validateStatus] - Default status validation function
 * @property {() => void} [onStart] - Default onStart callback
 * @property {(data: any) => void} [onSuccess] - Default onSuccess callback
 * @property {(revalidatedData: any) => void} [onRevalidate] - Default onRevalidate callback
 * @property {(progress: ProgressEvent) => void} [onDownloadProgress] - Default onDownloadProgress callback
 * @property {(progress: ProgressEvent) => void} [onUploadProgress] - Default onUploadProgress callback
 * @property {(error: VortexError) => void} [onError] - Default onError callback
 * @property {() => void} [onFinally] - Default onFinally callback
 */

/**
 * @typedef {Object} VortexConfig
 * @property {string} baseURL - The base URL for all requests. Can be a full URL, empty string for same-origin, or a relative path like '/api'
 * @property {Record<string, EndpointConfig>} endpoints - Endpoint configurations. Keys are endpoint names used in method calls
 * @property {number} [timeout=30000] - Default request timeout in milliseconds
 * @property {number} [maxRetries=10] - Default maximum retries for interceptors
 * @property {'follow' | 'manual' | 'error'} [redirect='follow'] - Default redirect behavior
 * @property {CacheConfig} [cache] - Default cache configuration
 * @property {Record<string, string>} [headers] - Default headers for all requests
 * @property {(config: Object) => Object | Promise<Object>} [requestInterceptor] - Global request interceptor. Can modify headers, body, and all config
 * @property {(response: any, config: Object) => any} [responseInterceptor] - Global response interceptor. Runs before mappers
 * @property {(error: VortexError, config: Object, retry: Function) => any} [errorInterceptor] - Global error interceptor with retry capability
 * @property {Function | Function[]} [responseMapper] - Global response mapper(s). Transforms successful responses
 * @property {Function | Function[]} [errorMapper] - Global error mapper(s). Transforms error responses
 * @property {'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData'} [responseType='json'] - Default response type
 * @property {(status: number) => boolean} [validateStatus] - Global status validation function
 * @property {() => void} [onStart] - Global onStart callback
 * @property {(data: any) => void} [onSuccess] - Global onSuccess callback
 * @property {(revalidatedData: any) => void} [onRevalidate] - Global onRevalidate callback
 * @property {(progress: ProgressEvent) => void} [onDownloadProgress] - Global onDownloadProgress callback
 * @property {(progress: ProgressEvent) => void} [onUploadProgress] - Global onUploadProgress callback
 * @property {(error: VortexError) => void} [onError] - Global onError callback
 * @property {() => void} [onFinally] - Global onFinally callback
 */

/**
 * The main Vortex HTTP client class.
 * Provides a fluent, configuration-driven interface for making HTTP requests.
 *
 * @template {Record<string, EndpointConfig>} TEndpointsConfig
 * @class
 *
 * @example
 * // Basic usage
 * const client = new Vortex({
 *   baseURL: 'https://api.example.com',
 *   endpoints: {
 *     users: { path: '/users' },
 *     user: { path: '/users/:id' }
 *   }
 * });
 *
 * const users = await client.get('users').send();
 * const user = await client.get('user').pathParams({ id: 123 }).send();
 *
 * @example
 * // Same-origin requests
 * const client = new Vortex({
 *   baseURL: '', // Empty string for same origin
 *   endpoints: {
 *     api: { path: '/api/data' }
 *   }
 * });
 *
 * // Or with relative base path
 * const client = new Vortex({
 *   baseURL: '/api', // Relative path
 *   endpoints: {
 *     users: { path: '/users' } // Results in /api/users
 *   }
 * });
 *
 * @example
 * // Advanced configuration with interceptors and retry
 * const client = new Vortex({
 *   baseURL: 'https://api.example.com',
 *   maxRetries: 3, // Limit for interceptor retries
 *   redirect: 'follow', // Default redirect behavior
 *
 *   // Global request interceptor
 *   requestInterceptor: async (config) => {
 *     // Add auth header
 *     config.headers['Authorization'] = `Bearer ${await getToken()}`;
 *
 *     // Modify body
 *     if (config.body) {
 *       config.body = { ...config.body, timestamp: Date.now() };
 *     }
 *
 *     return config;
 *   },
 *
 *   // Global error interceptor with retry capability
 *   errorInterceptor: async (error, config, retry) => {
 *     // Token refresh on 401
 *     if (error.status === 401 && !config._tokenRefreshed) {
 *       try {
 *         const newToken = await refreshToken();
 *         const result = await retry({
 *           headers: { 'Authorization': `Bearer ${newToken}` },
 *           _tokenRefreshed: true
 *         });
 *         // Check if retry succeeded
 *         if (result !== undefined) {
 *           return result;
 *         }
 *         throw error; // Retry failed, throw the error
 *       } catch (refreshError) {
 *         await logout();
 *         throw error;
 *       }
 *     }
 *
 *     // Retry on server errors with exponential backoff
 *     if (error.status >= 500) {
 *       const retryCount = config._retryCount || 0;
 *       const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
 *       await new Promise(resolve => setTimeout(resolve, delay));
 *
 *       const result = await retry();
 *       // Check if retry succeeded
 *       if (result !== undefined) {
 *         return result;
 *       }
 *       throw error; // Max retries reached, throw the error
 *     }
 *
 *     throw error;
 *   },
 *
 *   // Global response transformation
 *   responseMapper: (data) => {
 *     // Transform all responses (e.g., snake_case to camelCase)
 *     return transformKeys(data);
 *   },
 *
 *   // Global error transformation
 *   errorMapper: (error) => {
 *     // Add user-friendly messages
 *     if (error.status === 404) {
 *       error.userMessage = 'The requested resource was not found.';
 *     } else if (error.type === VortexError.TYPES.NETWORK) {
 *       error.userMessage = 'Please check your internet connection.';
 *     }
 *     return error;
 *   },
 *
 *   // Cache configuration
 *   cache: {
 *     enabled: true,
 *     ttl: 5 * 60 * 1000, // 5 minutes
 *     strategy: 'swr'
 *   },
 *
 *   endpoints: {
 *     users: {
 *       path: '/users',
 *       maxRetries: 5, // Override for this endpoint
 *       responseMapper: (data) => data.users || data,
 *
 *       methods: {
 *         get: {
 *           cache: { enabled: true, ttl: 10 * 60 * 1000 },
 *           responseMapper: (users) => users.filter(u => u.active)
 *         },
 *         post: {
 *           maxRetries: 1, // Limit retries for POST
 *           inheritMappers: false,
 *           responseMapper: (response) => response.created
 *         }
 *       }
 *     },
 *
 *     // Login endpoint with manual redirect handling
 *     login: {
 *       path: '/auth/login',
 *       methods: {
 *         post: {
 *           redirect: 'manual', // Don't follow redirects
 *           validateStatus: (status) => status >= 200 && status < 400, // 3xx is success
 *           responseMapper: (response) => {
 *             // Handle redirect response
 *             if (response.status >= 300 && response.status < 400) {
 *               return {
 *                 redirected: true,
 *                 location: response.headers.get('location'),
 *                 status: response.status
 *               };
 *             }
 *             return response;
 *           }
 *         }
 *       }
 *     }
 *   }
 * });
 */
export class Vortex {
  /**
   * Creates a new Vortex client instance.
   *
   * @param {VortexConfig} config - The client configuration
   * @throws {VortexError} When required configuration is missing or invalid
   *
   * @example
   * const client = new Vortex({
   *   baseURL: 'https://api.example.com',
   *   endpoints: {
   *     users: { path: '/users' }
   *   }
   * });
   */
  constructor(config) {
    this._validateConfig(config);

    /** @private */
    this.config = this._normalizeConfig(config);
  }

  /**
   * Validates the provided configuration.
   * @private
   * @param {VortexConfig} config - The configuration to validate
   * @throws {VortexError} When configuration is invalid
   */
  _validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new VortexError({
        message: 'Vortex configuration must be an object',
        type: VortexError.TYPES.CONFIG,
      });
    }

    // baseURL can be empty string or relative path now
    if (config.baseURL === null || config.baseURL === undefined) {
      throw new VortexError({
        message: 'Vortex requires a baseURL in the configuration (can be empty string for same-origin)',
        type: VortexError.TYPES.CONFIG,
      });
    }

    if (!config.endpoints || typeof config.endpoints !== 'object') {
      throw new VortexError({
        message: 'Vortex requires an endpoints object in the configuration',
        type: VortexError.TYPES.CONFIG,
      });
    }

    // Validate each endpoint
    Object.entries(config.endpoints).forEach(([endpointName, endpointConfig]) => {
      if (!endpointConfig || typeof endpointConfig !== 'object') {
        throw new VortexError({
          message: `Endpoint '${endpointName}' must be an object`,
          type: VortexError.TYPES.CONFIG,
        });
      }

      if (!endpointConfig.path || typeof endpointConfig.path !== 'string') {
        throw new VortexError({
          message: `Endpoint '${endpointName}' requires a valid path string`,
          type: VortexError.TYPES.CONFIG,
        });
      }
    });

    // Only validate baseURL format if it's a full URL
    if (config.baseURL && !config.baseURL.startsWith('/') && config.baseURL !== '') {
      try {
        new URL(config.baseURL);
      } catch (error) {
        // Not a valid full URL, but might be a relative path - that's ok
        console.warn(`baseURL "${config.baseURL}" is not a full URL. It will be treated as a relative path.`);
      }
    }
  }

  /**
   * Normalizes and sets defaults for the configuration.
   * @private
   * @param {VortexConfig} config - The raw configuration
   * @returns {VortexConfig} The normalized configuration
   */
  _normalizeConfig(config) {
    const normalizedConfig = {
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
      ...config,
    };

    // Ensure cache has an instance
    if (!normalizedConfig.cache.instance) {
      normalizedConfig.cache.instance = new SimpleCache();
    }

    // Normalize endpoint configs
    Object.keys(normalizedConfig.endpoints).forEach((endpointName) => {
      const endpoint = normalizedConfig.endpoints[endpointName];

      // Ensure methods object exists
      if (!endpoint.methods) {
        endpoint.methods = {};
      }

      // Normalize method-specific configs
      Object.keys(endpoint.methods).forEach((method) => {
        const methodConfig = endpoint.methods[method];
        if (methodConfig.cache && !methodConfig.cache.instance) {
          methodConfig.cache.instance = normalizedConfig.cache.instance;
        }
      });
    });

    return normalizedConfig;
  }

  /**
   * Creates a GET request builder for the specified endpoint.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // Simple GET request
   * const users = await client.get('users').send();
   *
   * @example
   * // GET with path parameters and query string
   * const user = await client.get('user')
   *   .pathParams({ id: 123 })
   *   .search({ include: 'posts' })
   *   .send();
   *
   * @example
   * // GET with custom settings
   * const data = await client.get('users')
   *   .settings({
   *     timeout: 5000,
   *     responseMapper: (data) => data.items
   *   })
   *   .send();
   */
  get(endpointName) {
    return this._createRequestBuilder('get', endpointName);
  }

  /**
   * Creates a POST request builder for the specified endpoint.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // POST with JSON body
   * const newUser = await client.post('users')
   *   .body({ name: 'John Doe', email: 'john@example.com' })
   *   .send();
   *
   * @example
   * // POST with FormData for file upload
   * const formData = new FormData();
   * formData.append('file', fileBlob);
   * formData.append('description', 'User avatar');
   *
   * const result = await client.post('upload')
   *   .body(formData)
   *   .send();
   */
  post(endpointName) {
    return this._createRequestBuilder('post', endpointName);
  }

  /**
   * Creates a PUT request builder for the specified endpoint.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // PUT to update a resource
   * const updatedUser = await client.put('user')
   *   .pathParams({ id: 123 })
   *   .body({ name: 'Jane Doe', email: 'jane@example.com' })
   *   .send();
   */
  put(endpointName) {
    return this._createRequestBuilder('put', endpointName);
  }

  /**
   * Creates a PATCH request builder for the specified endpoint.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // PATCH to partially update a resource
   * const result = await client.patch('user')
   *   .pathParams({ id: 123 })
   *   .body({ email: 'newemail@example.com' })
   *   .send();
   */
  patch(endpointName) {
    return this._createRequestBuilder('patch', endpointName);
  }

  /**
   * Creates a DELETE request builder for the specified endpoint.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // DELETE a resource
   * await client.delete('user')
   *   .pathParams({ id: 123 })
   *   .send();
   *
   * @example
   * // DELETE with query parameters
   * await client.delete('users')
   *   .search({ status: 'inactive' })
   *   .send();
   */
  delete(endpointName) {
    return this._createRequestBuilder('delete', endpointName);
  }

  /**
   * Creates a request builder for any HTTP method.
   * Useful for less common HTTP methods like HEAD, OPTIONS, etc.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {string} method - The HTTP method (case-insensitive)
   * @param {TEndpointName} endpointName - The name of the endpoint
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // HEAD request to check if resource exists
   * const result = await client.request('HEAD', 'user')
   *   .pathParams({ id: 123 })
   *   .send();
   *
   * @example
   * // OPTIONS request for CORS preflight
   * const result = await client.request('OPTIONS', 'users').send();
   */
  request(method, endpointName) {
    return this._createRequestBuilder(method, endpointName);
  }

  /**
   * Creates a HEAD request builder for the specified endpoint.
   * HEAD requests are identical to GET but return only headers without the response body.
   * Useful for checking if a resource exists or getting metadata without downloading content.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // Check if a resource exists
   * try {
   *   await client.head('user').pathParams({ id: 123 }).send();
   *   console.log('User exists');
   * } catch (error) {
   *   if (error.status === 404) console.log('User not found');
   * }
   *
   * @example
   * // Get file size without downloading
   * const response = await client.head('file').pathParams({ id: 'abc' }).send();
   * // Response will be null, but you can access headers via interceptors
   */
  head(endpointName) {
    return this._createRequestBuilder('head', endpointName);
  }

  /**
   * Creates an OPTIONS request builder for the specified endpoint.
   * OPTIONS requests are used to determine allowed methods and CORS settings for a resource.
   * Commonly used for CORS preflight requests in browsers.
   *
   * @template {keyof TEndpointsConfig} TEndpointName
   * @param {TEndpointName} endpointName - The name of the endpoint from your configuration
   * @returns {RequestBuilder} A request builder for chaining configuration
   * @throws {VortexError} When the endpoint is not found
   *
   * @example
   * // Check allowed methods for an endpoint
   * await client.options('users').send();
   * // Check Allow header in response interceptor
   *
   * @example
   * // CORS preflight check
   * const response = await client.options('api')
   *   .settings({
   *     headers: {
   *       'Access-Control-Request-Method': 'POST',
   *       'Access-Control-Request-Headers': 'Content-Type'
   *     }
   *   })
   *   .send();
   */
  options(endpointName) {
    return this._createRequestBuilder('options', endpointName);
  }

  /**
   * Creates a request builder for the specified method and endpoint.
   * @private
   * @param {string} httpMethod - The HTTP method
   * @param {string} endpointName - The endpoint name
   * @returns {RequestBuilder} The request builder instance
   * @throws {VortexError} When the endpoint is not found
   */
  _createRequestBuilder(httpMethod, endpointName) {
    const endpointConfig = this.config.endpoints[endpointName];

    if (!endpointConfig) {
      throw new VortexError({
        message: `Endpoint '${String(endpointName)}' not found in configuration. Available endpoints: ${Object.keys(
          this.config.endpoints
        ).join(', ')}`,
        type: VortexError.TYPES.CONFIG,
        metadata: {
          requestedEndpoint: endpointName,
          availableEndpoints: Object.keys(this.config.endpoints),
        },
      });
    }

    return new RequestBuilder({
      httpMethod,
      endpointConfig,
      clientInstance: this,
    });
  }

  /**
   * Gets the current configuration (read-only copy).
   *
   * @returns {VortexConfig} A copy of the current configuration
   *
   * @example
   * const config = client.getConfig();
   * console.log(config.baseURL);
   * console.log(config.endpoints);
   */
  getConfig() {
    // Create a deep copy while avoiding circular references
    const configCopy = {
      ...this.config,
      cache: {
        ...this.config.cache,
        // Don't include the cache instance to avoid circular references
        instance: this.config.cache?.instance ? '[CacheInstance]' : undefined,
      },
    };

    return JSON.parse(JSON.stringify(configCopy));
  }

  /**
   * Creates a new Vortex instance with merged configuration.
   * Useful for creating variants with different settings.
   *
   * @param {Partial<VortexConfig>} newConfig - Configuration to merge
   * @returns {Vortex} A new Vortex instance
   *
   * @example
   * // Create a variant with different timeout
   * const fastClient = client.withConfig({ timeout: 5000 });
   *
   * @example
   * // Create an authenticated variant
   * const authenticatedClient = client.withConfig({
   *   headers: {
   *     ...client.getConfig().headers,
   *     'Authorization': 'Bearer ' + token
   *   }
   * });
   *
   * @example
   * // Create a variant with different base URL for staging
   * const stagingClient = client.withConfig({
   *   baseURL: 'https://staging-api.example.com'
   * });
   */
  withConfig(newConfig) {
    const mergedConfig = {
      ...this.config,
      ...newConfig,
      headers: {
        ...this.config.headers,
        ...newConfig.headers,
      },
      cache: {
        ...this.config.cache,
        ...newConfig.cache,
      },
      endpoints: {
        ...this.config.endpoints,
        ...newConfig.endpoints,
      },
    };

    return new Vortex(mergedConfig);
  }

  /**
   * Clears all caches used by this client.
   *
   * @returns {Promise<void>}
   *
   * @example
   * // Clear all cached responses
   * await client.clearCache();
   */
  async clearCache() {
    if (this.config.cache?.instance) {
      await this.config.cache.instance.clear();
    }
  }

  /**
   * Gets cache statistics if available.
   *
   * @returns {Promise<Object>} Cache statistics including hits, misses, size, and hit rate
   *
   * @example
   * const stats = await client.getCacheStats();
   * console.log(`Cache hit rate: ${stats.hitRate * 100}%`);
   * console.log(`Cache size: ${stats.size}/${stats.maxSize}`);
   */
  async getCacheStats() {
    if (this.config.cache?.instance && typeof this.config.cache.instance.stats === 'function') {
      return await this.config.cache.instance.stats();
    }
    return { hits: 0, misses: 0, size: 0, maxSize: 0, hitRate: 0 };
  }

  /**
   * Destroys the client and cleans up all resources.
   * Call this when you're done with the client to prevent memory leaks.
   *
   * @returns {Promise<void>}
   *
   * @example
   * const client = createVortexClient(config);
   * try {
   *   // Use the client
   *   await client.get('users').send();
   * } finally {
   *   // Always clean up
   *   await client.destroy();
   * }
   */
  async destroy() {
    // Clean up cache
    if (this.config.cache?.instance && typeof this.config.cache.instance.destroy === 'function') {
      await this.config.cache.instance.destroy();
    }

    // Clean up RequestBuilder static resources
    RequestBuilder.destroy();
  }
}

/**
 * Factory function for creating a Vortex client with TypeScript-friendly inference.
 *
 * @template {Record<string, EndpointConfig>} TEndpointsConfig
 * @param {VortexConfig & { endpoints: TEndpointsConfig }} config - The client configuration
 * @returns {Vortex<TEndpointsConfig>} A new Vortex client instance
 *
 * @example
 * // Basic client creation
 * const client = createVortexClient({
 *   baseURL: 'https://api.example.com',
 *   endpoints: {
 *     users: { path: '/users' },
 *     user: { path: '/users/:id' },
 *     posts: { path: '/posts' }
 *   }
 * });
 *
 * // TypeScript will provide autocompletion for endpoint names
 * client.get('users');   // âœ… Valid
 * client.get('user');    // âœ… Valid
 * client.get('invalid'); // âŒ TypeScript error
 *
 * @example
 * // Using constants for endpoint names (best practice)
 * const ENDPOINTS = {
 *   USERS: 'users',
 *   USER: 'user',
 *   POSTS: 'posts'
 * };
 *
 * const client = createVortexClient({
 *   baseURL: 'https://api.example.com',
 *   endpoints: {
 *     [ENDPOINTS.USERS]: { path: '/users' },
 *     [ENDPOINTS.USER]: { path: '/users/:id' },
 *     [ENDPOINTS.POSTS]: { path: '/posts' }
 *   }
 * });
 *
 * // Use with constants
 * await client.get(ENDPOINTS.USERS).send();
 * await client.post(ENDPOINTS.USERS).body({ name: 'John' }).send();
 *
 * @example
 * // Same-origin API calls
 * const client = createVortexClient({
 *   baseURL: '', // Empty string = same origin
 *   endpoints: {
 *     api: { path: '/api/data' },
 *     auth: { path: '/auth/login' }
 *   }
 * });
 *
 * @example
 * // Redirect handling example
 * const client = createVortexClient({
 *   baseURL: 'https://api.example.com',
 *   redirect: 'follow', // Default behavior
 *
 *   endpoints: {
 *     // Manual redirect handling for login
 *     login: {
 *       path: '/auth/login',
 *       methods: {
 *         post: {
 *           redirect: 'manual', // Don't auto-follow redirects
 *           validateStatus: (status) => status >= 200 && status < 400, // 3xx is success
 *           responseMapper: (response) => {
 *             // Handle redirect response
 *             if (response.status >= 300 && response.status < 400) {
 *               return {
 *                 redirected: true,
 *                 location: response.headers.get('location'),
 *                 status: response.status
 *               };
 *             }
 *             return response;
 *           }
 *         }
 *       }
 *     },
 *
 *     // File upload with progress tracking
 *     upload: {
 *       path: '/files',
 *       methods: {
 *         post: {
 *           timeout: 60000, // Longer timeout for uploads
 *           onUploadProgress: (progress) => {
 *             console.log(`Upload: ${Math.round(progress.progress * 100)}%`);
 *           },
 *           onDownloadProgress: (progress) => {
 *             console.log(`Download: ${Math.round(progress.progress * 100)}%`);
 *           },
 *           responseMapper: (response) => response.file
 *         }
 *       }
 *     },
 *
 *     // SWR caching example
 *     posts: {
 *       path: '/posts',
 *       methods: {
 *         get: {
 *           cache: {
 *             enabled: true,
 *             strategy: 'swr',
 *             ttl: 30000 // 30 seconds
 *           },
 *           onRevalidate: (freshData) => {
 *             console.log('Got fresh data in background:', freshData);
 *             // Update UI with fresh data
 *           }
 *         }
 *       }
 *     }
 *   }
 * });
 *
 * @example
 * // Advanced error handling and retry
 * const client = createVortexClient({
 *   baseURL: 'https://api.example.com',
 *   maxRetries: 3,
 *
 *   // Global error interceptor with smart retry
 *   errorInterceptor: async (error, config, retry) => {
 *     // Handle token refresh
 *     if (error.status === 401 && !config._tokenRefreshed) {
 *       try {
 *         const newToken = await refreshAuthToken();
 *         const result = await retry({
 *           headers: { 'Authorization': `Bearer ${newToken}` },
 *           _tokenRefreshed: true
 *         });
 *         if (result !== undefined) {
 *           return result;
 *         }
 *       } catch (refreshError) {
 *         redirectToLogin();
 *       }
 *       throw error;
 *     }
 *
 *     // Exponential backoff for server errors
 *     if (error.status >= 500) {
 *       const retryCount = config._retryCount || 0;
 *       if (retryCount < 3) {
 *         const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
 *         await new Promise(resolve => setTimeout(resolve, delay));
 *         const result = await retry();
 *         if (result !== undefined) {
 *           return result;
 *         }
 *       }
 *     }
 *
 *     throw error;
 *   },
 *
 *   endpoints: {
 *     users: { path: '/users' },
 *     posts: { path: '/posts' }
 *   }
 * });
 */
export function createVortexClient(config) {
  return new Vortex(config);
}

// Export error types for convenient access
export { VortexError } from './error.js';
export { SimpleCache, NoOpCache, CacheInterface } from './cache.js';
