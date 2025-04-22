// Identifies the parent property on state proxy objects.
const PARENT = Symbol('parent');
// Identifies the roots property on state proxy objects.
const ROOTS = Symbol('roots');

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
   * @param {Object|Store|Proxy} [initialState={}] - Initial state object.
   *   If it's an existing Store or Proxy, its state and subscriptions will be shared.
   * @throws {Error} If name is not a string
   * @returns {Proxy} Proxied store instance with reactive capabilities
   */
  constructor(name, initialState = {}) {
    if (typeof name !== 'string') {
      throw new Error('[miu] Store name must be a string');
    }

    const state = initialState instanceof Store ? initialState.$state : initialState;
    const stateProxy = StateProxy.create(
      state,
      state?.$key || '',
      state ? state[PARENT] : null,
      state instanceof StateProxy ? state : null,
    );

    const api = this._createAPI(
      name,
      stateProxy,
      (path, callback) => SubscriptionManager.subscribe(stateProxy, path, callback),
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
   * @param {Proxy} state - Store state object
   * @param {function(string, function): function} subscribe - Function to create store subscriptions
   * @returns {Object} Store API methods
   */
  _createAPI(name, state, subscribe) {
    return {
      $get: (path) => {
        Path.validatePath(path);
        return Path.getValue(state, path);
      },
      $set: (path, value) => {
        Path.validatePath(path);
        Path.setValue(state, path, value);
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
   * Gets the path string for a state object relative to an optional parent
   * @param {Proxy|StateValue} obj - The state object to get path for
   * @param {Proxy} [parent=null] - Optional parent to get path relative to
   * @returns {string} The path string representation
   */
  static get(obj, parent = null) {
    if (!(obj instanceof StateProxy || obj instanceof StateValue)) return '';

    const wrapKey = (v, isLast) => isLast ? v.$key
      : (Array.isArray(v[PARENT]) || v[PARENT] instanceof Map) ?
        `[${v.$key}]` : `.${v.$key}`;

    let path = '';
    for (; obj && obj !== parent; obj = obj[PARENT]) {
      const isLast = !obj[PARENT]?.$key || obj[PARENT] === parent;
      path = wrapKey(obj, isLast) + path;
    }

    return path;
  }

  /**
   * Gets a value from a nested object using a path string
   * @param {Object} obj - The object to traverse
   * @param {string} path - The path to the value (e.g. "foo.bar[0].baz")
   * @returns {*} The value at the specified path, or undefined if the path doesn't exist
   */
  static getValue(obj, path) {
    return path
      .split(/[.\[]/)
      .map(key => key.replace(']', ''))
      .reduce((curr, key) => {
        if (!curr) return undefined;
        if (curr instanceof Map) {
          return key in Map.prototype ? curr[key] : curr.get(key);
        }
        return curr[key];
      }, obj);
  }

  /**
   * Sets a value in a nested object using a path string
   * @param {Object} obj - The object to modify
   * @param {string} path - The path where the value should be set (e.g. "foo.bar[0].baz")
   * @param {*} value - The value to set at the specified path
   * @returns {void}
   */
  static setValue(obj, path, value) {
    const parts = path.split(/[.\[]/).map(key => key.replace(']', ''));
    const lastKey = parts.pop();

    const target = parts.reduce((curr, key) => {
      // Create intermediate objects if they don't exist while traversing the path
      if (!curr[key] && !(curr instanceof Map)) {
        curr[key] = {};
      }
      return curr instanceof Map ? curr.get(key) : curr[key];
    }, obj);

    if (target instanceof Map) {
      target.set(lastKey, value);
    } else {
      target[lastKey] = value;
    }
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
  // Mapping of root state objects to a map of state paths to callback functions
  // that will be called when a value matching that path changes.
  static #listeners = new WeakMap();

  /**
   * Subscribes to changes at a specific path
   * @param {Proxy} root - The root state object of the subscription
   * @param {string} path - State path relative to the root to subscribe to
   * @param {function} callback - Function to invoke on state changes
   * @returns {function} Unsubscribe function
   */
  static subscribe(root, path, callback) {
    if (!this.#listeners.has(root)) {
      this.#listeners.set(root, new Map());
    }
    const listeners = this.#listeners.get(root);
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
  }

  /**
   * Notifies subscribers of state changes
   * @param {Proxy} root - The root state object of the subscription
   * @param {Proxy|StateValue} value - The new value that was changed
   */
  static notify(root, value) {
    if (!this.#listeners.has(root)) return;

    const path = Path.get(value, root);
    const listeners = this.#listeners.get(root);

    // Notify root listeners
    if (listeners.has('')) {
      listeners.get('').forEach(callback => callback(root));
    }

    // Notify exact path listeners
    if (listeners.has(path)) {
      listeners.get(path).forEach(callback => callback(value));
    }

    // Notify child listeners
    for (const [listenerPath, callbacks] of listeners) {
      if (listenerPath.startsWith(path + '.')) {
        const childValue = Path.getValue(root, listenerPath);
        callbacks.forEach(callback => callback(childValue));
      }
    }

    // Notify parent listeners
    const parts = path.split('.');
    while (parts.length > 1) {
      parts.pop();
      const parentPath = parts.join('.');
      if (listeners.has(parentPath)) {
        const parentValue = Path.getValue(root, parentPath);
        listeners.get(parentPath).forEach(callback => callback(parentValue));
      }
    }
  }
}

/**
 * A reactive proxy for state management with support for nested objects, arrays, and maps.
 */
class StateProxy {
  // Symbol to identify StateProxy instances.
  static #isProxy = Symbol('isProxy')
  // Root state objects associated with this proxy. Used for change notifications.
  #roots = new Set();

  /**
   * Creates a new StateProxy instance.
   * @param {Object|Array|Map} value - The object to make reactive
   * @param {string} [key=''] - Identifier of this object at this path in the state tree
   * @param {Proxy} [parent=null] - Parent of this object in the state tree
   * @returns {Proxy} A proxy wrapper around the target object
   */
  constructor(value, key = '', parent = null) {
    this.value = value;
    this.key = key;
    this.notify = v => this.#roots.forEach(r => SubscriptionManager.notify(r, v));

    this.proxy = new Proxy(value, this);
    Object.defineProperty(this.proxy, StateProxy.#isProxy, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    Object.defineProperty(this.proxy, PARENT, {
      value: parent,
      configurable: false,
      enumerable: false,
      writable: false
    });
    Object.defineProperty(this.proxy, ROOTS, {
      value: this.#roots,
      configurable: false,
      enumerable: false,
      writable: false
    });

    if (parent) {
      for (const root of parent[ROOTS]) {
        this.#roots.add(root);
      }
    } else {
      this.#roots.add(this.proxy);
    }

    return this.proxy;
  }

  /**
   * Adds a root proxy to this instance and all nested proxy instances.
   * Used internally to correctly propagate state change notifications.
   * @param {Proxy} instance - The state proxy instance to modify
   * @param {Proxy} root - The root proxy instance to add
   * @throws {TypeError} If root is not a valid StateProxy instance
   * @private
   */
  static #addRoot(instance, root) {
    if (!root?.[this.#isProxy]) {
      throw new TypeError('[miu] root must be a StateProxy instance');
    }

    instance[ROOTS].add(root);

    const processValue = (val) => {
      if (val?.[this.#isProxy]) {
        this.#addRoot(val, root);
      }
    };

    if (instance instanceof Map) {
      for (const val of instance.values()) {
        processValue(val);
      }
    } else if (Array.isArray(instance)) {
      instance.forEach(processValue);
    } else {
      Object.values(instance).forEach(processValue);
    }
  }

  /**
   * Creates a state proxy that recursively wraps a deep copy of an object and
   * its nested properties. The original object remains unchanged.
   * @param {*} obj - The target object to proxy
   * @param {string} [key=''] - Identifier of this object at this path in the state tree
   * @param {Proxy} [parent=null] - Parent of this object in the state tree
   * @param {Proxy} [root=null] - Root proxy instance containing the complete state tree.
   *   If null, it indicates that this is the root instance.
   * @returns {*} A proxy wrapping a copy of the target object or the original value if not proxyable
   */
  static create(obj, key = '', parent = null, root = null) {
    if (obj === null || typeof obj !== 'object') {
      return new StateValue(obj, key, parent);
    }
    if (obj instanceof StateValue) {
      return obj;
    }
    if (obj instanceof StateProxy) {
      if (root) StateProxy.#addRoot(obj, root);
      return obj;
    }

    let value;
    if (obj instanceof Map) {
      value = new Map();
    } else if (Array.isArray(obj)) {
      value = [];
    } else if (obj instanceof Date) {
      value = new Date(obj.valueOf());
    } else {
      value = {};
    }

    const proxy = new StateProxy(value, key, parent);
    const rootProxy = root ?? proxy;

    // Recursively create proxies for all nested values
    if (obj instanceof Map) {
      for (const [key, val] of obj.entries()) {
        value.set(key, StateProxy.create(val, key, proxy, rootProxy));
      }
    } else if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        value[i] = StateProxy.create(obj[i], i.toString(), proxy, rootProxy);
      }
    } else {
      for (const [key, val] of Object.entries(obj)) {
        value[key] = StateProxy.create(val, key, proxy, rootProxy);
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
      return this.handleMap(target, prop);
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

    const newValue = StateProxy.create(value, prop, this.proxy);
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
      const newValue = new StateValue(undefined, prop, this.proxy);
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
   * @returns {Function} Wrapped array method
   * @private
   */
  handleArrayMethods(target, prop) {
    const self = this;
    return (...args) => {
      // Arguments to methods that can add new values to the array must be wrapped.
      if (['push', 'unshift', 'splice', 'fill', 'concat'].includes(prop)) {
        args = args.map((arg, i) => {
          // For splice, skip the first two args (start, deleteCount)
          if (prop === 'splice' && i < 2) return arg;
          return StateProxy.create(arg, (target.length + i).toString(), self.proxy);
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
        const newValue = new StateValue(undefined, i.toString(), this.proxy);
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

    const newValue = StateProxy.create(value, prop, this.proxy);
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
   * @returns {Function|any} Map method or value
   * @private
   */
  handleMap(target, prop) {
    const self = this;
    const mapOperations = {
      get: (key) => target.get(key),

      set: (key, value) => {
        const newValue = StateProxy.create(value, key, self.proxy);
        target.set(key, newValue);
        self.notify(newValue);
        self.notify(self.proxy);
        return target;
      },

      delete: (key) => {
        const hadKey = target.has(key);
        const result = target.delete(key);
        if (hadKey) {
          const value = new StateValue(undefined, key, self.proxy);
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
          const value = new StateValue(undefined, key, self.proxy);
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
   * Creates a new state value instance for primitive values that can't be
   * proxied. Its properties align with the StateProxy interface for
   * compatibility reasons.
   * @param {*} value - The value to store
   * @param {string} [key=''] - Identifier of this object at this path in the state tree
   * @param {Proxy} [parent=null] - Parent of this object in the state tree
   */
  constructor(value, key = '', parent = null) {
    this.$value = value;
    this.$key = key;

    Object.defineProperty(this, PARENT, {
      value: parent,
      configurable: false,
      enumerable: false,
      writable: false
    });
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
