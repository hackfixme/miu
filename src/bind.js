import { stores } from './store.js';

const ATTRS = {
  BIND:  'data-miu-bind',
  FOR:   'data-miu-for',
  INDEX: 'data-miu-index',
  KEY:   'data-miu-key',
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
 * Parse a bind attribute that can contain multiple bindings and event handlers
 * separated by spaces.
 * Bindings can be in the format:
 * - "storePath->target" for one-way binding
 * - "storePath<->target@event" for two-way binding
 * Event handlers can be in the format:
 * - "[storePath.]handler@event"
 * where:
 * - storePath: "<store name>.<path>" or "$[.<path>]" for loop references
 * - target: 'text' for textContent binding, or any valid attribute/property name
 * - event: DOM event that triggers store updates or handler calls
 * - handler: Function reference in the store or in the global scope
 *
 * @param {HTMLElement} el - Element with the binding attribute
 * @returns {Array<{
 *   type: ('binding'|'event'),
 *   store?: Store,
 *   path?: string,
 *   target?: string,
 *   twoWay?: boolean,
 *   event?: string,
 *   fn?: Function,
 *   triggerStore?: Store,
 *   triggerPath?: string
 * }>}
 * @throws {Error} If any binding format is invalid or store/handler is not found
 */
function parseBindAttr(el) {
  const attrVal = el.getAttribute(ATTRS.BIND);
  return attrVal.split(/\s+/)
    .filter(Boolean) // filter out empty strings
    .map(binding => binding.includes('->')
      ? parseBinding(binding, el)
      : parseEventBinding(binding));
}

/**
 * Parse a data binding specification.
 * @param {string} binding - Binding specification string
 * @param {HTMLElement} element - Element with the binding attribute
 * @returns {{
 *   type: 'binding',
 *   store: Store,
 *   path: string,
 *   target: string,
 *   twoWay: boolean,
 *   event?: string
 * }}
 * @throws {Error} If binding format is invalid or store is not found
 * @private
 */
function parseBinding(binding, element) {
  const match = binding.match(/^(.+?)(->|<->)(.+)$/);
  if (!match) {
    throw new Error(`[miu] Invalid bind syntax: ${binding}. Expected: storePath->target or storePath<->target@event`);
  }

  const [, storePath, arrow, rightSide] = match;
  const twoWay = arrow === '<->';

  let target, event;
  if (twoWay) {
    const parts = rightSide.split('@');
    if (parts.length !== 2) {
      throw new Error(`[miu] Two-way binding requires @event: ${binding}`);
    }
    [target, event] = parts;
    if (!target || !event) {
      throw new Error(`[miu] Two-way binding requires both target and event: ${binding}`);
    }
  } else {
    if (rightSide.includes('@')) {
      throw new Error(`[miu] One-way binding should not specify @event: ${binding}`);
    }
    target = rightSide;
  }

  const storeAndPath = storePath.charAt(0) === SEL
    ? resolveStoreRef(ATTRS.BIND, storePath, getBindContext(element))
    : getStoreAndPath(storePath);

  return {
    ...storeAndPath,
    type: 'binding',
    target,
    twoWay,
    event,
  };
}

/**
 * Parse an event handler specification.
 * @param {string} binding - Event binding specification string in the
 *   format "[storePath.]handler@event"
 * @returns {{
 *   type: 'event',
 *   store?: Store,
 *   fn: Function,
 *   event: string,
 *   triggerStore?: Store,
 *   triggerPath?: string
 * }}
 * @throws {Error} If binding format is invalid or handler is not found/not a function
 * @private
 */
function parseEventBinding(binding) {
  const parts = binding.split('@');
  if (parts.length !== 2) {
    throw new Error(`[miu] Invalid event binding syntax: ${binding}. Expected: storePath.handler@event or globalHandler@event`);
  }

  const [fnRef, trigger] = parts;
  if (!fnRef || !trigger) {
    throw new Error(`[miu] Event binding requires both handler and trigger: ${binding}`);
  }

  let fn, store;
  // Get function reference from store or global scope
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

  let triggerStore, triggerPath;
  // Handle store path triggers
  if (trigger.includes('.')) {
    const { store, path } = getStoreAndPath(trigger);
    triggerStore = store;
    triggerPath = path;
  }

  return {
    type: 'event',
    ...(store && { store }),
    fn,
    event: trigger,
    ...(triggerStore && { triggerStore, triggerPath })
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

  if (ref === SEL) {
    return {
      store: bindCtx.store,
      path: path,
    };
  }

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
 * Bind an element to stores using one or more binding configurations.
 * Configurations can specify either:
 * - Value bindings that sync element attributes/properties with store values
 * - Event handlers that call store or global functions when events occur
 * Event handlers can be triggered by either:
 * - DOM events (e.g., "click", "input")
 * - Store value changes (e.g., "users.count")
 *
 * @param {HTMLElement} element - The DOM element to bind
 * @param {Array<{
 *   type: ('binding'|'event'),
 *   store?: Store,
 *   path?: string,
 *   target?: string,
 *   twoWay?: boolean,
 *   event?: string,
 *   fn?: Function,
 *   triggerStore?: Store,
 *   triggerPath?: string
 * }>} bindConfigs - Array of configurations describing how to bind the element
 */
function bindElement(element, bindConfigs) {
  for (const config of bindConfigs) {
    if (config.type === 'event') {
      if (config.triggerStore) {
        // Store value change trigger
        storeSubscribe(element, config.triggerPath, () => {
          return config.triggerStore.$subscribe(config.triggerPath, (value) => {
            const event = new CustomEvent('store:change', {
              detail: { path: config.triggerPath }
            });
            const bindCtx = getBindContext(element);
            config.fn.call(config.store, event, value, bindCtx);
          });
        });
      } else {
        // DOM event trigger
        addEventHandler(element, config.event, (event) => {
          event.preventDefault();
          const bindCtx = getBindContext(element);
          config.fn.call(config.store, event, bindCtx);
        });
      }
      continue;
    }

    // Get current value from store (or use key for loop bindings)
    const value = config.key ?? config.store.$get(config.path);

    // Handle computed values (functions)
    const finalValue = typeof value === 'function'
      ? value(getBindContext(element))
      : value;

    if (config.target === 'text') {
      bindText(element, config, finalValue);
    } else {
      bindAttribute(element, config, finalValue);
    }
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
      if (!el) {
        // No element for this item, so create it.
        const clone = document.importNode(template.content, true);
        element.appendChild(clone);
        el = element.lastElementChild;
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
}

export { bind };
