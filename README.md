# 🌀 @vorthain/vortex

[![npm version](https://badge.fury.io/js/@vorthain/vortex.svg)](https://www.npmjs.com/package/@vorthain/vortex)
[![Downloads](https://img.shields.io/npm/dm/@vorthain/vortex.svg)](https://www.npmjs.com/package/@vorthain/vortex)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@vorthain/vortex)](https://bundlephobia.com/package/@vorthain/vortex)

**Configuration-first HTTP client with developer experience in mind**

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',
  endpoints: {
    users: { path: '/users' },
    user: { path: '/users/:id' },
  },
});

// Full autocomplete in both JavaScript and TypeScript
const users = await client.get('users').send();
const user = await client.get('user').pathParams({ id: 123 }).send();
```

## Installation

```bash
npm install @vorthain/vortex
```

## Quick Start

```javascript
import { createVortexClient } from '@vorthain/vortex';

const client = createVortexClient({
  baseURL: 'https://api.example.com',
  endpoints: {
    posts: { path: '/posts' },
    post: { path: '/posts/:id' },
    comments: { path: '/posts/:postId/comments' },
  },
});

// GET request
const posts = await client.get('posts').send();

// GET with path parameters
const post = await client.get('post').pathParams({ id: 123 }).send();

// GET with query parameters
const comments = await client.get('comments').pathParams({ postId: 123 }).search({ limit: 10, sort: 'newest' }).send();

// POST with body
const newPost = await client.post('posts').body({ title: 'Hello', content: 'World' }).send();
```

## Core Concepts

### Configuration Hierarchy

Settings cascade from global → endpoint → method → request level:

```javascript
const client = createVortexClient({
  // Global config
  baseURL: 'https://api.example.com',
  timeout: 30000,
  headers: { 'X-API-Version': '1.0' },

  endpoints: {
    users: {
      // Endpoint config (overrides global)
      path: '/users',
      timeout: 10000,

      methods: {
        // Method config (overrides endpoint)
        get: {
          cache: { enabled: true, ttl: 60000 },
        },
        post: {
          timeout: 5000,
        },
      },
    },
  },
});

// Request config (overrides everything)
await client.get('users').settings({ timeout: 2000 }).send();
```

## HTTP Methods

### GET Requests

```javascript
// Simple GET
const users = await client.get('users').send();

// With path parameters
const user = await client.get('user').pathParams({ id: 123 }).send();

// With query parameters
const filtered = await client.get('users').search({ role: 'admin', active: true }).send();

// Using promises
client
  .get('users')
  .send()
  .then((users) => console.log(users))
  .catch((error) => console.error(error))
  .finally(() => console.log('Done'));

// Using try-catch
try {
  const users = await client.get('users').send();
  console.log(users);
} catch (error) {
  if (error.status === 404) {
    console.log('Not found');
  }
}
```

### POST Requests

```javascript
// JSON body
const user = await client.post('users').body({ name: 'John', email: 'john@example.com' }).send();

// FormData for file uploads
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('description', 'Avatar');

const upload = await client.post('upload').body(formData).send();

// URLSearchParams
const params = new URLSearchParams();
params.append('username', 'john');
params.append('password', 'secret');

const token = await client.post('login').body(params).send();
```

### PUT, PATCH, DELETE

```javascript
// PUT - full update
const updated = await client
  .put('user')
  .pathParams({ id: 123 })
  .body({ name: 'Jane', email: 'jane@example.com' })
  .send();

// PATCH - partial update
const patched = await client.patch('user').pathParams({ id: 123 }).body({ email: 'newemail@example.com' }).send();

// DELETE
await client.delete('user').pathParams({ id: 123 }).send();

// Custom methods (HEAD, OPTIONS, etc.)
await client.request('HEAD', 'user').pathParams({ id: 123 }).send();
```

## Request Building

### Path Parameters

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',
  endpoints: {
    user: { path: '/users/:id' },
    post: { path: '/users/:userId/posts/:postId' },
    file: { path: '/projects/:projectId/folders/:folderId/files/:fileId' },
  },
});

// Single parameter
await client.get('user').pathParams({ id: 123 }).send();
// → GET /users/123

// Multiple parameters
await client.get('post').pathParams({ userId: 1, postId: 2 }).send();
// → GET /users/1/posts/2

// Special characters are encoded
await client.get('user').pathParams({ id: 'user@example.com' }).send();
// → GET /users/user%40example.com
```

### Query Parameters

```javascript
// Basic query
await client.get('users').search({ page: 1, limit: 20 }).send();
// → GET /users?page=1&limit=20

// Null and undefined are ignored
await client
  .get('users')
  .search({
    name: 'John',
    age: null, // ignored
    city: undefined, // ignored
  })
  .send();
// → GET /users?name=John
```

### Request Settings

```javascript
await client
  .post('users')
  .body({ name: 'John' })
  .settings({
    timeout: 5000,
    headers: { 'X-Priority': 'high' },
    responseType: 'json',
    validateStatus: (status) => status < 400,
    onUploadProgress: (progress) => {
      console.log(`${Math.round(progress.progress * 100)}%`);
    },
    onDownloadProgress: (progress) => {
      console.log(`${Math.round(progress.progress * 100)}%`);
    },
  })
  .send();
```

## Error Handling

### VortexError

Every error is a `VortexError` with detailed context:

```javascript
try {
  await client.get('user').pathParams({ id: 999 }).send();
} catch (error) {
  console.log(error.type); // 'HTTP_ERROR'
  console.log(error.status); // 404
  console.log(error.message); // 'HTTP 404: Not Found'
  console.log(error.responseBody); // Server's error response
  console.log(error.requestConfig); // Request configuration

  // Helper methods
  if (error.isType(VortexError.TYPES.HTTP)) {
    console.log('HTTP error');
  }

  if (error.hasStatus(404)) {
    console.log('Not found');
  }

  if (error.isClientError()) {
    console.log('4xx error');
  }

  if (error.isServerError()) {
    console.log('5xx error');
  }
}
```

### Error Types

```javascript
VortexError.TYPES = {
  HTTP: 'HTTP_ERROR', // 4xx, 5xx responses
  NETWORK: 'NETWORK_ERROR', // Connection failures
  TIMEOUT: 'TIMEOUT_ERROR', // Request timeouts
  ABORT: 'ABORT_ERROR', // Cancelled requests
  PARSE: 'PARSE_ERROR', // Response parsing failures
  VALIDATION: 'VALIDATION_ERROR', // Invalid request config
  CONFIG: 'CONFIG_ERROR', // Configuration errors
  CACHE: 'CACHE_ERROR', // Cache operation failures
};
```

## Interceptors

### Request Interceptor

Modify requests before they're sent:

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',

  requestInterceptor: async (config) => {
    // Add auth token
    const token = await getAuthToken();
    config.headers['Authorization'] = `Bearer ${token}`;

    // Add request ID
    config.headers['X-Request-ID'] = generateUUID();

    // Add timestamp to body
    if (config.body && config.method === 'POST') {
      config.body = {
        ...config.body,
        timestamp: Date.now(),
      };
    }

    return config;
  },

  endpoints: {
    users: { path: '/users' },
  },
});
```

### Response Interceptor

Transform responses:

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',

  responseInterceptor: async (response, config) => {
    // Log response time
    console.log(`Request took ${Date.now() - config._startTime}ms`);

    // Check for deprecation warnings
    const warning = response.headers.get('X-Deprecation-Warning');
    if (warning) {
      console.warn(`API Deprecation: ${warning}`);
    }

    return response;
  },

  endpoints: {
    users: { path: '/users' },
  },
});
```

### Error Interceptor with Retry

Handle errors and retry failed requests:

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',
  maxRetries: 3,

  errorInterceptor: async (error, config, retry) => {
    // Token refresh on 401
    if (error.status === 401 && !config._tokenRefreshed) {
      try {
        const newToken = await refreshAuthToken();

        // Retry with new token
        return await retry({
          headers: { Authorization: `Bearer ${newToken}` },
          _tokenRefreshed: true,
        });
      } catch (refreshError) {
        // Refresh failed, logout user
        await logout();
        throw error;
      }
    }

    // Retry on 503 with delay
    if (error.status === 503) {
      const retryAfter = error.response?.headers?.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 5000;

      await new Promise((resolve) => setTimeout(resolve, delay));

      const result = await retry();
      if (result !== undefined) {
        return result;
      }
    }

    // Exponential backoff for server errors
    if (error.isServerError()) {
      const attempt = config._retryAttempt || 0;

      if (attempt < 3) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));

        const result = await retry({
          _retryAttempt: attempt + 1,
        });

        if (result !== undefined) {
          return result;
        }
      }
    }

    throw error;
  },

  endpoints: {
    users: { path: '/users' },
  },
});
```

## Response & Error Mappers

Transform data at any configuration level:

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',

  // Global mapper - applies to all responses
  responseMapper: (data) => {
    console.log('Transforming response');
    return data;
  },

  // Global error mapper
  errorMapper: (error) => {
    if (error.status === 404) {
      error.userMessage = 'Item not found';
    }
    return error;
  },

  endpoints: {
    users: {
      path: '/users',

      // Endpoint-level mapper
      responseMapper: (data) => {
        return Array.isArray(data) ? data : data.users || [];
      },

      methods: {
        get: {
          // Method-level mapper
          responseMapper: (users) => {
            return users.filter((u) => u.active);
          },
        },

        post: {
          // Don't inherit parent mappers
          inheritMappers: false,
          responseMapper: (response) => {
            return { id: response.id, success: true };
          },
        },
      },
    },
  },
});

// Request-level mapper
const users = await client
  .get('users')
  .settings({
    responseMapper: (users) => users.slice(0, 10),
  })
  .send();
```

## Caching

### Simple Cache

Time-based caching:

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',
  cache: {
    enabled: true,
    ttl: 60000, // 1 minute
    strategy: 'simple',
  },
  endpoints: {
    users: {
      path: '/users',
      methods: {
        get: {
          cache: { enabled: true, ttl: 300000 }, // 5 minutes
        },
      },
    },
  },
});

// First call hits server
const users1 = await client.get('users').send();

// Second call returns cached data
const users2 = await client.get('users').send();

// Force fresh data
const fresh = await client
  .get('users')
  .settings({ cache: { enabled: false } })
  .send();

// Clear cache
await client.clearCache();
```

### Stale-While-Revalidate

Return cached data immediately while fetching fresh data:

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',
  cache: {
    enabled: true,
    strategy: 'swr',
    ttl: 30000,
  },
  endpoints: {
    dashboard: {
      path: '/dashboard',
      methods: {
        get: {
          cache: {
            enabled: true,
            strategy: 'swr',
          },
          onRevalidate: (freshData) => {
            // Called when fresh data arrives
            console.log('Fresh data:', freshData);
            updateUI(freshData);
          },
        },
      },
    },
  },
});

// Returns stale data immediately, fetches fresh in background
const data = await client.get('dashboard').send();
```

## Advanced Features

### Request Cancellation

```javascript
// Cancel a single request
const request = client.get('large-dataset');
const promise = request.send();

setTimeout(() => {
  request.cancel('Taking too long');
}, 2000);

try {
  const data = await promise;
} catch (error) {
  if (error.type === VortexError.TYPES.ABORT) {
    console.log('Request cancelled');
  }
}
```

### Progress Tracking

```javascript
// Upload progress
await client
  .post('upload')
  .body(formData)
  .settings({
    onUploadProgress: (progress) => {
      const percent = Math.round(progress.progress * 100);
      console.log(`Upload: ${percent}%`);
      progressBar.value = percent;
    },
  })
  .send();

// Download progress
await client
  .get('download')
  .settings({
    responseType: 'blob',
    onDownloadProgress: (progress) => {
      const percent = Math.round(progress.progress * 100);
      console.log(`Download: ${percent}%`);
    },
  })
  .send();
```

### Parallel Requests

```javascript
// Parallel with Promise.all
const [users, posts] = await Promise.all([client.get('users').send(), client.get('posts').send()]);

// Parallel with error handling
const results = await Promise.allSettled([
  client.get('users').send(),
  client.get('posts').send(),
  client.get('comments').send(),
]);

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    console.log(`Request ${index} succeeded:`, result.value);
  } else {
    console.log(`Request ${index} failed:`, result.reason);
  }
});
```

### Custom Validation

```javascript
const client = createVortexClient({
  baseURL: 'https://api.example.com',

  // Default validation
  validateStatus: (status) => status >= 200 && status < 300,

  endpoints: {
    flexible: {
      path: '/flexible',
      // Accept more status codes
      validateStatus: (status) => status < 500,
    },
  },
});

// Request-level validation
await client
  .get('api')
  .settings({
    validateStatus: (status) => {
      // Accept 304 Not Modified
      return status === 304 || (status >= 200 && status < 300);
    },
  })
  .send();
```

### Response Types

```javascript
// JSON (default)
const json = await client.get('data').send();

// Text
const html = await client.get('page').settings({ responseType: 'text' }).send();

// Blob
const image = await client.get('image').settings({ responseType: 'blob' }).send();

// ArrayBuffer
const buffer = await client.get('binary').settings({ responseType: 'arrayBuffer' }).send();

// FormData
const form = await client.get('form').settings({ responseType: 'formData' }).send();
```

## API Reference

### `createVortexClient(config)`

Creates a new Vortex client.

### `client.get/post/put/patch/delete(endpoint)`

Create a request builder for the endpoint.

### `client.request(method, endpoint)`

Create a request with custom HTTP method.

### `RequestBuilder.pathParams(params)`

Set path parameters.

### `RequestBuilder.search(params)`

Set query parameters.

### `RequestBuilder.body(data)`

Set request body.

### `RequestBuilder.settings(settings)`

Override request settings.

### `RequestBuilder.cancel(message?)`

Cancel the request.

### `RequestBuilder.send()`

Execute the request.

### `client.withConfig(config)`

Create new client with merged config.

### `client.clearCache()`

Clear all cached responses.

### `client.getCacheStats()`

Get cache statistics.

### `client.destroy()`

Clean up resources.

## Complete Example

```javascript
import { createVortexClient, VortexError } from '@vorthain/vortex';

// Centralized endpoint names
const API_ENDPOINTS = {
  USERS: 'users',
  USER: 'user',
  POSTS: 'posts',
  UPLOAD: 'upload',
};

const api = createVortexClient({
  baseURL: 'https://api.example.com',
  timeout: 30000,

  requestInterceptor: async (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },

  errorInterceptor: async (error, config, retry) => {
    if (error.status === 401) {
      const newToken = await refreshToken();
      localStorage.setItem('token', newToken);

      return await retry({
        headers: { Authorization: `Bearer ${newToken}` },
      });
    }

    if (error.isServerError() && config._attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000));
      return await retry({ _attempt: (config._attempt || 0) + 1 });
    }

    throw error;
  },

  cache: {
    enabled: true,
    strategy: 'swr',
    ttl: 60000,
  },

  endpoints: {
    [API_ENDPOINTS.USERS]: {
      path: '/users',
      methods: {
        get: { cache: { ttl: 300000 } },
      },
    },
    [API_ENDPOINTS.USER]: { path: '/users/:id' },
    [API_ENDPOINTS.POSTS]: { path: '/posts' },
    [API_ENDPOINTS.UPLOAD]: {
      path: '/upload',
      methods: {
        post: { timeout: 120000 },
      },
    },
  },
});

// Use it
async function getUser(id) {
  try {
    return await api.get(API_ENDPOINTS.USER).pathParams({ id }).send();
  } catch (error) {
    if (error.hasStatus(404)) {
      console.log('User not found');
      return null;
    }
    console.error('Error fetching user:', error.message);
    return null;
  }
}

async function createPost(data) {
  return await api
    .post(API_ENDPOINTS.POSTS)
    .body(data)
    .settings({
      onStart: () => {
        console.log('Creating post...');
        showLoader();
      },
      onSuccess: (post) => {
        console.log('Post created successfully:', post);
        showSuccessNotification('Post created!');
      },
      onError: (error) => {
        console.error('Failed to create post:', error.message);
        showErrorNotification(error.message);
      },
      onFinally: () => {
        console.log('Create post request completed');
        hideLoader();
      },
    })
    .send();
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  return await api
    .post(API_ENDPOINTS.UPLOAD)
    .body(formData)
    .settings({
      onStart: () => {
        console.log('Upload started');
        showUploadModal();
      },
      onUploadProgress: (progress) => {
        const percent = Math.round(progress.progress * 100);
        updateProgressBar(percent);
      },
      onSuccess: (result) => {
        console.log('Upload successful:', result);
        showSuccessMessage('File uploaded!');
      },
      onError: (error) => {
        console.error('Upload failed:', error.message);
        showErrorMessage('Upload failed: ' + error.message);
      },
      onFinally: () => {
        hideUploadModal();
      },
    })
    .send();
}
```
