import { Store } from './store.js';

const ATTRS = {
  BIND:  'data-miu-bind',
  FOR:   'data-miu-for',
  INDEX: 'data-miu-index',
  KEY:   'data-miu-key',
  STORE: 'data-miu-store',
};

const SEL = '$';
const KEY = `${SEL}key`;
const VALUE = `${SEL}value`;
const INDEX = `${SEL}index`;

// Mapping of elements to a map of store names to Store instances. The elements
// here will be root elements `bind` was originally called with.
const stores = new WeakMap();

// Mapping of elements to the root element they were bound from. This is used to
// lookup the stores of child elements.
const elementRoot = new WeakMap();

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
  const rootEl = elementRoot.get(root) ?? root;

  // Process store bindings first, since other bindings can depend on it.
  const storeSelector = `[${ATTRS.STORE}]`;
  const storeElements = typeof root.matches === 'function'
    ? [...(root.matches(storeSelector) ? [root] : []),
       ...root.querySelectorAll(storeSelector)]
    : root.querySelectorAll(storeSelector);

  for (const el of storeElements) {
    if (!elementRoot.has(el)) {
      elementRoot.set(el, rootEl);
    }
    const newStore = parseStoreAttr(el);
    if (!stores.has(el)) {
      stores.set(el, new Map());
    }
    const elStores = stores.get(el);
    elStores.set(newStore.$name, newStore);
  };

  // Process for loops next, since they can create new elements.
  const forSelector = `[${ATTRS.FOR}]`;
  const forElements = typeof root.matches === 'function'
    ? [...(root.matches(forSelector) ? [root] : []),
       ...root.querySelectorAll(forSelector)]
    : root.querySelectorAll(forSelector);

  for (const el of forElements) {
    if (!elementRoot.has(el)) {
      elementRoot.set(el, rootEl);
    }
    const {store, path} = parseForAttr(el);
    bindForEach(el, store, path);
  };

  // Finally, process value or event bindings.
  const bindSelector = `[${ATTRS.BIND}]`;
  const bindElements = typeof root.matches === 'function'
    ? [...(root.matches(bindSelector) ? [root] : []),
       ...root.querySelectorAll(bindSelector)]
    : root.querySelectorAll(bindSelector);

  for (const el of bindElements) {
    if (!elementRoot.has(el)) {
      elementRoot.set(el, rootEl);
    }
    const bindConfig = parseBindAttr(el);
    bindElement(el, bindConfig);
  };
}

/**
 * Context data for elements within a for loop, providing access to the current
 * item, its position, and associated store information.
 */
class BindContext {
  /**
   * @param {*} item - The current item from the array/object being iterated
   * @param {number} index - Zero-based index of the item in the array/object
   * @param {string|undefined} key - Key of the item (for Objects/Maps) or undefined (for Arrays)
   * @param {HTMLElement} element - The DOM element associated with this item
   * @param {Store} store - Store instance containing the iterated array/object
   * @param {string} path - Path to the array/object within the store
   */
  constructor(item, index, key, element, store, path) {
    this.item = item;
    this.index = index;
    this.key = key;
    this.element = element;
    this.store = store;
    this.path = path;
  }
}

// Return context data for elements within a for loop. The data includes the
// item, the item index within the array, the store associated with the parent
// for element, and the store path to the items.
function getBindContext(element) {
  const forParent = element.parentElement.closest(`[${ATTRS.FOR}]`);
  const parentCtx = bindContexts.get(forParent);
  const idxEl = element.closest(`[${ATTRS.INDEX}]`);

  if (parentCtx?.store && idxEl) {
    const idx = idxEl.getAttribute(ATTRS.INDEX);
    const key = idxEl.getAttribute(ATTRS.KEY);
    return new BindContext(
      // The Store implementation supports bracket notation for Maps, objects and arrays.
      parentCtx.items[key || idx],
      idx,
      key,
      idxEl,
      parentCtx.store,
      parentCtx.path
    );
  }

  return null;
}

/**
 * Parse a store attribute and create a new Store instance.
 * The store attribute format is "<new store name>:<store path>" where store path can be:
 * - "<store name>.<path>" for direct store value references
 * - "$[.<path>]" for referencing array elements within a for loop
 * - "$value[.<path>]" for referencing object values within a for loop
 *
 * @param {HTMLElement} el - Element with the store attribute
 * @returns {Store} New Store instance initialized with the referenced value
 * @throws {Error} If the store attribute format is invalid or referenced store is not found
 */
function parseStoreAttr(el) {
  const attrVal = el.getAttribute(ATTRS.STORE);

  const parts = attrVal.split(':');
  if (parts.length !== 2) {
    throw new Error(`[miu] Invalid store binding: '${attrVal}'`);
  }
  const [newStoreName, storePath] = parts;

  const {store, path} = storePath.charAt(0) === SEL
    ? resolveStoreRef(ATTRS.STORE, storePath, getBindContext(el))
    : getStoreAndPath(el, storePath);

  return new Store(newStoreName, store.$get(path));
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
 * - target: 'text' for text content binding, or any valid attribute/property name
 * - event: DOM event that triggers store updates or handler calls
 * - handler: Function reference in the store or in the global scope
 *
 * @param {HTMLElement} el - Element with the binding attribute
 * @returns {Array<{
 *   type: ('binding'|'event'),
 *   store?: Store,
 *   path?: string,
 *   target?: {type: string, name: string, path: string},
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
      : parseEventBinding(binding, el));
}

/**
 * Parse a data binding specification.
 * @param {string} binding - Binding specification string
 * @param {HTMLElement} element - Element with the binding attribute
 * @returns {{
 *   type: 'binding',
 *   store: Store,
 *   path: string,
 *   target: {type: string, name: string, path: string},
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

  let targetStr, event;
  if (twoWay) {
    const parts = rightSide.split('@');
    if (parts.length !== 2) {
      throw new Error(`[miu] Two-way binding requires @event: ${binding}`);
    }
    [targetStr, event] = parts;
    if (!targetStr || !event) {
      throw new Error(`[miu] Two-way binding requires both target and event: ${binding}`);
    }
  } else {
    if (rightSide.includes('@')) {
      throw new Error(`[miu] One-way binding should not specify @event: ${binding}`);
    }
    targetStr = rightSide;
  }

  const target = parseBindTarget(targetStr, element);

  const storeAndPath = storePath.charAt(0) === SEL
    ? resolveStoreRef(ATTRS.BIND, storePath, getBindContext(element))
    : getStoreAndPath(element, storePath);

  return {
    ...storeAndPath,
    type: 'binding',
    target,
    twoWay,
    event,
  };
}

/**
 * Determines if a property should be set directly on an element vs using setAttribute.
 * Walks up the prototype chain looking for properties that are either:
 * 1. Defined with a setter function (like input.value)
 * 2. Defined as writable properties (like element.style)
 *
 * @param {Element} element - DOM element to check
 * @param {string} name - Name of property/attribute
 * @returns {boolean} True if property should be set directly, false if setAttribute should be used
 */
function isPropSetable(element, name) {
  let proto = element;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor && (descriptor.set || descriptor.writable)) {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/**
 * Parses a binding target string into property or attribute binding configuration.
 * For properties that support direct assignment (like 'value' or 'style'), allows
 * dot notation to access nested properties (e.g., 'style.color').
 *
 * @param {string} targetStr - Binding target string (e.g., 'value', 'text', 'style.color', 'data-foo')
 * @param {Element} element - DOM element the binding will be applied to
 * @returns {Object} Parsed binding target:
 *   - For properties: {type: 'property', name: string, path: string|''} - path is an empty string if no nested access
 *   - For attributes: {type: 'attribute', name: string}
 *   - For text content: {type: 'text'}
 */
function parseBindTarget(targetStr, element) {
  // Special handling for text binding.
  if (targetStr === 'text') {
    return {
      type: 'text',
      name: '',
      path: '',
    };
  }

  const [targetName, ...targetParts] = targetStr.split('.');
  const targetPath = targetParts.join('.');
  if (isPropSetable(element, targetName)) {
    return {
      type: 'property',
      name: targetName,
      path: targetPath,
    };
  }
  return {
    type: 'attribute',
    name: targetStr,
    path: '',
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
function parseEventBinding(binding, element) {
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
    const storeAndPath = getStoreAndPath(element, fnRef);
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
    const { store, path } = getStoreAndPath(element, trigger);
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

  return getStoreAndPath(el, attrVal);
}

function resolveStoreRef(attr, ref, bindCtx) {
  // TODO: Make sure that Symbol keys are supported.
  if (!bindCtx) {
    throw new Error(`[miu] bind context not found for '${ref}'`);
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

function getStoreAndPath(element, storePath) {
  const [storeName, ...pathParts] = storePath.split('.');
  const path = pathParts.join('.');

  // First check if the store is bound directly to the element.
  let store = getStore(element, storeName);
  if (store) {
    return { store, path };
  }

  // Otherwise try its root.
  store = getStore(elementRoot.get(element), storeName);
  if (!store) {
    throw new Error(`[miu] Store '${storeName}' not found for element '${element.tagName}'`);
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
function storeSubscribe(element, bindConfig, subFn) {
  if (!storeSubs.has(element)) {
    storeSubs.set(element, new Map());
  }
  const elementStoreSubs = storeSubs.get(element);
  const subKey = bindConfig.type === 'event' ?
    `event:${bindConfig.event}` : `binding:${bindConfig.path}:${bindConfig.target.name}.${bindConfig.target.path}`;
  if (!elementStoreSubs.has(subKey)) {
    const unsub = subFn();
    elementStoreSubs.set(subKey, unsub);
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
 *   target?: {type: string, name: string, path: string},
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
      bindEvent(element, config);
    } else {
      // Get current value from store (or use key for loop bindings)
      const value = config.key ?? config.store.$get(config.path);
      bindValue(element, config, value);
    }
  }
}

/**
 * Bind event handlers to an element, triggered by either DOM events or store value changes.
 * For DOM events, calls the handler with (event, bindContext).
 * For store triggers, calls the handler with (event, bindContext, value).
 *
 * @param {HTMLElement} element - The DOM element to bind
 * @param {{
 *   store?: Store,
 *   fn: Function,
 *   event?: string,
 *   triggerStore?: Store,
 *   triggerPath?: string
 * }} config - Event binding configuration:
 *   - For DOM events: specify event and fn
 *   - For store triggers: specify triggerStore, triggerPath and fn
 */
function bindEvent(element, config) {
  if (config.triggerStore) {
    // Store value change trigger
    storeSubscribe(element, config, () => {
      return config.triggerStore.$subscribe(config.triggerPath, (value) => {
        const event = new CustomEvent('store:change', {
          detail: { path: config.triggerPath },
        });
        const bindCtx = getBindContext(element);
        config.fn.call(config.store, event, bindCtx, value.$value);
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
}

/**
 * Bind a store value change to update an element attribute or property (one-way),
 * and optionally bind element changes back to store (two-way).
 *
 * @param {HTMLElement} element - The DOM element to bind
 * @param {{
 *   store: Store,
 *   path: string,
 *   target: {type: string, name: string, path: string},
 *   twoWay: boolean,
 *   event?: string
 * }} config - Binding configuration
 * @param {*} value - Initial value to bind
 */
function bindValue(element, config, value) {
  let setter;
  switch (config.target.type) {
    case 'property':
      setter = createPropertySetter(element, config.target);
      break;
    case 'attribute':
      setter = createAttributeSetter(element, config.target);
      break;
    case 'text':
      setter = createTextSetter(element);
      break;
    default:
      throw new Error(`[miu] Unsupported bind target type: ${config.target.type}`);
  }

  setter(getValue(config.store, element, value));
  storeSubscribe(element, config, () =>
    config.store.$subscribe(config.path, val => {
      // Primitive values can still be returned in case of
      // Array.prototype.length or Map.prototype.size changes.
      const v = (val === null || typeof val !== 'object') ? val : val.$value;
      setter(getValue(config.store, element, v));
    })
  );

  if (config.twoWay) {
    const getter = config.target.type === 'property'
      ? e => e.target[config.target.name]
      : e => e.target.getAttribute(config.target.name);

    addEventHandler(element, config.event, e =>
      config.store.$set(config.path, getter(e))
    );
  }
}

function createPropertySetter(element, target) {
  return target.path
    ? val => {
        if (element[target.name][target.path] !== val) {
          element[target.name][target.path] = val;
        }
      }
    : val => {
        if (element[target.name] !== val) {
          element[target.name] = val;
        }
      };
}

function createAttributeSetter(element, target) {
  return val => {
    if (element.getAttribute(target.name) !== val) {
      element.setAttribute(target.name, val);
    }
  };
}

function createTextSetter(element) {
  return val => {
    let textNode = Array.from(element.childNodes)
      .find(node => node.nodeType === Node.TEXT_NODE);
    if (!textNode) {
      textNode = document.createTextNode('');
      element.insertBefore(textNode, element.firstChild);
    }
    if (textNode.nodeValue !== val) {
      textNode.nodeValue = val;
    }
  };
}

// Return the value to set on the element. If the value is a function (computed value),
// it will be evaluated with the store and the element's bind context.
function getValue(store, element, value) {
  if (typeof value === 'function') {
    value = value.call(store, getBindContext(element));
  }
  return value;
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
        elementRoot.set(el, elementRoot.get(element));
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

    // Remove excess elements, unsubscribing their store subscriptions, if any.
    while (element.childElementCount - 1 > count) {
      const el = element.lastElementChild;
      const subs = storeSubs.get(el);
      if (subs) {
        for (const unsub of subs.values()) {
          unsub();
        }
      }
      el.remove();
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

  if (!stores.has(el)) {
    stores.set(el, new Map());
  }
  const elStores = stores.get(el);
  for (const store of newStores) {
    if (elStores.has(store.$name)) {
      throw new Error(`[miu] Store with name "${store.$name}" already exists for element ${el.tagName}`);
    }
    elStores.set(store.$name, store);
  }
  stores.set(el, elStores);

  setupBindings(el);
}

/**
 * Return a Store instance bound to a specific element.
 * @param {HTMLElement|string} element - The DOM element or CSS selector to the element
 * @param {string} storeName - The name of the store
 * @returns {Store}
 * @throws {Error} If the element is null or cannot be found
 */
function getStore(element, storeName) {
  const el = typeof element === 'string' ? document.querySelector(element) : element;
  if (!el) throw new Error('[miu] Element not found');
  return stores.get(element)?.get(storeName);
}

export { bind, getStore };
