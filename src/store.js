import { deepCopy } from './util.js';

/**
 * A reactive state management store that supports nested objects, arrays, and Maps
 * with JSONPath-inspired path access and subscription capabilities.
 *
 * @class Store
 *
 * @property {string} $name - Store identifier
 * @property {function(string): any} $get - Get value at specified path using JSONPath-like syntax
 * @property {function(string, any): void} $set - Set value at specified path using JSONPath-like syntax
 * @property {function(string, function): function} $subscribe - Subscribe to changes at path
 *     Returns an unsubscribe function that can be called to stop listening for changes
 * @property {Object} $data - Deep copy of current state
 *
 * Path notation supports:
 * - Dot notation: 'user.name'
 * - Array/Map indexing: 'users[0]' or 'userMap[userId]'
 *
 * @example
 * const store = new Store('userStore', { user: { name: 'John' } });
 *
 * // Direct property access
 * store.user.name; // 'John'
 *
 * // Path-based access
 * store.$get('user.name'); // 'John'
 * store.$set('settings.theme', 'dark');
 *
 * // Subscriptions
 * const unsubscribe = store.$subscribe('user.name', (value) => console.log(value));
 * store.user.name = 'Jane'; // triggers subscriber
 *
 * // Get raw data copy
 * store.$data; // { user: { name: 'Jane'} }
 */
class Store {
  /**
   * Creates a new Store instance
   * @constructor
   * @param {string} name - Unique identifier for the store
   * @param {Object} [initialState={}] - Initial state object
   * @throws {Error} If name is not a string
   * @returns {Proxy} Proxied store instance with reactive capabilities
   */
  constructor(name, initialState = {}) {
    if (typeof name !== 'string') {
      throw new Error('[miu] Store name must be a string');
    }

    const pathOps = PathOperations.create();
    const subMgr = new SubscriptionManager(initialState, pathOps);
    const proxyMgr = new ProxyManager(
      (path, value) => subMgr.notify(path, value),
    );

    const state = proxyMgr.createProxy(initialState);
    const api = this._createAPI(
      name, state,
      (path, callback) => subMgr.subscribe(path, callback),
      pathOps,
    );

    return new Proxy(api, {
      get: (target, prop) => {
        if (prop.toString().startsWith('$')) {
          return target[prop];
        }
        return state[prop];
      },
      set: (_, prop, value) => {
        if (prop.toString().startsWith('$')) {
          throw new Error(`[miu] '${prop}' is read-only`);
        }
        state[prop] = value;
        return true;
      }
    });
  }

  /**
   * Creates the public API methods for the store
   * @private
   * @param {string} name - Store name
   * @param {Object} state - Store state object
   * @param {function(string, function): function} subscribe - Function to create store subscriptions
   * @param {Object} pathOps - Path operation utilities
   * @returns {Object} Store API methods
   */
  _createAPI(name, state, subscribe, pathOps) {
    return {
      $get: (path) => {
        PathOperations.validatePath(path);
        return pathOps.get(state, path);
      },
      $set: (path, value) => {
        PathOperations.validatePath(path);
        pathOps.set(state, path, value);
      },
      $subscribe: (path, callback) => {
        PathOperations.validatePath(path);
        return subscribe(path, callback);
      },
      get $data() { return deepCopy(state); },
      get $name() { return name; }
    };
  }
}

/**
 * Handles path-based operations and validation for accessing nested state
 * @class
 */
class PathOperations {
  /**
   * Creates path operation utilities for getting and setting nested values
   * @returns {{
   *   get: (obj: Object, path: string) => any,
   *   set: (obj: Object, path: string, value: any) => void
   * }}
   */
  static create() {
    return {
      get: (obj, path) => {
        return path
          .split(/[.\[]/)
          .map(key => key.replace(']', ''))
          .reduce((curr, key) => curr && curr[key], obj);
      },
      set: (obj, path, value) => {
        const parts = path.split(/[.\[]/).map(key => key.replace(']', ''));
        const lastKey = parts.pop();

        // Create intermediate objects if they don't exist while traversing the path
        const target = parts.reduce((curr, key) => {
          if (!curr[key]) {
            curr[key] = {};
          }
          return curr[key];
        }, obj);

        target[lastKey] = value;
      }
    };
  }

  /**
   * Validates path syntax for store operations.
   * Valid paths:
   * - Single property: 'user'
   * - Dot notation: 'user.name', 'user1.name', 'item123.value'
   * - Bracket notation: 'users[0]', 'users[someKey]'
   * - Mixed notation: 'users[0].name', 'user2[0].settings'
   *
   * Invalid paths:
   * - Starting with number: '1user.name'
   * - Containing hyphens: 'users-2.name'
   * - Empty brackets: 'users[]'
   * - Unclosed brackets: 'users[0'
   * - Consecutive dots: 'user..name'
   *
   * @private
   * @param {string} path - Path to validate
   * @throws {Error} If path syntax is invalid
   */
  static validatePath(path) {
    if (typeof path === 'undefined') {
      throw new Error('[miu] path is undefined');
    }
    if (path === '') return;     // Allow empty path for root listeners

    const parts = [
      '^',                       // Start of string
      '(?:[a-zA-Z_$][\\w$]*)',   // First property name: must start with letter/underscore/$ followed by word chars or $
      '(?:',                     // Start non-capturing group for repeating parts
        '\\.[a-zA-Z_$][\\w$]*|', // Dot notation: dot followed by property name
        '\\[[^\\[\\]]+\\]',      // Bracket notation: anything except brackets inside []
      ')*',                      // Zero or more repetitions of dot/bracket parts
      '(?:\.(?:length|size))?',  // optional .length or .size at end
      '$'                        // End of string
    ];

    const pathRegex = new RegExp(parts.join(''));

    if (!pathRegex.test(path)) {
      throw new Error('[miu] Invalid path syntax');
    }
  }
}

/**
 * Manages subscriptions and notifications for state changes
 * @class
 */
class SubscriptionManager {
  /**
   * @param {Object} rootState - Root state object
   * @param {Object} pathOps - Path operation utilities
   */
  constructor(rootState, pathOps) {
    this.pathOps = pathOps;
    this.rootState = rootState;
    this.listeners = new Map();
  }

  /**
   * Subscribes to changes at a specific path
   * @param {string} path - Path to subscribe to
   * @param {function} callback - Callback to invoke on changes
   * @returns {function} Unsubscribe function
   */
  subscribe(path, callback) {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path).add(callback);

    return () => {
      this.listeners.get(path).delete(callback);
      if (this.listeners.get(path).size === 0) {
        this.listeners.delete(path);
      }
    };
  }

  /**
   * Notifies subscribers of state changes
   * @param {string} path - Path where change occurred
   * @param {any} value - New value at path
   */
  notify(path, value) {
    this.notifyRootListeners();
    this.notifyExactPathListeners(path, value);
    this.notifyChildListeners(path);
    this.notifyParentListeners(path);
  }

  /**
   * Notifies subscribers listening to the root state
   */
  notifyRootListeners() {
    if (this.listeners.has('')) {
      this.listeners.get('').forEach(callback => callback(this.rootState));
    }
  }

  /**
   * Notifies subscribers listening to exact path
   * @param {string} path - Path where change occurred
   * @param {any} value - New value at path
   */
  notifyExactPathListeners(path, value) {
    if (this.listeners.has(path)) {
      this.listeners.get(path).forEach(callback => callback(value));
    }
  }

  /**
   * Notifies subscribers listening to child paths
   * E.g. changes to 'user' should notify 'user.name' subscribers.
   * @param {string} path - Parent path where change occurred
   */
  notifyChildListeners(path) {
    // TODO: Optimize this to avoid looping over all listeners.
    for (const [listenerPath, callbacks] of this.listeners) {
      if (listenerPath.startsWith(path + '.')) {
        const childValue = this.pathOps.get(this.rootState, listenerPath);
        callbacks.forEach(callback => callback(childValue));
      }
    }
  }

  /**
   * Notifies subscribers listening to parent paths
   * E.g. changes to 'user.name' should notify 'user' subscribers.
   * @param {string} path - Child path where change occurred
   */
  notifyParentListeners(path) {
    const parts = path.split('.');
    while (parts.length > 1) {
      parts.pop();
      const parentPath = parts.join('.');
      if (this.listeners.has(parentPath)) {
        const parentValue = this.pathOps.get(this.rootState, parentPath);
        this.listeners.get(parentPath).forEach(callback => callback(parentValue));
      }
    }
  }
}

const IS_PROXY = Symbol('isProxy');

/**
 * Check if an object is proxied
 * @param {Object} obj - Object to check
 * @returns {boolean} True if object is proxied
 */
function isProxied(obj) {
  if (obj !== null && typeof obj === 'object') {
    return !!obj[IS_PROXY];
  }
  return false;
}

/**
 * Creates and manages proxy objects for reactive state
 * @class
 */
class ProxyManager {
  /**
   * @param {function(string, any): void} notifyListeners - Callback for state changes
   */
  constructor(notifyListeners) {
    this.notifyListeners = notifyListeners;
  }

  /**
   * Creates a proxy for an object with reactive capabilities
   * @param {Object} obj - Object to make reactive
   * @param {string} [path=''] - Current path in object tree
   * @returns {Proxy|any} Proxied object or original value if not an object
   */
  createProxy(obj, path = '') {
    // Don't proxy primitives or already-proxied objects
    if (obj === null || typeof obj !== 'object' || obj[IS_PROXY]) {
      return obj;
    }

    // Recursively create proxies for all nested values
    if (obj instanceof Map) {
      for (const [key, value] of obj.entries()) {
        obj.set(key, this.createProxy(value, `${path}[${key}]`));
      }
    } else if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        obj[i] = this.createProxy(obj[i], `${path}[${i}]`);
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        obj[key] = this.createProxy(value, path ? `${path}.${key}` : key);
      }
    }

    const proxy = new Proxy(obj, this.createHandler(path));

    // Mark this proxy to prevent double-wrapping
    Object.defineProperty(proxy, IS_PROXY, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    return proxy;
  }

  /**
   * Creates a proxy handler for reactive objects
   * @param {string} path - Current path in object tree
   * @returns {ProxyHandler} Proxy handler object
   * @private
   */
  createHandler(path) {
    return {
      get: (target, prop) => {
        if (prop === '$data') {
          return deepCopy(target);
        }

        if (target instanceof Map) {
          return this.handleMap(target, prop, path);
        }

        if (Array.isArray(target) && Array.prototype[prop] && typeof Array.prototype[prop] === 'function') {
          return this.handleArrayMethods(target, prop, path);
        }

        const value = target[prop];

        if (typeof value === 'function') {
          return value.bind(target);
        }

        return value;
      },

      set: (target, prop, value) => {
        if (Array.isArray(target)) {
          return this.handleArraySet(target, prop, value, path);
        }

        const newPath = path ? `${path}.${prop}` : prop;
        target[prop] = this.createProxy(value, newPath);
        this.notifyListeners(newPath, target[prop]);

        // Only notify parent for Map changes
        if (target instanceof Map) {
          this.notifyListeners(path, target);
        }

        return true;
      },

      deleteProperty: (target, prop) => {
        const exists = prop in target;
        const deleted = delete target[prop];

        if (exists && deleted) {
          const newPath = path ? `${path}.${prop}` : prop;
          this.notifyListeners(newPath, undefined);
        }

        return deleted;
      }
    };
  }

  /**
   * Handles array method interception for reactive updates
   * @param {Array} target - Target array
   * @param {string} prop - Method name
   * @param {string} path - Current path
   * @returns {Function} Wrapped array method
   * @private
   */
  handleArrayMethods(target, prop, path) {
    return (...args) => {
      // Arguments to methods that can add new values to the array must be proxied first.
      if (['push', 'unshift', 'splice', 'fill', 'concat'].includes(prop)) {
        args = args.map(arg => this.createProxy(arg, path));
      }
      const result = Array.prototype[prop].apply(target, args);
      if (['push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'sort', 'reverse',
           'concat', 'copyWithin'].includes(prop)) {
        this.notifyListeners(path, target);
      }
      return result;
    };
  }

  /**
   * Handles array index assignments and length changes
   * @param {Array} target - Target array
   * @param {string|number} prop - Array index or 'length'
   * @param {any} value - Value to set
   * @param {string} path - Current path
   * @returns {boolean} Success status
   * @private
   */
  handleArraySet(target, prop, value, path) {
    if (prop === 'length') {
      target.length = value;
      this.notifyListeners(path, target);
      return true;
    }

    const index = parseInt(prop, 10);
    if (isNaN(index) || index < 0 || index > target.length-1) {
      throw new Error(`[miu] Invalid array index: ${prop}`);
    }

    const newPath = `${path}[${prop}]`;
    target[prop] = this.createProxy(value, newPath);

    // Notify both the specific element and the array itself
    this.notifyListeners(newPath, target[prop]);
    this.notifyListeners(path, target);

    return true;
  }

  /**
   * Handles Map operations for reactive updates
   * @param {Map} target - Target Map
   * @param {string} prop - Method or key name
   * @param {string} path - Current path
   * @returns {Function|any} Map method or value
   * @private
   */
  handleMap(target, prop, path) {
    const mapOperations = {
      get: (key) => target.get(key),

      set: (key, value) => {
        target.set(key, this.createProxy(value, `${path}[${key}]`));
        this.notifyListeners(`${path}[${key}]`, target.get(key));
        this.notifyListeners(path, target);
        return target;
      },

      delete: (key) => {
        const hadKey = target.has(key);
        const result = target.delete(key);
        if (hadKey) {
          this.notifyListeners(`${path}[${key}]`, undefined);
          this.notifyListeners(path, target);
        }
        return result;
      },

      clear: () => {
        const keys = Array.from(target.keys());
        target.clear();
        // Notify listeners on all Map keys
        keys.forEach(key => this.notifyListeners(`${path}[${key}]`, undefined));
        // Notify listeners on the Map itself
        this.notifyListeners(path, target);
        return undefined;
      }
    };

    if (prop in mapOperations) {
      return mapOperations[prop];
    }

    // For other built-in methods, bind them to the Map
    if (typeof target[prop] === 'function') {
      return target[prop].bind(target);
    }

    // Return values from own and built-in properties directly
    if (Object.prototype.hasOwnProperty.call(target, prop) ||
        prop in Object.getPrototypeOf(target)) {
      return target[prop];
    }

    // Direct property access on Map becomes Map.get()
    return target.get(prop);
  }
}

export { Store };

export let internals;

// Test-only exports
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
  internals = {
    PathOperations,
    SubscriptionManager,
    ProxyManager,
    isProxied
  };
}
