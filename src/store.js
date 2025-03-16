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
      throw new Error('Store name must be a string');
    }

    const listeners = new Map();
    const pathOps = this._createPathOps();
    const state = this._createState(initialState, listeners, pathOps);
    const api = this._createAPI(state, listeners, pathOps);
    api.$name = name;

    return new Proxy(api, {
      get: (target, prop) => {
        if (prop.toString().startsWith('$')) {
          return target[prop];
        }
        return state[prop];
      },
      set: (_, prop, value) => {
        if (prop.toString().startsWith('$')) {
          throw new Error(`'${prop}' is read-only`);
        }
        state[prop] = value;
        return true;
      }
    });
  }

  /**
   * Creates path operation utilities for getting and setting nested values using JSONPath-like syntax
   * @private
   * @returns {{
   *   get: (obj: Object, path: string) => any,
   *   set: (obj: Object, path: string, value: any) => void
   * }}
   */
  _createPathOps() {
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
   * Creates the public API methods for the store
   * @private
   * @param {Object} state - Store state object
   * @param {Map} listeners - Map of path-based subscribers
   * @param {Object} pathOps - Path operation utilities
   * @returns {Object} Store API methods
   */
  _createAPI(state, listeners, pathOps) {
    return {
      $get: (path) => pathOps.get(state, path),
      $set: (path, value) => pathOps.set(state, path, value),
      $subscribe: (path, callback) => {
        if (!listeners.has(path)) {
          listeners.set(path, new Set());
        }
        listeners.get(path).add(callback);

        return () => {
          listeners.get(path).delete(callback);
          if (listeners.get(path).size === 0) {
            listeners.delete(path);
          }
        };
      },
      get $data() { return deepCopy(state); }
    };
  }

  /**
   * Creates a reactive state object with proxy-based tracking
   * @private
   * @param {Object} initialState - Initial state object
   * @param {Map} listeners - Map of path-based subscribers
   * @param {Object} pathOps - Path operation utilities
   * @returns {Proxy} Proxied state object
   */
  _createState(initialState, listeners, pathOps) {
    const notifyListeners = (path, value) => {
      // Notify exact path matches
      if (listeners.has(path)) {
        listeners.get(path).forEach(callback => callback(value));
      }

      // Notify parent paths (e.g., 'user' listeners get notified of 'user.name' changes)
      const parts = path.split('.');
      while (parts.length > 1) {
        parts.pop();
        const parentPath = parts.join('.');
        if (listeners.has(parentPath)) {
          const parentValue = pathOps.get(initialState, parentPath);
          listeners.get(parentPath).forEach(callback => callback(parentValue));
        }
      }
    };

    const handleArrayMethods = (target, prop, path) => {
      return (...args) => {
        const result = Array.prototype[prop].apply(target, args);
        if (['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
          notifyListeners(path, target);
        }
        return result;
      };
    };

    const handleArraySet = (target, prop, value, path) => {
      const index = parseInt(prop, 10);
      if (isNaN(index) || index < 0 || index > target.length-1) {
        throw new Error(`Invalid array index: ${prop}`);
      }

      target[prop] = value;
      const newPath = `${path}[${prop}]`;

      // Notify both the specific element and the array itself
      notifyListeners(newPath, value);
      notifyListeners(path, target);

      return true;
    };

    const handleMap = (target, prop, path) => {
      const mapOperations = {
        // Maintain reactivity for Map.get
        get: (key) => {
          const value = target.get(key);
          return typeof value === 'object' && value !== null
            ? createProxy(value, `${path}[${key}]`)
            : value;
        },

        // Trigger notifications on Map.set
        set: (key, value) => {
          target.set(key, value);
          notifyListeners(`${path}[${key}]`, value);
          notifyListeners(path, target);
          return target;
        },

        // Trigger notifications on Map.delete
        delete: (key) => {
          const hadKey = target.has(key);
          const result = target.delete(key);
          if (hadKey) {
            notifyListeners(`${path}[${key}]`, undefined);
            notifyListeners(path, target);
          }
          return result;
        },

        // Trigger notifications on Map.clear
        clear: () => {
          const keys = Array.from(target.keys());
          target.clear();
          // Notify all existing entry paths
          keys.forEach(key => notifyListeners(`${path}[${key}]`, undefined));
          // Notify the Map itself
          notifyListeners(path, target);
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

      // Direct property access on Map becomes Map.get()
      return target.get(prop);
    };

    const createProxyHandler = (path) => ({
      get: (target, prop) => {
        const value = target[prop];

        if (typeof value === 'function' && value.constructor.name === 'get') {
          return value.call(target);
        }

        if (typeof prop === 'symbol') {
          return value;
        }

        if (target instanceof Map) {
          return handleMap(target, prop, path);
        }

        if (Array.isArray(target) && Array.prototype[prop] && typeof Array.prototype[prop] === 'function') {
          return handleArrayMethods(target, prop, path);
        }

        const newPath = path ? `${path}.${prop}` : prop;
        // Recursively create proxies for nested objects
        if (typeof value === 'object' && value !== null) {
          return createProxy(value, newPath);
        }

        return value;
      },

      set: (target, prop, value) => {
        if (Array.isArray(target)) {
          return handleArraySet(target, prop, value, path);
        }

        const newPath = path ? `${path}.${prop}` : prop;
        target[prop] = value;
        notifyListeners(newPath, value);

        // Notify parent for object/map changes
        if (target instanceof Map || typeof target === 'object') {
          notifyListeners(path, target);
        }

        return true;
      }
    });

    const createProxy = (obj, path = '') => {
      // Handle primitive values
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      return new Proxy(obj, createProxyHandler(path));
    };

    return createProxy(initialState);
  }
}

// Global map of store name to Store instance.
const stores = new Map();

export { Store, stores };
