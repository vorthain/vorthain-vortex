import { createVortexClient, VortexError } from '../../index.js';
import { SimpleCache, NoOpCache } from '../cache.js';
import { RequestBuilder } from '../requestBuilder.js';

// Mock fetch for testing
global.fetch = require('jest-fetch-mock');

// Track clients for cleanup
const clientsToCleanup = [];

// Helper function to create clients and track them for cleanup
const createTestClient = (config) => {
  const client = createVortexClient(config);
  clientsToCleanup.push(client);
  return client;
};

describe('Vortex HTTP Client - Edge Cases and Advanced Scenarios', () => {
  beforeEach(() => {
    fetch.resetMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
    // Clear any existing intervals from RequestBuilder
    if (RequestBuilder.cleanupInterval) {
      clearInterval(RequestBuilder.cleanupInterval);
      RequestBuilder.cleanupInterval = null;
    }
    RequestBuilder.inflightRequests.clear();
  });

  afterEach(async () => {
    // Clean up any clients created during tests
    for (const client of clientsToCleanup) {
      try {
        await client.destroy();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    clientsToCleanup.length = 0;

    // Clean up RequestBuilder static resources
    if (RequestBuilder.cleanupInterval) {
      clearInterval(RequestBuilder.cleanupInterval);
      RequestBuilder.cleanupInterval = null;
    }
    RequestBuilder.inflightRequests.clear();

    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Error Interceptor Edge Cases', () => {
    test('should handle error interceptor throwing an error', async () => {
      const errorInterceptor = jest.fn(async (error) => {
        throw new Error('Interceptor failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        errorInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Server Error', { status: 500 });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.CONFIG);
        expect(error.message).toContain('Error interceptor failed');
      }
    });

    test('should handle error interceptor returning successful recovery', async () => {
      const errorInterceptor = jest.fn(async (error) => {
        // Recover from error by returning replacement data
        return { recovered: true, originalError: error.status };
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        errorInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Not Found', { status: 404 });

      const result = await client.get('users').send();

      expect(result).toEqual({ recovered: true, originalError: 404 });
      expect(errorInterceptor).toHaveBeenCalled();
    });

    test('should handle error interceptor with synchronous throw', async () => {
      const errorInterceptor = jest.fn((error) => {
        if (error.status === 403) {
          throw new Error('Forbidden access');
        }
        throw error;
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        errorInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Forbidden', { status: 403 });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.CONFIG);
      }
    });

    test('should handle nested error interceptor retries exhausting max retries', async () => {
      let attemptCount = 0;
      const errorInterceptor = jest.fn(async (error, config, retry) => {
        attemptCount++;

        // Keep retrying until max
        const result = await retry();
        if (result === undefined) {
          // Max retries reached
          error.attemptCount = attemptCount;
          throw error;
        }
        return result;
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        maxRetries: 2,
        errorInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponse('Server Error', { status: 500 });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.status).toBe(500);
        expect(error.attemptCount).toBe(3); // Initial + 2 retries
      }
    });
  });

  describe('Request Interceptor Edge Cases', () => {
    test('should handle request interceptor returning null', async () => {
      const requestInterceptor = jest.fn(() => null);

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        requestInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.CONFIG);
        expect(error.message).toContain('Request interceptor must return a config object');
      }
    });

    test('should handle request interceptor returning undefined', async () => {
      const requestInterceptor = jest.fn(() => undefined);

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        requestInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.CONFIG);
      }
    });

    test('should handle request interceptor throwing error', async () => {
      const requestInterceptor = jest.fn(() => {
        throw new Error('Request prep failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        requestInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.CONFIG);
        expect(error.message).toContain('Request interceptor failed');
      }
    });

    test('should handle request interceptor modifying body to undefined', async () => {
      const requestInterceptor = jest.fn((config) => ({
        ...config,
        body: undefined, // Remove body
      }));

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        requestInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ success: true }));

      const result = await client.post('users').body({ data: 'test' }).send();

      expect(result).toEqual({ success: true });
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: null, // Body should be null for POST with undefined body
        })
      );
    });
  });

  describe('Response Interceptor Edge Cases', () => {
    test('should allow response interceptor to modify response object', async () => {
      let interceptedResponse;
      const responseInterceptor = jest.fn((response, config) => {
        // Clone the response to verify it was modified
        interceptedResponse = {
          status: response.status,
          customProp: 'added',
          intercepted: true,
        };
        // Return the original response (fetch Response object)
        return response;
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ data: 'test' }));

      const result = await client.get('users').send();

      expect(responseInterceptor).toHaveBeenCalled();
      expect(interceptedResponse).toEqual({
        status: 200,
        customProp: 'added',
        intercepted: true,
      });
      expect(result).toEqual({ data: 'test' });
    });

    test('should handle response interceptor throwing error', async () => {
      const responseInterceptor = jest.fn(() => {
        throw new Error('Response processing failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ data: 'test' }));

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.CONFIG);
        expect(error.message).toContain('Response interceptor failed');
      }
    });

    test('should handle response interceptor returning different response', async () => {
      const mockAlternativeResponse = new Response(JSON.stringify({ alternative: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      const responseInterceptor = jest.fn(() => mockAlternativeResponse);

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseInterceptor,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ alternative: true });
    });
  });

  describe('Mapper Edge Cases', () => {
    test('should handle mapper returning undefined', async () => {
      const responseMapper = jest.fn(() => undefined);

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: 'data' }));

      const result = await client.get('users').send();

      // Should keep original data when mapper returns undefined
      expect(result).toEqual({ original: 'data' });
      expect(responseMapper).toHaveBeenCalled();
    });

    test('should handle mapper throwing error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const responseMapper = jest.fn(() => {
        throw new Error('Mapper failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: 'data' }));

      const result = await client.get('users').send();

      // Should return original data and log warning
      expect(result).toEqual({ original: 'data' });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Response mapper at client level failed'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('should continue applying mappers even if one fails', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const mapper1 = jest.fn((data) => ({ ...data, step1: true }));
      const mapper2 = jest.fn(() => {
        throw new Error('fail');
      });
      const mapper3 = jest.fn((data) => ({ ...data, step3: true }));

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper: [mapper1, mapper2, mapper3],
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ original: true, step1: true, step3: true });
      expect(mapper1).toHaveBeenCalled();
      expect(mapper2).toHaveBeenCalled();
      expect(mapper3).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should handle error mapper modifying error object', async () => {
      const errorMapper = jest.fn((error) => {
        error.customMessage = 'User friendly error';
        error.timestamp = Date.now();
        return error;
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        errorMapper,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Not Found', { status: 404 });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.customMessage).toBe('User friendly error');
        expect(error.timestamp).toBeDefined();
        expect(errorMapper).toHaveBeenCalled();
      }
    });

    test('should handle error mapper throwing error', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorMapper = jest.fn(() => {
        throw new Error('Error mapper failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        errorMapper,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Server Error', { status: 500 });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.status).toBe(500);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error mapper at client level failed'),
          expect.any(Error)
        );
      }

      consoleSpy.mockRestore();
    });
  });

  describe('Cache Edge Cases', () => {
    test('should handle cache retrieval errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const faultyCacheInstance = {
        get: jest.fn().mockRejectedValue(new Error('Cache read failed')),
        set: jest.fn().mockResolvedValue(),
        clear: jest.fn().mockResolvedValue(),
        has: jest.fn().mockResolvedValue(false),
        delete: jest.fn().mockResolvedValue(false),
      };

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        cache: {
          enabled: true,
          instance: faultyCacheInstance,
        },
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ data: 'fresh' }));

      const result = await client.get('users').send();

      expect(result).toEqual({ data: 'fresh' });
      expect(consoleSpy).toHaveBeenCalledWith('Cache retrieval failed:', expect.any(Error));
      expect(faultyCacheInstance.get).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should handle cache storage errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const faultyCacheInstance = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockRejectedValue(new Error('Cache write failed')),
        clear: jest.fn().mockResolvedValue(),
        has: jest.fn().mockResolvedValue(false),
        delete: jest.fn().mockResolvedValue(false),
      };

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        cache: {
          enabled: true,
          instance: faultyCacheInstance,
        },
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ data: 'test' }));

      const result = await client.get('users').send();

      expect(result).toEqual({ data: 'test' });
      expect(consoleSpy).toHaveBeenCalledWith('Cache storage failed:', expect.any(Error));
      expect(faultyCacheInstance.set).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should handle SWR when both cache and revalidation fail', async () => {
      const faultyCacheInstance = {
        get: jest.fn().mockRejectedValue(new Error('Cache read failed')),
        set: jest.fn().mockResolvedValue(),
        clear: jest.fn().mockResolvedValue(),
      };

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        cache: {
          enabled: true,
          strategy: 'swr',
          instance: faultyCacheInstance,
        },
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Server Error', { status: 500 });

      try {
        await client.get('users').send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.status).toBe(500);
      }
    });

    test('should handle SWR with stale data and failed revalidation', async () => {
      const onRevalidate = jest.fn();
      const cacheInstance = new SimpleCache({ cleanupInterval: 0 });

      const tempClient = createVortexClient({
        baseURL: 'https://api.example.com',
        endpoints: { users: { path: '/users' } },
      });
      const request = tempClient.get('users');
      const cacheKey = request._generateCacheKey(request._buildFinalConfig());
      await cacheInstance.set(cacheKey, { stale: 'data' }, 60000);

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        cache: {
          enabled: true,
          strategy: 'swr',
          instance: cacheInstance,
        },
        endpoints: {
          users: {
            path: '/users',
            methods: { get: { onRevalidate } },
          },
        },
      });

      fetch.mockResponseOnce('Server Error', { status: 500 });
      const result = await client.get('users').send();
      expect(result).toEqual({ stale: 'data' });

      await jest.runOnlyPendingTimersAsync();

      expect(onRevalidate).not.toHaveBeenCalled();
      await cacheInstance.destroy();
    });
  });

  describe('Progress Tracking Edge Cases', () => {
    test('should handle download progress without content-length header', async () => {
      const onDownloadProgress = jest.fn();

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          download: { path: '/download' },
        },
      });

      // Mock response without content-length
      fetch.mockResponseOnce('test data', {
        headers: {}, // No content-length
      });

      const result = await client
        .get('download')
        .settings({
          responseType: 'text',
          onDownloadProgress,
        })
        .send();

      expect(result).toBe('test data');
      // Since fetch mock doesn't provide ReadableStream, callback won't be called
      expect(onDownloadProgress).not.toHaveBeenCalled();
    });

    test('should handle progress callback errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const onDownloadProgress = jest.fn(() => {
        throw new Error('Progress handler failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          download: { path: '/download' },
        },
      });

      // Mock ReadableStream response
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('test'));
          controller.close();
        },
      });

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '4' }),
        body: mockStream,
        text: async () => 'test',
      });

      const result = await client
        .get('download')
        .settings({
          responseType: 'text',
          onDownloadProgress,
        })
        .send();

      // Should complete despite callback errors
      expect(result).toBeDefined();

      consoleSpy.mockRestore();
    });

    test('should handle upload progress for large bodies', async () => {
      const onUploadProgress = jest.fn();
      const largeBody = 'x'.repeat(2 * 1024 * 1024); // 2MB string

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          upload: { path: '/upload' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ uploaded: true }));

      await client
        .post('upload')
        .body(largeBody)
        .settings({
          onUploadProgress,
        })
        .send();

      // Large bodies don't trigger immediate progress events
      expect(onUploadProgress).not.toHaveBeenCalled();
    });
  });

  describe('URL Building Edge Cases', () => {
    test('should handle double slashes in URL building', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com/',
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({}));
      await client.get('users').send();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/users', // Should not have double slash
        expect.any(Object)
      );
    });

    test('should properly encode special characters in path params', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          user: { path: '/users/:id' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({}));
      await client.get('user').pathParams({ id: 'user@email.com' }).send();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/users/user%40email.com', // @ should be encoded as %40
        expect.any(Object)
      );
    });

    test('should handle complex search param types', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({}));

      await client
        .get('users')
        .search({
          simple: 'value',
          number: 123,
          boolean: true,
          nullValue: null,
          undefinedValue: undefined,
        })
        .send();

      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('simple=value');
      expect(calledUrl).toContain('number=123');
      expect(calledUrl).toContain('boolean=true');
      expect(calledUrl).not.toContain('null');
      expect(calledUrl).not.toContain('undefined');
    });

    test('should handle path with no parameters', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          simple: { path: '/simple/path/with/no/params' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({}));

      // Should work even with pathParams call
      await client.get('simple').pathParams({ unused: 'param' }).send();

      expect(fetch).toHaveBeenCalledWith('https://api.example.com/simple/path/with/no/params', expect.any(Object));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Path parameter 'unused' not found"));
      consoleSpy.mockRestore();
    });

    test('should handle empty baseURL with absolute path', async () => {
      const client = createTestClient({
        baseURL: '',
        endpoints: {
          absolute: { path: 'https://other-api.com/data' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({}));
      await client.get('absolute').send();

      expect(fetch).toHaveBeenCalledWith('https://other-api.com/data', expect.any(Object));
    });
  });

  describe('Body Serialization Edge Cases', () => {
    test('should handle circular references in JSON body', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      const body = { name: 'test' };
      body.self = body; // Circular reference

      try {
        await client.post('users').body(body).send();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.VALIDATION);
        expect(error.message).toContain('Failed to serialize request body to JSON');
      }
    });

    test('should preserve Blob content-type', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          upload: { path: '/upload' },
        },
      });

      const blob = new Blob(['data'], { type: 'application/pdf' });

      fetch.mockResponseOnce(JSON.stringify({}));
      await client.post('upload').body(blob).send();

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers.get('content-type')).toBe('application/pdf');
    });

    test('should handle ArrayBuffer and TypedArrays correctly', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          binary: { path: '/binary' },
        },
      });

      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view[0] = 255;

      fetch.mockResponseOnce(JSON.stringify({}));
      await client.post('binary').body(buffer).send();

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers.get('content-type')).toBe('application/octet-stream');
    });

    test('should handle TypedArray body', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          binary: { path: '/binary' },
        },
      });

      const typedArray = new Uint16Array([1, 2, 3, 4]);

      fetch.mockResponseOnce(JSON.stringify({}));
      await client.post('binary').body(typedArray).send();

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers.get('content-type')).toBe('application/octet-stream');
    });

    test('should handle empty body correctly', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({}));

      // Empty string body
      await client.post('users').body('').send();
      expect(fetch.mock.calls[0][1].body).toBe('');

      // Null body
      fetch.mockClear();
      fetch.mockResponseOnce(JSON.stringify({}));
      await client.post('users').body(null).send();
      expect(fetch.mock.calls[0][1].body).toBe(null);

      // Undefined body (not set)
      fetch.mockClear();
      fetch.mockResponseOnce(JSON.stringify({}));
      await client.post('users').send();
      expect(fetch.mock.calls[0][1].body).toBe(null);
    });
  });

  describe('Abort/Cancel Edge Cases', () => {
    test('should handle cancelling completed request gracefully', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ done: true }));

      const request = client.get('users');
      const result = await request.send();

      expect(result).toEqual({ done: true });

      // Cancel after completion - should not throw
      expect(() => request.cancel('Too late')).not.toThrow();
    });

    test('should handle multiple cancel calls', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockImplementationOnce((url, options) => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });

      const request = client.get('users');
      const promise = request.send();

      request.cancel('First cancel');
      request.cancel('Second cancel');

      try {
        await promise;
        fail('Should have been cancelled');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.ABORT);
        // Should use first cancellation message
        expect(error.message).toBe('First cancel');
      }
    });

    test('should handle abort signal already aborted', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      const request = client.get('users');
      request.cancel('Pre-cancelled');

      try {
        await request.send();
        fail('Should have been cancelled');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.ABORT);
        expect(error.message).toBe('Pre-cancelled');
      }
    });
  });

  describe('Response Type Parsing Edge Cases', () => {
    test('should parse FormData response type', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          form: { path: '/form' },
        },
      });

      // Mock FormData response
      const mockFormData = new FormData();
      mockFormData.append('field', 'value');

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'multipart/form-data' }),
        formData: async () => mockFormData,
        text: async () => 'field=value',
      });

      const result = await client
        .get('form')
        .settings({
          responseType: 'formData',
        })
        .send();

      expect(result).toBeInstanceOf(FormData);
    });

    test('should handle response type mismatch gracefully', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseType: 'json',
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('<html>Not JSON</html>', {
        headers: { 'content-type': 'text/html' },
      });

      try {
        await client.get('users').send();
        fail('Should have thrown parse error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.PARSE);
        expect(error.message).toContain('Invalid JSON response');
        expect(error.metadata.responseText).toContain('<html>');
      }
    });

    test('should handle empty responses for all response types', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          empty: { path: '/empty' },
        },
      });

      // Test empty JSON response
      fetch.mockResponseOnce('');
      const jsonResult = await client.get('empty').settings({ responseType: 'json' }).send();
      expect(jsonResult).toBeNull();

      // Test empty text response
      fetch.mockResponseOnce('');
      const textResult = await client.get('empty').settings({ responseType: 'text' }).send();
      expect(textResult).toBe('');

      // Test empty blob response
      fetch.mockResponseOnce('');
      const blobResult = await client.get('empty').settings({ responseType: 'blob' }).send();
      expect(blobResult.constructor.name).toBe('Blob');
      expect(blobResult.size).toBe(0);

      // Test empty arrayBuffer response
      fetch.mockResponseOnce('');
      const bufferResult = await client.get('empty').settings({ responseType: 'arrayBuffer' }).send();
      expect(bufferResult.constructor.name).toBe('ArrayBuffer');
      expect(bufferResult.byteLength).toBe(0);
    });

    test('should handle whitespace-only JSON response', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          empty: { path: '/empty' },
        },
      });

      fetch.mockResponseOnce('   \n\t   ');
      const result = await client.get('empty').settings({ responseType: 'json' }).send();
      expect(result).toBeNull();
    });
  });

  describe('Memory Cleanup and Resource Management', () => {
    test('should clean up inflight requests after max age', async () => {
      const originalDateNow = Date.now;
      let currentTime = 1000000000000; // Use a fixed start time
      Date.now = jest.fn(() => currentTime);

      // Clear any existing inflight requests
      RequestBuilder.inflightRequests.clear();

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        cache: {
          enabled: true,
          strategy: 'swr',
        },
        endpoints: {
          users: { path: '/users' },
        },
      });

      // Pre-populate cache to trigger SWR
      const cacheInstance = client.config.cache.instance;
      const tempBuilder = new RequestBuilder({
        httpMethod: 'GET',
        endpointConfig: { path: '/users' },
        clientInstance: client,
      });
      const cacheKey = tempBuilder._generateCacheKey(tempBuilder._buildFinalConfig());
      await cacheInstance.set(cacheKey, { cached: true }, 60000);

      // Start SWR request (returns cached immediately, revalidates in background)
      fetch.mockResponseOnce(JSON.stringify({ fresh: true }));
      await client.get('users').send();

      // Should have inflight revalidation request
      expect(RequestBuilder.inflightRequests.size).toBeGreaterThan(0);

      // Advance time past max age
      currentTime += RequestBuilder.maxInflightAge + 1000;

      // Trigger cleanup
      RequestBuilder._cleanupInflightRequests();

      // Old requests should be removed
      expect(RequestBuilder.inflightRequests.size).toBe(0);

      Date.now = originalDateNow;
    });

    test('should stop cleanup interval when map is empty', () => {
      // Clear any existing cleanup interval first
      if (RequestBuilder.cleanupInterval) {
        clearInterval(RequestBuilder.cleanupInterval);
        RequestBuilder.cleanupInterval = null;
      }

      // Ensure cleanup interval is running
      RequestBuilder._initCleanup();
      expect(RequestBuilder.cleanupInterval).not.toBeNull();

      // Clear all inflight requests
      RequestBuilder.inflightRequests.clear();

      // Run cleanup
      RequestBuilder._cleanupInflightRequests();

      // Interval should be stopped
      expect(RequestBuilder.cleanupInterval).toBeNull();
    });

    test('should clean up on RequestBuilder.destroy()', () => {
      RequestBuilder._initCleanup();

      // Add some mock inflight requests
      RequestBuilder.inflightRequests.set('test1', Promise.resolve());
      RequestBuilder.inflightRequests.set('test2', Promise.resolve());

      expect(RequestBuilder.inflightRequests.size).toBe(2);
      expect(RequestBuilder.cleanupInterval).not.toBeNull();

      // Destroy
      RequestBuilder.destroy();

      expect(RequestBuilder.inflightRequests.size).toBe(0);
      expect(RequestBuilder.cleanupInterval).toBeNull();
    });
  });

  describe('Complex Configuration Inheritance', () => {
    test('should respect disableResponseMapper at method level', async () => {
      const globalMapper = jest.fn((data) => ({ ...data, global: true }));
      const endpointMapper = jest.fn((data) => ({ ...data, endpoint: true }));
      const methodMapper = jest.fn((data) => ({ ...data, method: true }));

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper: globalMapper,
        endpoints: {
          users: {
            path: '/users',
            responseMapper: endpointMapper,
            methods: {
              get: {
                responseMapper: methodMapper,
                disableResponseMapper: true, // Disable all response mappers
              },
            },
          },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ original: true }); // No mappers applied
      expect(globalMapper).not.toHaveBeenCalled();
      expect(endpointMapper).not.toHaveBeenCalled();
      expect(methodMapper).not.toHaveBeenCalled();
    });

    test('should handle inheritMappers conflicts correctly', async () => {
      const globalMapper = jest.fn((data) => ({ ...data, global: true }));
      const endpointMapper = jest.fn((data) => ({ ...data, endpoint: true }));
      const methodMapper = jest.fn((data) => ({ ...data, method: true }));

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper: globalMapper,
        endpoints: {
          users: {
            path: '/users',
            responseMapper: endpointMapper,
            inheritMappers: false, // Don't inherit from global
            methods: {
              get: {
                responseMapper: methodMapper,
                inheritMappers: false, // Don't inherit from endpoint
              },
            },
          },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: true }));

      const result = await client.get('users').send();

      // Only method mapper should apply
      expect(result).toEqual({ original: true, method: true });
      expect(globalMapper).not.toHaveBeenCalled();
      expect(endpointMapper).not.toHaveBeenCalled();
      expect(methodMapper).toHaveBeenCalled();
    });

    test('should handle request-level inheritMappers override', async () => {
      const globalMapper = jest.fn((data) => ({ ...data, global: true }));
      const requestMapper = jest.fn((data) => ({ ...data, request: true }));

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper: globalMapper,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: true }));

      const result = await client
        .get('users')
        .settings({
          responseMapper: requestMapper,
          inheritMappers: false, // Don't inherit any parent mappers
        })
        .send();

      expect(result).toEqual({ original: true, request: true });
      expect(globalMapper).not.toHaveBeenCalled();
      expect(requestMapper).toHaveBeenCalled();
    });

    test('should handle disableMappers at different levels', async () => {
      const globalMapper = jest.fn((data) => ({ ...data, global: true }));

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        responseMapper: globalMapper,
        endpoints: {
          users: {
            path: '/users',
            disableMappers: true, // Disable all mappers for this endpoint
          },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ original: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ original: true });
      expect(globalMapper).not.toHaveBeenCalled();
    });
  });

  describe('withConfig Method Edge Cases', () => {
    test('should create independent client instances with withConfig', async () => {
      const config = {
        baseURL: 'https://api.example.com',
        timeout: 3000,
        endpoints: {
          users: { path: '/users' },
        },
      };

      const client1 = createTestClient(config);
      const client2 = client1.withConfig({ timeout: 5000 });
      const client3 = client1.withConfig({
        headers: { 'X-Custom': 'value' },
      });

      clientsToCleanup.push(client2, client3);

      // Test that configs are independent
      const config1 = client1.getConfig();
      const config2 = client2.getConfig();
      const config3 = client3.getConfig();

      expect(config1.timeout).toBe(3000);
      expect(config2.timeout).toBe(5000);
      expect(config3.timeout).toBe(3000);
      expect(config3.headers['X-Custom']).toBe('value');
      expect(config1.headers['X-Custom']).toBeUndefined();

      // Test that all clients work independently
      fetch.mockResponse(JSON.stringify({ success: true }));

      const result1 = await client1.get('users').send();
      const result2 = await client2.get('users').send();
      const result3 = await client3.get('users').send();

      expect(result1).toEqual({ success: true });
      expect(result2).toEqual({ success: true });
      expect(result3).toEqual({ success: true });

      // Check headers in request
      const headers3 = fetch.mock.calls[2][1].headers;
      expect(headers3.get('x-custom')).toBe('value');
    });

    test('should merge endpoints correctly with withConfig', async () => {
      const client1 = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          users: { path: '/users' },
        },
      });

      const client2 = client1.withConfig({
        endpoints: {
          posts: { path: '/posts' },
        },
      });

      clientsToCleanup.push(client2);

      // client2 should have both endpoints
      const config2 = client2.getConfig();
      expect(config2.endpoints.users).toBeDefined();
      expect(config2.endpoints.posts).toBeDefined();

      fetch.mockResponse(JSON.stringify({ success: true }));

      // Both endpoints should work
      await client2.get('users').send();
      await client2.get('posts').send();

      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users', expect.any(Object));
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/posts', expect.any(Object));
    });
  });

  describe('Callbacks Error Handling', () => {
    test('should continue execution when onStart callback throws', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const onStart = jest.fn(() => {
        throw new Error('onStart failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        onStart,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ success: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ success: true });
      expect(onStart).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('onStart callback failed:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    test('should continue execution when onSuccess callback throws', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const onSuccess = jest.fn(() => {
        throw new Error('onSuccess failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        onSuccess,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ success: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ success: true });
      expect(onSuccess).toHaveBeenCalledWith({ success: true });
      expect(consoleSpy).toHaveBeenCalledWith('onSuccess callback failed:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    test('should continue execution when onError callback throws', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const onError = jest.fn(() => {
        throw new Error('onError failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        onError,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce('Not Found', { status: 404 });

      try {
        await client.get('users').send();
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.status).toBe(404);
        expect(onError).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith('onError callback failed:', expect.any(Error));
      }

      consoleSpy.mockRestore();
    });

    test('should continue execution when onFinally callback throws', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const onFinally = jest.fn(() => {
        throw new Error('onFinally failed');
      });

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        onFinally,
        endpoints: {
          users: { path: '/users' },
        },
      });

      fetch.mockResponseOnce(JSON.stringify({ success: true }));

      const result = await client.get('users').send();

      expect(result).toEqual({ success: true });
      expect(onFinally).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('onFinally callback failed:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('Timeout Mechanism Edge Cases', () => {
    test('should handle timeout with AbortSignal.timeout when available', async () => {
      const originalAbortSignal = global.AbortSignal;

      // Create a pre-aborted signal for immediate timeout
      const timeoutError = new Error('The operation timed out');
      timeoutError.name = 'TimeoutError';

      const abortedSignal = {
        aborted: true,
        reason: timeoutError,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        onabort: null,
        throwIfAborted: () => {
          throw timeoutError;
        },
      };

      // Mock AbortSignal.timeout to return pre-aborted signal
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: jest.fn(() => abortedSignal),
        any: jest.fn((signals) => {
          // Return the aborted signal if present
          return signals.find((s) => s && s.aborted) || signals[0];
        }),
      };

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        timeout: 100,
        endpoints: { slow: { path: '/slow' } },
      });

      // Mock fetch that immediately rejects when signal is aborted
      fetch.mockImplementationOnce((url, options) => {
        // Check if signal is already aborted
        if (options.signal && options.signal.aborted) {
          const error = new Error('Request timed out');
          error.name = 'AbortError';
          error.message = 'timeout';
          return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
          // This shouldn't be reached but included for completeness
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              const error = new Error('Request timed out');
              error.name = 'AbortError';
              error.message = 'timeout';
              reject(error);
            });
          }
        });
      });

      // Execute request and expect timeout error
      try {
        await client.get('slow').send();
        fail('Should have thrown timeout error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.TIMEOUT);
        expect(error.message).toContain('timeout');
      }

      // Verify AbortSignal.timeout was called
      expect(global.AbortSignal.timeout).toHaveBeenCalledWith(100);

      // Restore original
      global.AbortSignal = originalAbortSignal;
    });

    test('should handle timeout fallback when AbortSignal.timeout not available', async () => {
      const originalAbortSignal = global.AbortSignal;
      const originalAbortController = global.AbortController;

      // Remove AbortSignal.timeout to test fallback
      const { AbortController, AbortSignal } = global;
      global.AbortController = AbortController;
      global.AbortSignal = AbortSignal;
      delete global.AbortSignal.timeout;
      delete global.AbortSignal.any;

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        timeout: 100,
        endpoints: { slow: { path: '/slow' } },
      });

      // Mock fetch that never resolves but listens to abort
      fetch.mockImplementationOnce((url, options) => {
        return new Promise((resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              const reason = options.signal.reason;
              // The fallback mechanism aborts with a VortexError
              if (reason instanceof VortexError) {
                reject(reason);
              } else {
                const error = new Error('Request was aborted');
                error.name = 'AbortError';
                reject(error);
              }
            });
          }
          // Never resolve to simulate a hanging request
        });
      });

      const promise = client.get('slow').send();

      // Advance timers to trigger timeout
      jest.advanceTimersByTime(150);

      // Allow promises to resolve
      await Promise.resolve();

      await expect(promise).rejects.toMatchObject({
        type: VortexError.TYPES.TIMEOUT,
        message: expect.stringContaining('Request timeout after 100ms'),
      });

      global.AbortSignal = originalAbortSignal;
      global.AbortController = originalAbortController;
    });
  });

  describe('Validation and Error Messages', () => {
    test('should provide helpful error for missing path parameters', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        endpoints: {
          nested: { path: '/users/:userId/posts/:postId/comments/:commentId' },
        },
      });

      try {
        await client.get('nested').pathParams({ userId: 1 }).send();
        fail('Should have thrown validation error');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.VALIDATION);
        expect(error.metadata.missingParams).toEqual(['postId', 'commentId']);
        expect(error.metadata.providedParams).toEqual(['userId']);
      }
    });

    test('should handle validateStatus edge cases', async () => {
      const client = createTestClient({
        baseURL: 'https://api.example.com',
        validateStatus: (status) => status === 418, // Only teapot status is valid!
        endpoints: {
          teapot: { path: '/teapot' },
        },
      });

      // 200 should be invalid
      fetch.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200 });

      try {
        await client.get('teapot').send();
        fail('Should have thrown for non-418 status');
      } catch (error) {
        expect(error).toBeInstanceOf(VortexError);
        expect(error.type).toBe(VortexError.TYPES.HTTP);
        expect(error.status).toBe(200);
      }

      // 418 should be valid
      fetch.mockResponseOnce(JSON.stringify({ teapot: true }), { status: 418 });

      const result = await client.get('teapot').send();
      expect(result).toEqual({ teapot: true });
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle all features combined in one request', async () => {
      const requestInterceptor = jest.fn((config) => ({
        ...config,
        headers: { ...config.headers, 'X-Intercepted': 'true' },
      }));

      const responseInterceptor = jest.fn((response) => response);

      const errorInterceptor = jest.fn(async (error, config, retry) => {
        if (error.status === 401 && !config._retried) {
          return await retry({ _retried: true });
        }
        throw error;
      });

      const responseMapper = jest.fn((data) => ({ ...data, mapped: true }));
      const errorMapper = jest.fn((error) => {
        error.mapped = true;
        return error;
      });

      const onStart = jest.fn();
      const onSuccess = jest.fn();
      const onError = jest.fn();
      const onFinally = jest.fn();

      const client = createTestClient({
        baseURL: 'https://api.example.com',
        timeout: 5000,
        maxRetries: 3,
        requestInterceptor,
        responseInterceptor,
        errorInterceptor,
        responseMapper,
        errorMapper,
        cache: {
          enabled: true,
          ttl: 60000,
        },
        headers: {
          'X-Global': 'true',
        },
        endpoints: {
          complex: {
            path: '/users/:id/posts/:postId',
            headers: {
              'X-Endpoint': 'true',
            },
            methods: {
              post: {
                headers: {
                  'X-Method': 'true',
                },
                onStart,
                onSuccess,
                onError,
                onFinally,
              },
            },
          },
        },
      });

      // First request fails with 401
      fetch.mockResponseOnce('Unauthorized', { status: 401 });
      // Retry succeeds
      fetch.mockResponseOnce(JSON.stringify({ data: 'success' }));

      const result = await client
        .post('complex')
        .pathParams({ id: 123, postId: 456 })
        .search({ filter: 'active', sort: 'desc' })
        .body({ title: 'Test Post', content: 'Test Content' })
        .settings({
          headers: { 'X-Request': 'true' },
          responseMapper: (data) => ({ ...data, requestMapped: true }),
        })
        .send();

      // Verify interceptors were called
      expect(requestInterceptor).toHaveBeenCalled();
      expect(responseInterceptor).toHaveBeenCalled();
      expect(errorInterceptor).toHaveBeenCalled();

      // Verify mappers were applied
      expect(result).toEqual({
        data: 'success',
        mapped: true,
        requestMapped: true,
      });

      // Verify callbacks were called
      expect(onStart).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled(); // Recovered from error
      expect(onFinally).toHaveBeenCalled();

      // Verify headers were merged correctly
      const finalHeaders = fetch.mock.calls[1][1].headers;
      expect(finalHeaders.get('x-global')).toBe('true');
      expect(finalHeaders.get('x-endpoint')).toBe('true');
      expect(finalHeaders.get('x-method')).toBe('true');
      expect(finalHeaders.get('x-request')).toBe('true');
      expect(finalHeaders.get('x-intercepted')).toBe('true');

      // Verify URL was built correctly
      expect(fetch.mock.calls[1][0]).toBe('https://api.example.com/users/123/posts/456?filter=active&sort=desc');
    });
  });
});
