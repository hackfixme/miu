class Store {
  constructor(name, initialState = {}) {
    if (typeof name !== 'string') {
      throw new Error('Store name must be a string');
    }

    this._name = name;
    this._listeners = new Map();
    this.state = this._createProxy(initialState);

    // Expose some internal properties using a wrapper Proxy.
    const wrapper = {
      _get: this._getValueByPath.bind(this),
      _set: this._setValueByPath.bind(this),
      _name: this._name,
      subscribe: this.subscribe.bind(this)
    };

    return new Proxy(wrapper, {
      get: (target, prop) => {
        return target[prop] ?? this.state[prop];
      },
      set: (_, prop, value) => {
        this.state[prop] = value;
        return true;
      }
    });
  }

  subscribe(path, callback) {
    if (!this._listeners.has(path)) {
      this._listeners.set(path, new Set());
    }
    this._listeners.get(path).add(callback);

    return () => {
      this._listeners.get(path).delete(callback);
      if (this._listeners.get(path).size === 0) {
        this._listeners.delete(path);
      }
    };
  }

  _createProxy(obj, path = '') {
    // Handle primitive values
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const handler = {
      get: (target, prop) => {
        const value = target[prop];

        // Handle getters
        if (typeof value === 'function' && value.constructor.name === 'get') {
          return value.call(this.state);
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
              this._notifyListeners(path, target);
              if (prop === 'set') {
                // Notify for specific key changes
                const [key] = args;
                this._notifyListeners(`${path}[${key}]`, args[1]);
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
              this._notifyListeners(path, target);
            }
            return result;
          };
        }

        // Handle Map/Object key access with brackets notation
        if (target instanceof Map && prop === 'get') {
          return (key) => {
            const value = target.get(key);
            return typeof value === 'object' && value !== null
              ? this._createProxy(value, `${path}[${key}]`)
              : value;
          };
        }

        // Recursively create proxies for nested objects
        if (typeof value === 'object' && value !== null) {
          return this._createProxy(value, newPath);
        }

        return value;
      },

      set: (target, prop, value) => {
        const newPath = path ? `${path}.${prop}` : prop;
        target[prop] = value;

        if (Array.isArray(target) && prop === 'length') {
          this._notifyListeners(path, target);
        } else {
          this._notifyListeners(newPath, value);
          // Notify parent for array/object/map changes
          if (Array.isArray(target) || target instanceof Map || typeof target === 'object') {
            this._notifyListeners(path, target);
          }
        }

        return true;
      }
    };

    return new Proxy(obj, handler);
  }

  _notifyListeners(path, value) {
    // Notify exact path matches
    if (this._listeners.has(path)) {
      this._listeners.get(path).forEach(callback => callback(value));
    }

    // Notify parent paths (e.g., 'user' listeners get notified of 'user.name' changes)
    const parts = path.split('.');
    while (parts.length > 1) {
      parts.pop();
      const parentPath = parts.join('.');
      if (this._listeners.has(parentPath)) {
        const parentValue = this._getValueByPath(parentPath);
        this._listeners.get(parentPath).forEach(callback => callback(parentValue));
      }
    }
  }

  _getValueByPath(path) {
    return path
      .split(/[.\[]/)
      .map(key => key.replace(']', ''))
      .reduce((obj, key) => obj && obj[key], this.state);
  }

  _setValueByPath(path, value) {
    const parts = path.split(/[.\[]/).map(key => key.replace(']', ''));
    const lastKey = parts.pop();
    const target = parts.reduce((obj, key) => obj && obj[key], this.state);

    if (target) {
      target[lastKey] = value;
    }
  }
}

// Global map of store name to Store instance.
const stores = new Map();

export { Store, stores };
