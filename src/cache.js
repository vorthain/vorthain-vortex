import { VortexError } from './error.js';

/**
 * @typedef {object} CacheEntry
 * @property {any} data - The cached data
 * @property {number} expiry - The expiration timestamp
 * @property {number} createdAt - When the entry was created
 * @property {string} [etag] - Optional ETag for cache validation
 * @property {object} [metadata] - Additional metadata
 */

/**
 * Cache interface that all cache implementations must follow.
 * @interface
 */
export class CacheInterface {
  /**
   * Retrieves an entry from the cache.
   * @param {string} key - The cache key
   * @returns {Promise<any | null>} The cached data or null if not found/expired
   * @abstract
   */
  async get(key) {
    throw new Error('get method must be implemented');
  }

  /**
   * Stores an entry in the cache.
   * @param {string} key - The cache key
   * @param {any} data - The data to cache
   * @param {number} ttl - Time-to-live in milliseconds
   * @param {object} [options={}] - Additional cache options
   * @returns {Promise<void>}
   * @abstract
   */
  async set(key, data, ttl, options = {}) {
    throw new Error('set method must be implemented');
  }

  /**
   * Removes an entry from the cache.
   * @param {string} key - The cache key
   * @returns {Promise<boolean>} True if the key was found and removed
   * @abstract
   */
  async delete(key) {
    throw new Error('delete method must be implemented');
  }

  /**
   * Checks if a key exists in the cache (without returning the value).
   * @param {string} key - The cache key
   * @returns {Promise<boolean>} True if the key exists and is not expired
   * @abstract
   */
  async has(key) {
    throw new Error('has method must be implemented');
  }

  /**
   * Clears all entries from the cache.
   * @returns {Promise<void>}
   * @abstract
   */
  async clear() {
    throw new Error('clear method must be implemented');
  }

  /**
   * Gets cache statistics (optional).
   * @returns {Promise<object>} Cache statistics
   * @abstract
   */
  async stats() {
    return {
      hits: 0,
      misses: 0,
      size: 0,
      maxSize: Infinity,
    };
  }
}

/**
 * A simple, synchronous, in-memory cache with TTL (Time To Live).
 * This is the default cache instance used by the client if no custom instance is provided.
 * @class
 * @extends CacheInterface
 */
export class SimpleCache extends CacheInterface {
  /**
   * Creates a new SimpleCache instance.
   * @param {object} [options={}] - Cache configuration options
   * @param {number} [options.maxSize=1000] - Maximum number of entries to store
   * @param {number} [options.cleanupInterval=300000] - Cleanup interval in milliseconds (5 minutes)
   * @param {boolean} [options.enableStats=false] - Whether to track cache statistics
   */
  constructor({ maxSize = 1000, cleanupInterval = 300000, enableStats = false } = {}) {
    super();

    /** @private */
    this.cache = new Map();

    /** @private */
    this.maxSize = maxSize;

    /** @private */
    this.enableStats = enableStats;

    /** @private */
    this.statistics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
    };

    // Set up periodic cleanup of expired entries
    /** @private */
    this.cleanupInterval = null;

    if (cleanupInterval > 0) {
      // Use unref() if available (Node.js) to prevent the timer from keeping the process alive
      this.cleanupInterval = setInterval(() => {
        this._cleanup();
      }, cleanupInterval);

      // In Node.js environments, allow the process to exit even if this timer is active
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Retrieves an entry from the cache.
   * @param {string} key - The cache key
   * @returns {Promise<any | null>} The cached data or null if not found/expired
   */
  async get(key) {
    try {
      const entry = this.cache.get(key);

      if (!entry) {
        this._incrementStat('misses');
        return null;
      }

      // Check if entry has expired
      if (entry.expiry < Date.now()) {
        this.cache.delete(key);
        this._incrementStat('misses');
        return null;
      }

      this._incrementStat('hits');
      return entry.data;
    } catch (error) {
      throw VortexError.fromError(error, VortexError.TYPES.CACHE);
    }
  }

  /**
   * Stores an entry in the cache.
   * @param {string} key - The cache key
   * @param {any} data - The data to cache
   * @param {number} ttl - Time-to-live in milliseconds
   * @param {object} [options={}] - Additional cache options
   * @param {string} [options.etag] - ETag for cache validation
   * @param {object} [options.metadata] - Additional metadata
   * @returns {Promise<void>}
   */
  async set(key, data, ttl, options = {}) {
    try {
      const now = Date.now();
      const expiry = now + ttl;

      const entry = {
        data,
        expiry,
        createdAt: now,
        etag: options.etag,
        metadata: options.metadata,
      };

      // Evict entries if we're at capacity
      if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
        this._evictOldest();
      }

      this.cache.set(key, entry);
      this._incrementStat('sets');
    } catch (error) {
      throw VortexError.fromError(error, VortexError.TYPES.CACHE);
    }
  }

  /**
   * Removes an entry from the cache.
   * @param {string} key - The cache key
   * @returns {Promise<boolean>} True if the key was found and removed
   */
  async delete(key) {
    try {
      const existed = this.cache.delete(key);
      if (existed) {
        this._incrementStat('deletes');
      }
      return existed;
    } catch (error) {
      throw VortexError.fromError(error, VortexError.TYPES.CACHE);
    }
  }

  /**
   * Checks if a key exists in the cache (without returning the value).
   * @param {string} key - The cache key
   * @returns {Promise<boolean>} True if the key exists and is not expired
   */
  async has(key) {
    try {
      const entry = this.cache.get(key);
      if (!entry) return false;

      if (entry.expiry < Date.now()) {
        this.cache.delete(key);
        return false;
      }

      return true;
    } catch (error) {
      throw VortexError.fromError(error, VortexError.TYPES.CACHE);
    }
  }

  /**
   * Clears all entries from the cache.
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      this.cache.clear();
      if (this.enableStats) {
        // Reset stats except for cumulative counters
        this.statistics.hits = 0;
        this.statistics.misses = 0;
      }
    } catch (error) {
      throw VortexError.fromError(error, VortexError.TYPES.CACHE);
    }
  }

  /**
   * Gets cache statistics.
   * @returns {Promise<object>} Cache statistics
   */
  async stats() {
    return {
      ...this.statistics,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate:
        this.statistics.hits + this.statistics.misses > 0
          ? this.statistics.hits / (this.statistics.hits + this.statistics.misses)
          : 0,
    };
  }

  /**
   * Manually triggers cleanup of expired entries.
   * @returns {Promise<number>} Number of entries cleaned up
   */
  async cleanup() {
    return this._cleanup();
  }

  /**
   * Destroys the cache and cleans up resources.
   * @returns {Promise<void>}
   */
  async destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    await this.clear();
  }

  /**
   * Removes expired entries from the cache.
   * @private
   * @returns {number} Number of entries cleaned up
   */
  _cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Evicts the oldest entry to make space for new ones.
   * @private
   */
  _evictOldest() {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      this._incrementStat('evictions');
    }
  }

  /**
   * Increments a statistic counter if stats are enabled.
   * @private
   * @param {string} stat - The statistic to increment
   */
  _incrementStat(stat) {
    if (this.enableStats && this.statistics.hasOwnProperty(stat)) {
      this.statistics[stat]++;
    }
  }
}

/**
 * A no-operation cache that doesn't store anything.
 * Useful for disabling caching without changing code structure.
 * @class
 * @extends CacheInterface
 */
export class NoOpCache extends CacheInterface {
  async get(key) {
    return null;
  }
  async set(key, data, ttl, options = {}) {
    return;
  }
  async delete(key) {
    return false;
  }
  async has(key) {
    return false;
  }
  async clear() {
    return;
  }
  async stats() {
    return { hits: 0, misses: 0, size: 0, maxSize: 0, hitRate: 0 };
  }
}
