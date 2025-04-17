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

    const state = initialState instanceof Store ? initialState.$state : initialState;
    const subMgr = Store.#subManagers.get(state) ?? new SubscriptionManager();
    const stateProxy = StateProxy.create(
      state,
      (value) => subMgr.notify(value),
    );
    Store.#subManagers.set(stateProxy, subMgr);

    const api = this._createAPI(
      name,
      stateProxy,
      (path, callback) => subMgr.subscribe(path, callback),
    );

    return new Proxy(api, {
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
  }

  /**
   * Creates the public API methods for the store
   * @private
   * @param {string} name - Store name
   * @param {Object} state - Store state object
   * @param {function(string, function): function} subscribe - Function to create store subscriptions
   * @returns {Object} Store API methods
   */
  _createAPI(name, state, subscribe) {
    return {
      $get: (path) => {
        Path.validatePath(path);
        return Path.get(state, path);
      },
      $set: (path, value) => {
        Path.validatePath(path);
        Path.set(state, path, value);
      },
      $subscribe: (path, callback) => {
        Path.validatePath(path);
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
class Path {
  /**
   * Gets a value from a nested object using a path string
   * @param {Object} obj - The object to traverse
   * @param {string} path - The path to the value (e.g. "foo.bar[0].baz")
   * @returns {*} The value at the specified path, or undefined if the path doesn't exist
   */
  static get(obj, path) {
    return path
      .split(/[.\[]/)
      .map(key => key.replace(']', ''))
      .reduce((curr, key) => curr && curr[key], obj);
  }

  /**
   * Sets a value in a nested object using a path string
   * @param {Object} obj - The object to modify
   * @param {string} path - The path where the value should be set (e.g. "foo.bar[0].baz")
   * @param {*} value - The value to set at the specified path
   * @returns {void}
   */
  static set(obj, path, value) {
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
   * Creates an instance of SubscriptionManager.
   * @constructor
   */
  constructor() {
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
   * @param {StateProxy|StateValue} value - The new value that was changed
   */
  notify(value) {
    this.notifyRootListeners(value);
    this.notifyExactPathListeners(value);
    this.notifyChildListeners(value);
    this.notifyParentListeners(value);
  }

  /**
   * Notifies subscribers listening to the root state
   * @param {StateProxy|StateValue} value - The new value that was changed
   */
  notifyRootListeners(value) {
    if (this.listeners.has('')) {
      const rootState = value.$root;
      this.listeners.get('').forEach(callback => callback(rootState));
    }
  }

  /**
   * Notifies subscribers listening to exact path
   * @param {StateProxy|StateValue} value - The new value that was changed
   */
  notifyExactPathListeners(value) {
    const path = value.$path;
    if (this.listeners.has(path)) {
      this.listeners.get(path).forEach(callback => callback(value));
    }
  }

  /**
   * Notifies subscribers listening to child paths
   * E.g. changes to 'user' should notify 'user.name' subscribers.
   * @param {StateProxy|StateValue} value - The new value that was changed
   */
  notifyChildListeners(value) {
    // TODO: Optimize this to avoid looping over all listeners.
    const path = value.$path;
    const rootState = value.$root;
    for (const [listenerPath, callbacks] of this.listeners) {
      if (listenerPath.startsWith(path + '.')) {
        const childValue = Path.get(rootState, listenerPath);
        callbacks.forEach(callback => callback(childValue));
      }
    }
  }

  /**
   * Notifies subscribers listening to parent paths
   * E.g. changes to 'user.name' should notify 'user' subscribers.
   * @param {StateProxy|StateValue} value - The new value that was changed
   */
  notifyParentListeners(value) {
    const rootState = value.$root;
    const parts = value.$path.split('.');
    while (parts.length > 1) {
      parts.pop();
      const parentPath = parts.join('.');
      if (this.listeners.has(parentPath)) {
        const parentValue = Path.get(rootState, parentPath);
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
  constructor(value, notify, path = '', root = null) {
    this.value = value;
    this.notify = notify;
    this.path = path;
    this.root = root;

    const proxy = new Proxy(value, this);
    Object.defineProperty(proxy, StateProxy.#isProxy, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    this.proxy = proxy;

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
    if (obj === null || typeof obj !== 'object') {
      return new StateValue(obj, path, root);
    }
    if (obj.$path === path) {
      return obj;
    }
    if (obj instanceof StateValue) {
      return new StateValue(obj.$value, path, root);
    }

    let value;
    if (obj instanceof Map) {
      value = new Map();
    } else if (Array.isArray(obj)) {
      value = [];
    } else if (obj instanceof Date) {
      value = new Date(obj.valueOf());
    } else if (obj instanceof StateProxy) {
      value = obj.$value;
    } else {
      value = {};
    }

    const proxy = new StateProxy(value, notify, path, root);
    const rootProxy = root ?? proxy;

    // Recursively create proxies for all nested values
    if (obj instanceof Map) {
      for (const [key, val] of obj.entries()) {
        value.set(key, StateProxy.create(val, notify, `${path}[${key}]`, rootProxy));
      }
    } else if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        value[i] = StateProxy.create(obj[i], notify, `${path}[${i}]`, rootProxy);
      }
    } else {
      for (const [key, val] of Object.entries(obj)) {
        value[key] = StateProxy.create(val, notify, path ? `${path}.${key}` : key, rootProxy);
      }
    }

    return proxy;
  }

  /**
   * Intercepts property access on the proxy.
   * @param {Object|Array|Map} target - The target object
   * @param {string|symbol} prop - The property being accessed
   * @returns {any} The property value
   */
  get(target, prop) {
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

    if (value instanceof StateValue) {
      return value.$value;
    }

    if (typeof value === 'function') {
      // For methods defined directly on the object (like store methods),
      // bind to the proxy to maintain reactivity. For inherited methods
      // (like built-in Date/Array methods), bind to the target to preserve
      // proper 'this' context and internal slots access.
      return Object.prototype.hasOwnProperty.call(target, prop)
        ? value.bind(this.proxy)
        : value.bind(target);
    }

    return value;
  }

  /**
   * Intercepts property assignment on the proxy.
   * @param {Object|Array|Map} target - The target object
   * @param {string|symbol} prop - The property being set
   * @param {any} value - The value being assigned
   * @returns {boolean} Whether the assignment was successful
   */
  set(target, prop, value) {
    if (prop.toString().startsWith('$')) {
      throw new Error(`[miu] '${prop}' is read-only`);
    }

    if (Array.isArray(target)) {
      return this.handleArraySet(target, prop, value);
    }

    const newPath = this.path ? `${this.path}.${prop}` : prop;
    const newValue = StateProxy.create(value, this.notify, newPath, this.proxy.$root);
    target[prop] = newValue;
    this.notify(newValue);

    // Only notify parent for Map changes
    if (target instanceof Map) {
      this.notify(this.proxy);
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
      const newValue = new StateValue(undefined, newPath, this.proxy.$root);
      this.notify(newValue);
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
    return (...args) => {
      // Arguments to methods that can add new values to the array must be wrapped.
      if (['push', 'unshift', 'splice', 'fill', 'concat'].includes(prop)) {
        args = args.map((arg, i) => {
          // For splice, skip the first two args (start, deleteCount)
          if (prop === 'splice' && i < 2) return arg;
          return StateProxy.create(arg, self.notify, `${path}[${target.length + i}]`, self.proxy.$root);
        });
      }
      // TODO: Notify for any removed array elements.
      const result = Array.prototype[prop].apply(target, args);

      if (['push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'sort', 'reverse',
           'concat', 'copyWithin'].includes(prop)) {
        self.notify(self.proxy);
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

      const [start, end] = value < prevLength
        ? [value, prevLength]  // shrinking
        : [prevLength, value]; // growing

      for (let i = start; i < end; i++) {
        const newPath = `${this.path}[${i}]`;
        const newValue = new StateValue(undefined, newPath, this.proxy.$root);
        this.notify(newValue);
      }

      if (prevLength !== value) {
        this.notify(this.proxy);
      }

      return true;
    }

    const index = parseInt(prop, 10);
    if (isNaN(index) || index < 0) {
      throw new Error(`[miu] Invalid array index: ${prop}`);
    }

    const newPath = `${this.path}[${prop}]`;
    const newValue = StateProxy.create(value, this.notify, newPath, this.proxy.$root);
    target[prop] = newValue;

    // Notify both the specific element and the array itself
    this.notify(newValue);
    this.notify(this.proxy);

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
    const self = this;
    const mapOperations = {
      get: (key) => target.get(key),

      set: (key, value) => {
        const newPath = `${path}[${key}]`;
        const newValue = StateProxy.create(value, self.notify, newPath, self.proxy.$root)
        target.set(key, newValue);
        self.notify(newValue);
        self.notify(self.proxy);
        return target;
      },

      delete: (key) => {
        const hadKey = target.has(key);
        const result = target.delete(key);
        if (hadKey) {
          const value = new StateValue(undefined, `${path}[${key}]`, self.proxy.$root);
          self.notify(value);
          self.notify(self.proxy);
        }
        return result;
      },

      clear: () => {
        const keys = Array.from(target.keys());
        target.clear();
        // Notify listeners on all Map keys
        keys.forEach(key => {
          const value = new StateValue(undefined, `${path}[${key}]`, self.proxy.$root);
          self.notify(value);
        });
        // Notify listeners on the Map itself
        self.notify(self.proxy);
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

/**
 * A wrapper around primitive values in the state tree.
 * @class
 */
class StateValue {
  /**
   * Creates a new state value instance. Its properties align with the
   * StateProxy interface for compatibility reasons.
   * @param {*} value - The value to store
   * @param {string} [path=''] - Path to this value in state tree
   * @param {StateProxy|null} [root=null] - Root state value
   */
  constructor(value, path = '', root = null) {
    this.$value = value;
    this.$path = path;
    this.$root = root;
  }

  /**
   * Returns the primitive value when used in operations
   * @returns {*} The wrapped value
   */
  valueOf() {
    return this.$value;
  }

  /**
   * Returns the string representation of the value
   * @returns {string} String representation
   */
  toString() {
    return String(this.$value);
  }

  /**
   * Converts to primitive value when used in operations
   * @param {string} hint - The type hint
   * @returns {*} The wrapped value
   */
  [Symbol.toPrimitive](hint) {
    return this.$value;
  }
}

/**
 * Creates a deep copy of the provided value, handling objects, arrays, dates and maps.
 * Removes any function references and unwraps StateValue instances.
 * @param {*} obj - The value to deep copy
 * @returns {*} A deep copy of the input value
 */
function deepCopy(obj) {
  if (obj instanceof StateValue) {
    obj = obj.$value;
  }

  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') {
    return typeof obj === 'function' ? undefined : obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.valueOf());
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item));
  }

  if (obj instanceof Map) {
    return new Map(
      Array.from(obj.entries())
        .filter(([_, v]) => typeof v !== 'function')
        .map(([k, v]) => [k, deepCopy(v)])
    );
  }

  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => typeof v !== 'function')
      .map(([k, v]) => [k, deepCopy(v)])
  );
}

export { Store };

export let internals;

// Test-only exports
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
  internals = {
    Path,
    SubscriptionManager,
    StateProxy,
    StateValue,
  };
}
