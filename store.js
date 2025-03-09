export class Store {
  constructor(initialState = {}) {
    this.state = this._createProxy(initialState);
    this._listeners = new Map();
    return {
      ...this.state,
      subscribe: this.subscribe.bind(this)
    };
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

        const newPath = path ? `${path}.${prop}` : prop;

        // Handle array methods
        if (Array.isArray(target) && Array.prototype[prop] && typeof Array.prototype[prop] === 'function') {
          return (...args) => {
            const result = Array.prototype[prop].apply(target, args);

            // Notify on array mutations
            if (['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
              this._notifyListeners(path, target);
            }

            return result;
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

        // Special handling for array length changes
        if (Array.isArray(target) && prop === 'length') {
          this._notifyListeners(path, target);
        } else {
          this._notifyListeners(newPath, value);
          // Also notify parent if it's an array element change
          if (Array.isArray(target)) {
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
    return path.split('.').reduce((obj, key) => obj[key], this.state);
  }
}
