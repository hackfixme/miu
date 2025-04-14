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
  // A map of Store instances to SubscriptionManager instances. Used for
  // subscription sharing between parent and child Stores.
  static #subManagers = new WeakMap();

  /**
   * Creates a new Store instance
   * @constructor
   * @param {string} name - Unique identifier for the store
   * @param {Object|Store} [initialState={}] - Initial state object.
       If it's an existing Store, its state and subscriptions will be shared.
   * @throws {Error} If name is not a string
   * @returns {Proxy} Proxied store instance with reactive capabilities
   */
  constructor(name, initialState = {}) {
    if (typeof name !== 'string') {
      throw new Error('[miu] Store name must be a string');
    }

    const pathOps = PathOperations.create();
    const state = initialState instanceof Store ? initialState.$state : initialState;
    const subMgr = Store.#subManagers.get(initialState) ?? new SubscriptionManager(pathOps);
    const stateProxy = StateProxy.create(
      state,
      (path, value, rootState) => subMgr.notify(path, value, rootState),
    );

    const api = this._createAPI(
      name,
      stateProxy,
      (path, callback) => subMgr.subscribe(path, callback),
      pathOps,
    );

    const apiProxy = new Proxy(api, {
      get: (target, prop) => {
        if (prop.toString().startsWith('$')) {
          return target[prop];
        }
        return stateProxy[prop];
      },
      set: (_, prop, value) => {
        if (prop.toString().startsWith('$')) {
          throw new Error(`[miu] '${prop}' is read-only`);
        }
        stateProxy[prop] = value;
        return true;
      },
      // Ensures instanceof Store is true
      getPrototypeOf: () => Store.prototype
    });

    Store.#subManagers.set(apiProxy, subMgr);

    return apiProxy;
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
      get $state() { return state; },
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
   * @param {Object} pathOps - Path operation utilities
   */
  constructor(pathOps) {
    this.pathOps = pathOps;
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
   * @param {Proxy} rootState - Root proxy instance containing the complete state tree
   */
  notify(path, value, rootState) {
    this.notifyRootListeners(rootState);
    this.notifyExactPathListeners(path, value);
    this.notifyChildListeners(path, rootState);
    this.notifyParentListeners(path, rootState);
  }

  /**
   * Notifies subscribers listening to the root state
   * @param {Proxy} rootState - Root proxy instance containing the complete state tree
   */
  notifyRootListeners(rootState) {
    if (this.listeners.has('')) {
      this.listeners.get('').forEach(callback => callback(rootState));
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
   * @param {Proxy} rootState - Root proxy instance containing the complete state tree
   */
  notifyChildListeners(path, rootState) {
    // TODO: Optimize this to avoid looping over all listeners.
    for (const [listenerPath, callbacks] of this.listeners) {
      if (listenerPath.startsWith(path + '.')) {
        const childValue = this.pathOps.get(rootState, listenerPath);
        callbacks.forEach(callback => callback(childValue));
      }
    }
  }

  /**
   * Notifies subscribers listening to parent paths
   * E.g. changes to 'user.name' should notify 'user' subscribers.
   * @param {string} path - Child path where change occurred
   * @param {Proxy} rootState - Root proxy instance containing the complete state tree
   */
  notifyParentListeners(path, rootState) {
    const parts = path.split('.');
    while (parts.length > 1) {
      parts.pop();
      const parentPath = parts.join('.');
      if (this.listeners.has(parentPath)) {
        const parentValue = this.pathOps.get(rootState, parentPath);
        this.listeners.get(parentPath).forEach(callback => callback(parentValue));
      }
    }
  }
}

/**
 * A reactive proxy for state management with support for nested objects, arrays, and Maps.
 */
class StateProxy {
  // Symbol to identify StateProxy instances.
  static #isProxy = Symbol('isProxy')

  /**
   * Creates a new StateProxy instance.
   * @param {Object|Array|Map} target - The object to make reactive.
   * @param {function(string, any, Proxy): void} notify - Function to notify subscribers of state changes
   * @param {string} [path=''] - Dot notation path in the state to the current object
   * @param {Proxy} [root=null] - Root proxy instance containing the complete state tree. If null, it indicates that this is the root instance.
   * @returns {Proxy} A proxy wrapper around the target object
   */
  constructor(target, notify, path = '', root = null) {
    this.target = target;
    this.notify = notify;
    this.path = path;
    this.root = root;

    const proxy = new Proxy(target, this);
    Object.defineProperty(proxy, StateProxy.#isProxy, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    this.receiver = proxy;

    if (!root) {
      this.root = proxy;
    }

    return proxy;
  }

  /**
   * Creates a state proxy that recursively wraps a deep copy of an object and
   * its nested properties. The original object remains unchanged.
   * @param {*} obj - The target object to proxy
   * @param {function(string, any, Proxy} notify - Function to notify subscribers of state changes
   * @param {string} [path=''] - Dot notation path in the state to the current object
   * @param {Proxy} [root=null] - Root proxy instance containing the complete state tree. If null, it indicates that this is the root instance.
   * @returns {*} A proxy wrapping a copy of the target object or the original value if not proxyable
   */
  static create(obj, notify, path = '', root = null) {
    if (obj === null || typeof obj !== 'object' ||
        (obj instanceof StateProxy && obj.$path === path)) {
      return obj;
    }

    let target;
    if (obj instanceof Map) {
      target = new Map();
    } else if (Array.isArray(obj)) {
      target = [];
    } else if (obj instanceof Date) {
      target = new Date(obj.valueOf());
    } else if (obj instanceof StateProxy) {
      target = obj.$target;
    } else {
      target = {};
    }

    const proxy = new StateProxy(target, notify, path, root);
    const rootProxy = root ?? proxy;

    // Recursively create proxies for all nested values
    if (obj instanceof Map) {
      for (const [key, value] of obj.entries()) {
        target.set(key, StateProxy.create(value, notify, `${path}[${key}]`, rootProxy));
      }
    } else if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        target[i] = StateProxy.create(obj[i], notify, `${path}[${i}]`, rootProxy);
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        target[key] = StateProxy.create(value, notify, path ? `${path}.${key}` : key, rootProxy);
      }
    }

    return proxy;
  }

  /**
   * Intercepts property access on the proxy.
   * @param {Object|Array|Map} target - The target object
   * @param {string|symbol} prop - The property being accessed
   * @param {Proxy} receiver - The proxy or object derived from it
   * @returns {any} The property value
   */
  get(target, prop, receiver) {
    if (prop === '$data') {
      return deepCopy(target);
    }
    if (prop.toString().startsWith('$')) {
      return this[prop.slice(1)];
    }

    if (target instanceof Map) {
      return this.handleMap(target, prop, this.path);
    }

    if (Array.isArray(target) && Array.prototype[prop] && typeof Array.prototype[prop] === 'function') {
      return this.handleArrayMethods(target, prop, this.path);
    }

    const value = target[prop];

    if (typeof value === 'function') {
      // For methods defined directly on the object (like store methods),
      // bind to the proxy to maintain reactivity. For inherited methods
      // (like built-in Date/Array methods), bind to the target to preserve
      // proper 'this' context and internal slots access.
      return Object.prototype.hasOwnProperty.call(target, prop)
        ? value.bind(receiver)
        : value.bind(target);
    }

    return value;
  }

  /**
   * Intercepts property assignment on the proxy.
   * @param {Object|Array|Map} target - The target object
   * @param {string|symbol} prop - The property being set
   * @param {any} value - The value being assigned
   * @param {Proxy} receiver - The proxy or object derived from it
   * @returns {boolean} Whether the assignment was successful
   */
  set(target, prop, value, receiver) {
    if (prop.toString().startsWith('$')) {
      throw new Error(`[miu] '${prop}' is read-only`);
    }

    if (Array.isArray(target)) {
      return this.handleArraySet(target, prop, value);
    }

    const newPath = this.path ? `${this.path}.${prop}` : prop;
    target[prop] = StateProxy.create(value, this.notify, newPath, receiver.$root);
    this.notify(newPath, target[prop], receiver.$root);

    // Only notify parent for Map changes
    if (target instanceof Map) {
      this.notify(this.path, target, receiver.$root);
    }

    return true;
  }

  /**
   * Intercepts property deletion on the proxy.
   * @param {Object|Array|Map} target - The target object
   * @param {string|symbol} prop - The property being deleted
   * @returns {boolean} Whether the deletion was successful
   */
  deleteProperty(target, prop) {
    if (prop.toString().startsWith('$')) {
      throw new Error(`[miu] '${prop}' is read-only`);
    }

    const exists = prop in target;
    const deleted = delete target[prop];

    if (exists && deleted) {
      const newPath = this.path ? `${this.path}.${prop}` : prop;
      this.notify(newPath, undefined, this.receiver.$root);
    }

    return deleted;
  }

  /**
   * Custom instanceof behavior for proxied objects.
   * Determines whether an object is an instance of this proxy wrapper.
   * Note that instanceof on the original non-proxied object will continue to work.
   * @param {any} instance - The object to test
   * @returns {boolean} True if the object is a proxy created by this wrapper
   */
  static [Symbol.hasInstance](instance) {
    return !!instance && instance[StateProxy.#isProxy];
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
    const self = this;
    const root = this.receiver.$root;
    return (...args) => {
      // Arguments to methods that can add new values to the array must be proxied first.
      if (['push', 'unshift', 'splice', 'fill', 'concat'].includes(prop)) {
        args = args.map(arg => StateProxy.create(arg, self.notify, path, root));
      }
      // TODO: Notify for any removed array elements.
      const result = Array.prototype[prop].apply(target, args);
      if (['push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'sort', 'reverse',
           'concat', 'copyWithin'].includes(prop)) {
        self.notify(path, target, root);
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
  handleArraySet(target, prop, value) {
    if (prop === 'length') {
      const prevLength = target.length;
      target.length = value;
      // Notify any subscribers to elements that were removed.
      for (let i = value; i < prevLength; i++) {
        this.notify(`${this.path}[${i}]`, undefined, this.receiver.$root);
      }
      this.notify(this.path, target, this.receiver.$root);
      return true;
    }

    const index = parseInt(prop, 10);
    if (isNaN(index) || index < 0) {
      throw new Error(`[miu] Invalid array index: ${prop}`);
    }

    const newPath = `${this.path}[${prop}]`;
    target[prop] = StateProxy.create(value, this.notify, newPath, this.receiver.$root);

    // Notify both the specific element and the array itself
    this.notify(newPath, target[prop], this.receiver.$root);
    this.notify(this.path, target, this.receiver.$root);

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
    const root = this.receiver.$root;
    const mapOperations = {
      get: (key) => target.get(key),

      set: (key, value) => {
        target.set(key, StateProxy.create(
          value, this.notify, `${path}[${key}]`, this.receiver.$root,
        ));
        this.notify(`${path}[${key}]`, target.get(key), root);
        this.notify(path, target, root);
        return target;
      },

      delete: (key) => {
        const hadKey = target.has(key);
        const result = target.delete(key);
        if (hadKey) {
          this.notify(`${path}[${key}]`, undefined, root);
          this.notify(path, target, root);
        }
        return result;
      },

      clear: () => {
        const keys = Array.from(target.keys());
        target.clear();
        // Notify listeners on all Map keys
        keys.forEach(key => this.notify(`${path}[${key}]`, undefined, root));
        // Notify listeners on the Map itself
        this.notify(path, target, root);
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
    StateProxy,
  };
}
