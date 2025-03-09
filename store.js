export class Store {
  constructor(initialState = {}) {
    this._listeners = new Map();
    return this._createProxy(initialState);
  }

  _createProxy(obj, path = '') {
    // Handle primitive values
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const handler = {
      get: (target, prop) => {
        // Handle getters
        const value = target[prop];
        if (typeof value === 'function' && value.constructor.name === 'get') {
          return value.call(this);
        }

        const newPath = path ? `${path}.${prop}` : prop;

        // Recursively create proxies for nested objects
        if (typeof value === 'object' && value !== null) {
          return this._createProxy(value, newPath);
        }

        return value;
      },

      set: (target, prop, value) => {
        const newPath = path ? `${path}.${prop}` : prop;
        target[prop] = value;
        this._notifyListeners(newPath, value);
        return true;
      }
    };

    return new Proxy(obj, handler);
  }

  _notifyListeners(path, value) {
    console.log(`State changed: ${path} = ${value}`);
  }
}
