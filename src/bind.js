import { stores } from './store.js';

const ATTRS = {
  BIND:  'data-miu-bind',
  FOR:   'data-miu-for',
  INDEX: 'data-miu-index',
  KEY:   'data-miu-key',
  ON:    'data-miu-on',
};

const SEL = '$';
const KEY = `${SEL}key`;
const VALUE = `${SEL}value`;
const INDEX = `${SEL}index`;

// Mapping of parent for-loop element to items rendered in the loop.
// Used to pass the correct element index to child event handlers.
const bindContexts = new WeakMap();

// Mapping of elements to a map of event names to event handlers. Ensures the
// handlers are only added once.
const eventHandlers = new WeakMap();

// Maping of elements to a map of store paths to store unsubscribe functions.
// Ensures the subscriptions are only added once.
const storeSubs = new WeakMap();

// Setup data bindings and update DOM element values.
// TODO: Extract DOM updating.
function setupBindings(root) {
  // Setup for loops first as they create new elements.
  const forSelector = `[${ATTRS.FOR}]`;
  const forElements = [
      ...(root.matches(forSelector) ? [root] : []),
      ...root.querySelectorAll(forSelector)
  ];
  for (const el of forElements) {
    const {store, path} = parseForAttr(el);
    bindForEach(el, store, path);
  };

  // Setup all other bindings.
  const bindSelector = `[${ATTRS.BIND}]`;
  const bindElements = [
      ...(root.matches(bindSelector) ? [root] : []),
      ...root.querySelectorAll(bindSelector)
  ];
  for (const el of bindElements) {
    const bindConfig = parseBindAttr(el);
    bindElement(el, bindConfig);
  };
}

// Return context data for elements within a for loop. The data includes the
// item, the item index within the array, the store associated with the parent
// for element, and the store path to the items.
function getBindContext(element) {
  const forParent = element.parentElement.closest(`[${ATTRS.FOR}]`);
  const parentCtx = bindContexts.get(forParent);
  const idxEl = element.closest(`[${ATTRS.INDEX}]`);

  let context;
  if (parentCtx?.store && idxEl) {
    const idx = idxEl.getAttribute(ATTRS.INDEX);
    const key = idxEl.getAttribute(ATTRS.KEY);
    context = {
      // The Store implementation supports bracket notation for Maps, objects and arrays.
      item: parentCtx.items[key || idx],
      index: idx,
      key: key,
      store: parentCtx.store,
      path: parentCtx.path,
    };
  }

  return context;
}

/**
 * Parse a bind attribute in the format "storePath->target" for one-way binding
 * or "storePath<->target@event" for two-way binding, where:
 * - storePath: "<store name>.<path>" or "$[.<path>]" for loop references
 * - target: 'text' for textContent binding, or any valid attribute/property name of the element
 * - event: Required for two-way binding, the DOM event that triggers updates to the store
 *
 * @param {HTMLElement} el - Element with the binding attribute
 * @returns {{
 *   store: Store,
 *   path: string,
 *   target: string,
 *   twoWay: boolean,
 *   event?: string,
 *   key?: string
 * }}
 * @throws {Error} If the binding format is invalid or store is not found
 */
function parseBindAttr(el) {
  const attrVal = el.getAttribute(ATTRS.BIND);

  // Match either -> or <-> with groups for left/right sides
  const match = attrVal.match(/^(.+?)(->|<->)(.+)$/);
  if (!match) {
    throw new Error(`[miu] Invalid bind syntax: ${attrVal}. Expected: storePath->target or storePath<->target@event`);
  }

  const [, storePath, arrow, rightSide] = match;
  const twoWay = arrow === '<->';

  // Parse right side for target and optional event
  let target, event;
  if (twoWay) {
    const parts = rightSide.split('@');
    if (parts.length !== 2) {
      throw new Error(`[miu] Two-way binding requires @event: ${attrVal}`);
    }
    [target, event] = parts;
    if (!target || !event) {
      throw new Error(`[miu] Two-way binding requires both target and event: ${attrVal}`);
    }
  } else {
    if (rightSide.includes('@')) {
      throw new Error(`[miu] One-way binding should not specify @event: ${attrVal}`);
    }
    target = rightSide;
  }

  // Resolve store reference (either direct store path or inner loop reference)
  let storeAndPath;
  if (storePath.charAt(0) === SEL) {
    const bindCtx = getBindContext(el);
    storeAndPath = resolveStoreRef(ATTRS.BIND, storePath, bindCtx);
  } else {
    storeAndPath = getStoreAndPath(storePath);
  }

  return {
    ...storeAndPath,
    target,
    twoWay,
    event,
  };
}

/**
 * Parse a for attribute resolving any inner loop references.
 * The path can be either:
 * - "<store name>.<store path>" for direct store value references
 * - "$[.<store path>]" for referencing array elements within a for loop
 * - "$value[.<store path>]" for referencing object values within a for loop
 *
 * @param {HTMLElement} el - Element with the for attribute
 * @returns {{
 *   store: Store,
 *   path: string
 * }}
 * @throws {Error} If the path format is invalid or store is not found
 */
function parseForAttr(el) {
  const attrVal = el.getAttribute(ATTRS.FOR);

  if (attrVal.charAt(0) === SEL) {
    const bindCtx = getBindContext(el);
    return resolveStoreRef(ATTRS.FOR, attrVal, bindCtx);
  }

  return getStoreAndPath(attrVal);
}

function resolveStoreRef(attr, ref, bindCtx) {
  // TODO: Make sure that Symbol keys are supported.
  if (typeof bindCtx === 'undefined') {
    throw new Error(`[miu] bind context is undefined for ${ref}`);
  }

  // The store implementation simplifies the path syntax here.
  // bindCtx.path is the base path up until the element we need to resolve.
  // Since store Map elements can be accessed using bracket notation, just like objects,
  // we use the key if it's defined. Otherwise, we assume the item is an array element,
  // and retrieve it by its index (which should always be defined).
  const path = `${bindCtx.path}[${bindCtx.key || bindCtx.index}]`;

  if (ref === KEY || ref === INDEX) {
    if (attr === ATTRS.FOR) {
      throw new Error(`[miu] ${ref} is unsupported for ${ATTRS.FOR}`);
    }
    return {
      store: bindCtx.store,
      path: path,
      key: bindCtx.key,
    };
  }

  if (ref.startsWith(`${SEL}.`)) {
    return {
      store: bindCtx.store,
      path: `${path}${ref.slice(1)}`,
    };
  }

  if (ref.startsWith(VALUE)) {
    return {
      store: bindCtx.store,
      path: `${path}${ref.slice(6)}`,
    };
  }

  throw new Error(`[miu] Invalid store reference: ${ref}`);
}

function getStoreAndPath(storePath) {
  const [storeName, path] = storePath.split('.', 2);
  if (!storeName || !path) {
    throw new Error(`[miu] Invalid path format: ${storePath}`);
  }

  const store = stores.get(storeName);
  if (!store) {
    throw new Error(`[miu] Store not found: ${storeName}`);
  }

  return { store, path };
}

function parseOnAttr(attrStr) {
  const parseAttrPart = (attr) => {
    const parts = attr.split(':');
    if (!attr || parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`[miu] Invalid on attribute format: ${attr}`);
    }

    const [trigger, fnRef] = parts;
    let fn, store;

    // Get function reference (right side of colon)
    if (fnRef.includes('.')) {
      const storeAndPath = getStoreAndPath(fnRef);
      store = storeAndPath.store;
      fn = store.$get(storeAndPath.path);
    } else {
      fn = globalThis[fnRef];
    }

    if (typeof fn !== 'function') {
      throw new Error(`[miu] ${fnRef} is not a function`);
    }

    const result = store ? { fn, store } : { fn };

    // Handle trigger (left side of colon)
    if (trigger.includes('.')) {
      const { store, path } = getStoreAndPath(trigger);
      return { ...result, type: 'store', triggerStore: store, triggerPath: path };
    }

    return { ...result, type: 'event', eventName: trigger };
  };

  return attrStr.split(/\s+/).map(parseAttrPart);
}

/**
 * Attach event handlers to child elements of root that have the data-miu-on
 * attribute set. The trigger for calling the handler can either be a specific
 * event, or a data store change for a specific path. The handler can be defined
 * globally, or on a specific store. Multiple events can be attached to a single
 * element by separating them with a space.
 * @param {HTMLElement} root - Root element to search for binding attributes
 * @example
 * // Event binding - calls global function
 * <button data-miu-on="click:handleClick">Click me</button>
 *
 * // Event binding - calls store method
 * <button data-miu-on="click:myStore.handleClick">Click me</button>
 *
 * // Store path binding - triggers when store value changes
 * <div data-miu-on="users.active:handleUserChange">...</div>
 *
 * // Multiple bindings
 * <button data-miu-on="click:handleClick
                        mouseenter:handleHover
                        users.count:handleCountChange">
 *   Click me
 * </button>
 */
function setupEventHandlers(root) {
  for (const el of root.querySelectorAll(`[${ATTRS.ON}]`)) {
    const attrStr = el.getAttribute(ATTRS.ON);
    const attrs = parseOnAttr(attrStr);

    for (const attr of attrs) {
      if (attr.type === 'event') {
        addEventHandler(el, attr.eventName, (event) => {
          event.preventDefault();
          const bindCtx = getBindContext(el);
          attr.fn.call(attr.store, event, bindCtx);
        });
      } else {
        storeSubscribe(el, attr.triggerPath, () => {
          return attr.triggerStore.$subscribe(attr.triggerPath, (value) => {
            const event = new CustomEvent('store:change', {
              detail: { path: attr.triggerPath }
            });
            const bindCtx = getBindContext(el);
            attr.fn.call(attr.store, event, value, bindCtx);
          });
        });
      }
    }
  }
}

// Attach the handler function for the event on the element. A handler for a
// unique event name will only be added once.
// FIXME: It should be possible to add multiple handlers for the same event...
function addEventHandler(element, event, handler) {
  if (!eventHandlers.has(element)) {
    eventHandlers.set(element, new Map());
  }
  const elementEventHandlers = eventHandlers.get(element);
  if (!elementEventHandlers.has(event)) {
    element.addEventListener(event, handler);
    elementEventHandlers.set(event, handler);
  }
}

// Subscribe to the element to the store value at path. No-op if the
// subscription for the same element and path already exists.
function storeSubscribe(element, path, subFn) {
  if (!storeSubs.has(element)) {
    storeSubs.set(element, new Map());
  }
  const elementStoreSubs = storeSubs.get(element);
  if (!elementStoreSubs.has(path)) {
    const unsub = subFn();
    elementStoreSubs.set(path, unsub);
  }
}

/**
 * Bind an element to a store using the provided binding configuration.
 * Resolves the current value and sets up one or two-way data binding.
 *
 * @param {HTMLElement} element - The DOM element to bind
 * @param {{
 *   store: Store,
 *   path: string,
 *   target: string,
 *   twoWay: boolean,
 *   event?: string,
 *   key?: string
 * }} bindConfig - Configuration describing how to bind the element
 */
function bindElement(element, bindConfig) {
  // Get current value from store (or use key for loop bindings)
  const value = bindConfig.key ?? bindConfig.store.$get(bindConfig.path);

  // Handle computed values (functions)
  const finalValue = typeof value === 'function'
    ? value(getBindContext(element))
    : value;

  if (bindConfig.target === 'text') {
    bindText(element, bindConfig, finalValue);
  } else {
    bindAttribute(element, bindConfig, finalValue);
  }
}

/**
 * Bind a store value change to update an element attribute or property (one-way),
 * and optionally the element's attribute or property value triggered by
 * config.event to update the store value (two-way) if config.twoWay is true.
 * For input elements, uses property binding for 'value' and 'checked'.
 * For other elements or attributes, uses attribute binding.
 *
 * @param {HTMLElement} element - The DOM element to bind
 * @param {{
 *   store: Store,
 *   path: string,
 *   target: string,
 *   twoWay: boolean,
 *   event?: string
 * }} config - Configuration describing how to bind the element
 * @param {*} value - The current value to bind
 */
function bindAttribute(element, config, value) {
  // These attributes represent element state and should use properties
  const useProperty = element.tagName === 'INPUT' &&
    (config.target === 'value' || config.target === 'checked');

  if (useProperty) {
    if (element[config.target] !== value) {
      element[config.target] = value;
    }
    storeSubscribe(element, config.path, () => {
      return config.store.$subscribe(config.path, (value) => {
        if (element[config.target] !== value) {
          element[config.target] = value;
        }
      });
    });

    if (config.twoWay) {
      addEventHandler(element, config.event, (e) => {
        config.store.$set(config.path, e.target[config.target]);
      });
    }
  } else {
    if (element.getAttribute(config.target) !== value) {
      element.setAttribute(config.target, value);
    }
    storeSubscribe(element, config.path, () => {
      return config.store.$subscribe(config.path, (value) => {
        if (element.getAttribute(config.target) !== value) {
          element.setAttribute(config.target, value);
        }
      });
    });

    if (config.twoWay) {
      addEventHandler(element, config.event, (e) => {
        config.store.$set(config.path, e.target.getAttribute(config.target));
      });
    }
  }
}

// Bind any element's textContent to the store value at path.
function bindText(element, config, value) {
  if (element.textContent !== value) {
    element.textContent = value;
  }
  storeSubscribe(element, config.path, () => {
    return config.store.$subscribe(config.path, (value) => {
      if (element.textContent !== value) {
        element.textContent = value;
      }
    });
  });
}

/**
 * Creates an iterator that yields [index, key, value] tuples for any iterable.
 * @param {*} items - The items to iterate over (array, object, Map, or other iterable)
 * @param {string} path - Path identifier for error messages
 * @returns {Iterator<[number, (string|undefined), *]>} Iterator yielding tuples of:
 *   - number: zero-based index
 *   - string|undefined: key (for Objects/Maps) or undefined (for Arrays/other iterables)
 *   - *: the value at that position
 * @throws {Error} If items is null/undefined or not iterable
 */
const getIndexedIterator = (items, path) => {
  if (items == null) {
    throw new Error(`[miu] Value of ${path} is null or undefined`);
  }

  let index = 0;

  if (Array.isArray(items)) {
    return function* () {
      for (const value of items) {
        yield [index, undefined, value];
        index++;
      }
    }();
  }

  if (items instanceof Map) {
    return function* () {
      for (const [key, value] of items.entries()) {
        yield [index, key, value];
        index++;
      }
    }();
  }

  if (items instanceof Object) {
    return function* () {
      for (const [key, value] of Object.entries(items)) {
        yield [index, key, value];
        index++;
      }
    }();
  }

  if (typeof items?.[Symbol.iterator] !== 'function') {
    throw new Error(`[miu] Value of ${path} is not iterable`);
  }

  return function* () {
    for (const value of items) {
      yield [index, undefined, value];
      index++;
    }
  }();
};

// Iterate over array items from the store at path, creating or removing elements
// as needed. Bindings and event handlers are also created for child elements.
// This attempts to render elements efficiently, by reusing ones that already exist.
function bindForEach(element, store, path) {
  const template = element.firstElementChild;
  if (!(template instanceof HTMLTemplateElement)) {
    // TODO: Maybe loosen this restriction? It should be possible to loop over
    // an array without filling a template.
    throw new Error(`[miu] ${ATTRS.FOR} requires a template element`);
  }

  // TODO: Warn if the template includes more than one element.

  const fullPath = `${store.$name}.${path}`;

  const render = (items) => {
    const iterator = getIndexedIterator(items, fullPath);

    // Set the context for this loop. This is used for binding child elements
    // and is passed to child event handlers.
    bindContexts.set(element, { store, path, items });

    let count = 0;
    for (const [index, key] of iterator) {
      // TODO: Filter only elements managed by Miu, to allow other elements to
      // exist within the for-loop container.
      let el = element.children[index + 1]; // +1 to account for the template
      let cloned = false;
      if (!el) {
        // No element for this item, so create it.
        const clone = document.importNode(template.content, true);
        element.appendChild(clone);
        el = element.lastElementChild;
        cloned = true;
      }

      // Set the index of this item so that it can be used to retrieve the
      // bind context when rendering. This could also be handled internally
      // in another map, but it might be useful to expose it to users.
      el.setAttribute(ATTRS.INDEX, index);
      if (key) {
        // Also set the key if it's an object or Map element.
        el.setAttribute(ATTRS.KEY, key);
      }

      // TODO: Only re-render elements if the element wasn't cloned. There's no
      // need to setup the bindings again. In practice it's not a problem, since
      // storeSubscribe ensures only a single subscription is added, but it's
      // unnecessary.
      setupBindings(el);
      if (cloned) {
        setupEventHandlers(el);
      }

      count++;
    }

    // Remove excess elements
    while (element.childElementCount - 1 > count) {
      element.lastElementChild.remove();
    }
  };

  store.$subscribe(path, render);
  render(store.$get(path));
}

// Bind an element and its children to the given stores. element can either be a
// CSS selector or an HTMLElement.
function bind(element, newStores) {
  const el = typeof element === 'string' ? document.querySelector(element) : element;
  if (!el) throw new Error('[miu] Element not found');

  for (const store of newStores) {
    if (stores.has(store.$name)) {
      throw new Error(`[miu] Store with name "${store.$name}" already exists`);
    }
    stores.set(store.$name, store);
  }

  setupBindings(el);
  setupEventHandlers(el);
}

export { bind };
