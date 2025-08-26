# 🌀 @vorthain/vortex

[![npm](https://img.shields.io/npm/v/@vorthain/vortex.svg)](https://www.npmjs.com/package/@vorthain/vortex)
[![Downloads](https://img.shields.io/npm/dm/@vorthain/vortex.svg)](https://www.npmjs.com/package/@vorthain/vortex)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@vorthain/vortex)](https://bundlephobia.com/package/@vorthain/vortex)

**Configuration-first HTTP client with developer experience in mind**

```javascript
// Configure your entire API surface
const client = createVortexClient({
  baseURL: 'https://api.example.com',
  endpoints: {
    users: { path: '/users' },
    user: { path: '/users/:id' },
    posts: { path: '/posts' },
  },
});

// Clean, predictable API
const users = await client.get('users').send();
const user = await client.get('user').pathParams({ id: 123 }).send();
```

## Installation

```bash
npm install @vorthain/vortex
```

## Why Vortex?

Traditional HTTP clients make you repeat yourself constantly - auth headers, error handling, retry logic, response transformation. You write the same patterns in every project, in every file, sometimes in every request.

Vortex flips this: configure your patterns once, use them everywhere.

```javascript
// Define once
const api = createVortexClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,

  // Auto-attach auth to every request
  requestInterceptor: async (config) => {
    config.headers.Authorization = `Bearer ${await getToken()}`;
    return config;
  },

  // Handle token refresh automatically
  errorInterceptor: async (error, config, retry) => {
    if (error.status === 401 && !config._tokenRefreshed) {
      const newToken = await refreshToken();
      return retry({
        headers: { Authorization: `Bearer ${newToken}` },
        _tokenRefreshed: true,
      });
    }
    throw error;
  },

  endpoints: {
    users: { path: '/users' },
    user: { path: '/users/:id' },
    posts: { path: '/posts' },
  },
});

// Use everywhere - auth, retries, errors all handled
const user = await api.get('user').pathParams({ id: 123 }).send();
```

## Core Features

### Configuration Hierarchy

Settings cascade from global → endpoint → method → request level:

```javascript
const api = createVortexClient({
  timeout: 30000, // Global default

  endpoints: {
    users: {
      path: '/users',
      timeout: 10000, // Override for all /users requests

      methods: {
        get: {
          cache: { enabled: true }, // Only GET /users cached
        },
        post: {
          timeout: 5000, // POST /users has 5s timeout
        },
      },
    },
  },
});

// Request-level override (highest priority)
await api.get('users').settings({ timeout: 2000 }).send();
```

### Interceptors

Interceptors let you modify requests/responses or handle errors globally:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',

  // Modify all requests before sending
  requestInterceptor: async (config) => {
    // config has: url, method, headers, body, timeout, responseType, pathParams, searchParams
    config.headers.Authorization = `Bearer ${await getToken()}`;
    config.headers['X-Request-ID'] = generateUUID();

    // Add timestamp for response interceptor to use
    config._startTime = Date.now();

    // Must return the config
    return config;
  },

  // Modify all responses after receiving
  responseInterceptor: async (response, config) => {
    // Log response time using timestamp from requestInterceptor
    if (config._startTime) {
      console.log(`Request to ${config.url} took ${Date.now() - config._startTime}ms`);
    }

    // Check for deprecation warnings
    const warning = response.headers.get('X-Deprecation-Warning');
    if (warning) {
      console.warn(`API Deprecation: ${warning}`);
    }

    // Must return the response
    return response;
  },

  // Handle all errors with retry capability
  errorInterceptor: async (error, config, retry) => {
    // Token refresh on 401
    if (error.status === 401 && !config._tokenRefreshed) {
      const newToken = await refreshAuthToken();
      return retry({
        headers: { Authorization: `Bearer ${newToken}` },
        _tokenRefreshed: true,
      });
    }

    // Retry on 503 with delay from response headers
    if (error.status === 503) {
      // Server can send Retry-After header which we capture in metadata
      const retryAfter = error.metadata?.headers?.['retry-after'];
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const result = await retry();
      if (result !== undefined) {
        return result;
      }
    }

    throw error;
  },

  endpoints: {
    users: { path: '/users' },
  },
});
```

### Smart Retry with Interceptors

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',
  maxRetries: 3, // Built-in retry limit (applies to all retry() calls)

  errorInterceptor: async (error, config, retry) => {
    // Token refresh
    if (error.status === 401 && !config._tokenRefreshed) {
      const newToken = await refreshAuthToken();
      return retry({
        headers: { Authorization: `Bearer ${newToken}` },
        _tokenRefreshed: true,
      });
    }

    // Exponential backoff for server errors
    if (error.status >= 500) {
      const attempt = config._retryCount || 0;
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const result = await retry();
      // retry() returns undefined when maxRetries is reached
      if (result !== undefined) {
        return result;
      }
    }

    throw error;
  },

  endpoints: {
    users: { path: '/users' },
  },
});
```

### Caching

Vortex includes a built-in in-memory cache with TTL support:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',

  // Enable simple caching globally
  cache: {
    enabled: true,
    ttl: 60000, // Cache for 1 minute
    strategy: 'simple', // Standard cache
  },

  endpoints: {
    users: {
      path: '/users',
      methods: {
        get: {
          cache: {
            enabled: true,
            ttl: 300000, // Override: cache users for 5 minutes
          },
        },
      },
    },
  },
});

// First call hits server
const users1 = await api.get('users').send();

// Second call returns from cache (within TTL)
const users2 = await api.get('users').send();

// Force fresh data
const fresh = await api
  .get('users')
  .settings({ cache: { enabled: false } })
  .send();

// Clear all cache
await api.clearCache();
```

#### Stale-While-Revalidate (SWR)

SWR returns cached data immediately while fetching fresh data in the background:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',

  cache: {
    enabled: true,
    strategy: 'swr', // Return stale, revalidate in background
    ttl: 30000,
  },

  endpoints: {
    dashboard: {
      path: '/dashboard',
      methods: {
        get: {
          onRevalidate: (freshData) => {
            // Called when fresh data arrives
            updateUI(freshData);
          },
        },
      },
    },
  },
});

// Instant response from cache, fresh data incoming
const data = await api.get('dashboard').send();
```

#### Custom Cache Implementation

You can provide your own cache implementation:

```javascript
class RedisCache {
  async get(key) {
    /* ... */
  }
  async set(key, value, ttl) {
    /* ... */
  }
  async delete(key) {
    /* ... */
  }
  async has(key) {
    /* ... */
  }
  async clear() {
    /* ... */
  }
}

const api = createVortexClient({
  cache: {
    enabled: true,
    instance: new RedisCache(),
    ttl: 60000,
  },
  // ... rest of config
});
```

### Request Building

```javascript
// Path parameters
await api.get('user').pathParams({ id: 123 }).send();
// → GET /users/123

// Query parameters
await api.get('users').search({ role: 'admin', active: true }).send();
// → GET /users?role=admin&active=true

// Request body
await api.post('users').body({ name: 'John', email: 'john@example.com' }).send();

// Custom settings
await api
  .get('users')
  .settings({
    timeout: 5000,
    headers: { 'X-Priority': 'high' },
    onSuccess: (data) => console.log('Got users:', data),
    onError: (error) => console.error('Failed:', error),
  })
  .send();

// Cancel request
const request = api.get('large-dataset');
const promise = request.send();

setTimeout(() => request.cancel('Taking too long'), 5000);
```

### Response Handling

You can handle responses in multiple ways:

```javascript
// 1. Async/await with try-catch
try {
  const users = await api.get('users').send();
  console.log('Success:', users);
} catch (error) {
  if (error.hasStatus(404)) {
    console.log('Not found');
  } else {
    console.error('Error:', error.message);
  }
}

// 2. Promise chains
api
  .get('users')
  .send()
  .then((users) => {
    console.log('Success:', users);
    return users.filter((u) => u.active);
  })
  .then((activeUsers) => {
    console.log('Active users:', activeUsers);
  })
  .catch((error) => {
    console.error('Failed:', error);
  })
  .finally(() => {
    console.log('Request completed');
  });

// 3. Callbacks in settings
await api
  .get('users')
  .settings({
    onStart: () => {
      console.log('Request starting...');
      showLoader();
    },
    onSuccess: (users) => {
      console.log('Got users:', users);
      updateUI(users);
    },
    onError: (error) => {
      console.error('Failed:', error);
      showErrorMessage(error.message);
    },
    onFinally: () => {
      console.log('Request done');
      hideLoader();
    },
  })
  .send();

// 4. Mix approaches - callbacks for side effects, promise for main flow
try {
  const users = await api
    .get('users')
    .settings({
      onStart: () => showLoader(),
      onFinally: () => hideLoader(), // Always runs, even if error is thrown
    })
    .send();

  // Main business logic here
  processUsers(users);
} catch (error) {
  // hideLoader() has already been called by onFinally
  handleError(error);
}
```

### Progress Tracking (Browser only)

```javascript
await api
  .post('upload')
  .body(formData)
  .settings({
    onUploadProgress: (progress) => {
      console.log(`Upload: ${Math.round(progress.progress * 100)}%`);
    },
    onDownloadProgress: (progress) => {
      console.log(`Download: ${Math.round(progress.progress * 100)}%`);
    },
  })
  .send();
```

### Response & Error Transformation

Transform data at any level of the configuration hierarchy:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',

  // Transform all successful responses
  responseMapper: (data) => ({
    ...data,
    _retrieved: Date.now(),
  }),

  // Transform all errors
  errorMapper: (error) => {
    // Add context for debugging
    error.timestamp = Date.now();
    error.userId = getCurrentUserId();

    // Send to monitoring service
    if (typeof window !== 'undefined' && window.trackError) {
      window.trackError(error);
    }

    return error;
  },

  endpoints: {
    users: {
      path: '/users',

      // Override for this endpoint
      responseMapper: (data) => data.users || data,

      methods: {
        post: {
          // Don't inherit mappers from parent levels
          inheritMappers: false,

          // Custom mapper just for POST /users
          responseMapper: (response) => ({
            success: true,
            user: response,
          }),
        },
      },
    },
  },
});
```

### Custom Status Validation

Control which HTTP status codes are considered successful:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',

  // Global: only 2xx is success (default)
  validateStatus: (status) => status >= 200 && status < 300,

  endpoints: {
    auth: {
      path: '/auth',
      methods: {
        post: {
          // Accept 201 and 202 for auth
          validateStatus: (status) => status === 201 || status === 202,
        },
      },
    },
    legacy: {
      path: '/legacy-api',
      // This old API returns 400 for "no results" - treat as success
      validateStatus: (status) => status === 200 || status === 400,
    },
  },
});

// Per-request override
await api
  .get('users')
  .settings({
    validateStatus: (status) => status < 500, // 4xx and below are "success"
  })
  .send();
```

### Response Types

Handle different response formats:

```javascript
// JSON (default)
const json = await api.get('data').send();

// Plain text
const html = await api.get('page').settings({ responseType: 'text' }).send();

// Binary data as Blob
const image = await api.get('avatar').settings({ responseType: 'blob' }).send();
// Use: URL.createObjectURL(image)

// Binary data as ArrayBuffer
const buffer = await api.get('file').settings({ responseType: 'arrayBuffer' }).send();

// FormData (rare for responses)
const formData = await api.post('form').settings({ responseType: 'formData' }).send();
```

### Redirect Handling

Control how HTTP redirects are handled:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',

  // Global default
  redirect: 'follow', // Auto-follow redirects (default)

  endpoints: {
    auth: {
      path: '/auth/login',
      methods: {
        post: {
          // Don't follow redirects - get the 3xx response
          redirect: 'manual',
          // Must also accept 3xx as valid status
          validateStatus: (status) => status >= 200 && status < 400,
        },
      },
    },
    strict: {
      path: '/strict-api',
      // Throw error on redirects
      redirect: 'error',
    },
  },
});

// Handle redirect manually
const response = await api.post('auth').body({ username, password }).send();

if (response.status === 302) {
  const redirectUrl = response.headers.get('location');
  window.location.href = redirectUrl;
}
```

### Creating Client Variants

Use `withConfig()` to create modified versions of a client:

```javascript
const baseApi = createVortexClient({
  baseURL: 'https://api.example.com',
  timeout: 30000,
  headers: {
    'X-API-Version': '1.0',
  },
  endpoints: {
    users: { path: '/users' },
    posts: { path: '/posts' },
  },
});

// Create authenticated variant
const authApi = baseApi.withConfig({
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// Create variant with different timeout
const fastApi = baseApi.withConfig({
  timeout: 5000,
});

// Create variant for different environment
const stagingApi = baseApi.withConfig({
  baseURL: 'https://staging-api.example.com',
});

// Original client unchanged
await baseApi.get('users').send(); // No auth header
await authApi.get('users').send(); // Has auth header
```

### Cache Statistics & Management

Monitor and manage your cache:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',
  cache: {
    enabled: true,
    ttl: 60000,
  },
  endpoints: {
    users: { path: '/users' },
  },
});

// Make some requests
await api.get('users').send();
await api.get('users').send(); // From cache

// Get cache statistics
const stats = await api.getCacheStats();
console.log(stats);
// {
//   hits: 1,
//   misses: 1,
//   sets: 1,
//   size: 1,
//   maxSize: 1000,
//   hitRate: 0.5
// }

// Clear specific endpoints or all
await api.clearCache();

// Clean up when done (important for Node.js apps)
await api.destroy();
```

### Cleanup & Resource Management

Properly clean up resources, especially in Node.js applications:

```javascript
const api = createVortexClient({
  baseURL: 'https://api.example.com',
  cache: { enabled: true },
  endpoints: {
    users: { path: '/users' },
  },
});

try {
  // Use the client
  await api.get('users').send();
} finally {
  // Clean up timers, cache, and pending requests
  await api.destroy();
}

// In a Node.js server
process.on('SIGTERM', async () => {
  await api.destroy();
  process.exit(0);
});
```

### Error Handling

Every error is a `VortexError` with rich context:

```javascript
try {
  await api.get('user').pathParams({ id: 999 }).send();
} catch (error) {
  console.log(error.type); // 'HTTP_ERROR'
  console.log(error.status); // 404
  console.log(error.responseBody); // Server's error response
  console.log(error.requestConfig); // Full request configuration

  // Utility methods
  if (error.isType(VortexError.TYPES.HTTP)) {
    /* ... */
  }
  if (error.hasStatus(404)) {
    /* ... */
  }
  if (error.isClientError()) {
    /* 4xx */
  }
  if (error.isServerError()) {
    /* 5xx */
  }
}
```

Error types:

- `HTTP_ERROR` - 4xx/5xx responses
- `NETWORK_ERROR` - Connection failures
- `TIMEOUT_ERROR` - Request timeout
- `ABORT_ERROR` - Cancelled requests
- `PARSE_ERROR` - Response parsing failures
- `VALIDATION_ERROR` - Invalid configuration
- `CONFIG_ERROR` - Setup errors

### Parallel Requests

```javascript
// Wait for all
const [users, posts] = await Promise.all([api.get('users').send(), api.get('posts').send()]);

// Handle failures individually
const results = await Promise.allSettled([api.get('users').send(), api.get('posts').send()]);

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    console.log(`Request ${index} succeeded:`, result.value);
  } else {
    console.log(`Request ${index} failed:`, result.reason);
  }
});
```

## API Reference

### `createVortexClient(config)`

Creates a new client instance.

### `client.get/post/put/patch/delete(endpoint)`

Create a request builder for the specified endpoint.

### `client.request(method, endpoint)`

Create a request with custom HTTP method.

### Request Builder Methods

- `.pathParams(params)` - Replace path parameters
- `.search(params)` - Add query parameters
- `.body(data)` - Set request body
- `.settings(config)` - Override request settings
- `.cancel(message?)` - Cancel the request
- `.send()` - Execute and return promise

### Utility Methods

- `client.withConfig(config)` - Create new client with merged config
- `client.clearCache()` - Clear all cached responses
- `client.getCacheStats()` - Get cache statistics
- `client.destroy()` - Clean up resources
