import { deepCopy } from './util.js';

class Store {
  constructor(name, initialState = {}) {
    if (typeof name !== 'string') {
      throw new Error('Store name must be a string');
    }

    const listeners = new Map();
    const state = this._createState(initialState, listeners);
    const api = this._createAPI(state, listeners);
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
          return false;
        }
        state[prop] = value;
        return true;
      }
    });
  }

  _createAPI(state, listeners) {
    const getValueByPath = (path) => {
      return path
        .split(/[.\[]/)
        .map(key => key.replace(']', ''))
        .reduce((obj, key) => obj && obj[key], state);
    };

    const setValueByPath = (path, value) => {
      const parts = path.split(/[.\[]/).map(key => key.replace(']', ''));
      const lastKey = parts.pop();
      const target = parts.reduce((obj, key) => obj && obj[key], state);

      if (target) {
        target[lastKey] = value;
      }
    };

    const subscribe = (path, callback) => {
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
    };

    return {
      $get: getValueByPath,
      $set: setValueByPath,
      $subscribe: subscribe,
      get $data() { return deepCopy(state); }
    };
  }

  _createState(initialState, listeners) {
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
          const parentValue = this._getValueByPath(parentPath);
          listeners.get(parentPath).forEach(callback => callback(parentValue));
        }
      }
    };

    const createProxy = (obj, path = '') => {
      // Handle primitive values
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      const handler = {
        get: (target, prop) => {
          const value = target[prop];

          // Handle getters
          if (typeof value === 'function' && value.constructor.name === 'get') {
            return value.call(state);
          }

          // Handle Symbol properties
          if (typeof prop === 'symbol') {
            return value;
          }

          const newPath = path ? `${path}.${prop}` : prop;

          // Handle Map methods
          if (target instanceof Map && typeof value === 'function') {
            return (...args) => {
              const result = value.apply(target, args);

              // Notify on Map mutations
              if (['set', 'delete', 'clear'].includes(prop)) {
                notifyListeners(path, target);
                if (prop === 'set') {
                  // Notify for specific key changes
                  const [key] = args;
                  notifyListeners(`${path}[${key}]`, args[1]);
                }
              }

              return result;
            };
          }

          // Handle array methods
          if (Array.isArray(target) && Array.prototype[prop] && typeof Array.prototype[prop] === 'function') {
            return (...args) => {
              const result = Array.prototype[prop].apply(target, args);
              if (['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
                notifyListeners(path, target);
              }
              return result;
            };
          }

          // Handle Map/Object key access with brackets notation
          if (target instanceof Map && prop === 'get') {
            return (key) => {
              const value = target.get(key);
              return typeof value === 'object' && value !== null
                ? createProxy(value, `${path}[${key}]`)
                : value;
            };
          }

          // Recursively create proxies for nested objects
          if (typeof value === 'object' && value !== null) {
            return createProxy(value, newPath);
          }

          return value;
        },

        set: (target, prop, value) => {
          const newPath = path ? `${path}.${prop}` : prop;
          target[prop] = value;

          if (Array.isArray(target) && prop === 'length') {
            notifyListeners(path, target);
          } else {
            notifyListeners(newPath, value);
            // Notify parent for array/object/map changes
            if (Array.isArray(target) || target instanceof Map || typeof target === 'object') {
              notifyListeners(path, target);
            }
          }

          return true;
        }
      };

      return new Proxy(obj, handler);
    };

    return createProxy(initialState);
  }
}

// Global map of store name to Store instance.
const stores = new Map();

export { Store, stores };
