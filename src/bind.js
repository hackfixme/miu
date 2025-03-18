import { stores } from './store.js';

const ATTRS = {
  BIND:  'data-miu-bind',
  FOR:   'data-miu-for',
  INDEX: 'data-miu-index',
  KEY:   'data-miu-key',
  ON:    'data-miu-on',
};

const SEL = '@';
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
    const {store, path} = parseBindAttr(el, ATTRS.FOR);
    bindForEach(el, store, path);
  };

  // Setup all other bindings.
  const bindSelector = `[${ATTRS.BIND}]`;
  const bindElements = [
      ...(root.matches(bindSelector) ? [root] : []),
      ...root.querySelectorAll(bindSelector)
  ];
  for (const el of bindElements) {
    const {store, path, key} = parseBindAttr(el, ATTRS.BIND);
    bindElement(el, store, path, key);
  };
}

// Return context data for elements within a for loop. The data includes the
// item, the item index within the array, the store associated with the parent
// for element, and the store path to the items.
function getBindContext(element) {
  const forParent = element.parentElement.closest(`[${ATTRS.FOR}]`);
  const parentCtx = bindContexts.get(forParent);
  const idxEl = element.closest(`[${ATTRS.INDEX}]`);

  let context = {};
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

// Parse a bind or for element attribute. It is expected to be in one of these formats:
// - "<store name>.<store path>" for data binding.
// - "@[.<store path>]" for referencing array elements within a for loop.
// - "@key" for referencing object keys within a for loop.
// - "@value[.<store path>]" for referencing object values within a for loop.
// - "@index" for referencing the index within a for loop.
function parseBindAttr(el, attr) {
  const attrVal = el.getAttribute(attr);

  if (attrVal.charAt(0) === SEL) {
    // Inner loop notation
    const bindCtx = getBindContext(el);
    return resolveStoreRef(attr, attrVal, bindCtx);
  }

  const [storeName, path] = attrVal.split('.', 2);
  if (!storeName || !path) {
    throw new Error(`Invalid path format: ${storePath}`);
  }

  const store = stores.get(storeName);
  if (!store) {
    throw new Error(`Store not found: ${storeName}`);
  }

  return { store, path };
}

function resolveStoreRef(attr, ref, bindCtx) {
  // TODO: Make sure that Symbol keys are supported.

  // The store implementation simplifies the path syntax here.
  // bindCtx.path is the base path up until the element we need to resolve.
  // Since store Map elements can be accessed using bracket notation, just like objects,
  // we use the key if it's defined. Otherwise, we assume the item is an array element,
  // and retrieve it by its index (which should always be defined).
  const path = `${bindCtx.path}[${bindCtx.key || bindCtx.index}]`;

  if (ref === KEY || ref === INDEX) {
    if (attr === ATTRS.FOR) {
      throw new Error(`${ref} is unsupported for ${ATTRS.FOR}`);
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

  throw new Error(`Invalid store reference: ${ref}`);
}

function parseOnAttr(attr) {
  const parts = attr.split(':');
  if (!attr || parts.length > 2) {
    throw new Error(`Invalid attribute format: ${attr}`);
  }

  const [eventName, fnRef] = parts;
  if (!eventName || !fnRef) {
    throw new Error(`Invalid event name in: ${attr}`);
  }

  if (globalThis[fnRef]) {
    if (typeof globalThis[fnRef] !== 'function') {
      throw new Error(`${fnRef} is not a function`);
    }
    return { eventName, fn: globalThis[fnRef]};
  }

  const [storeName, path] = fnRef.split('.', 2);
  const store = stores.get(storeName);
  if (!store) {
    throw new Error(`Store not found: ${storeName}`);
  }
  const fn = store.$get(path);
  if (typeof fn !== 'function') {
    console.warn(`Function "${fullPath}" not found`);
  }

  return { eventName, fn };
}


// Attach event handlers to child elements of root. The handler method name is
// retrieved from the `data-miu-on` attribute and is expected to exist on the store.
function setupEventHandlers(root) {
  for (const el of root.querySelectorAll(`[${ATTRS.ON}]`)) {
    const attr = el.getAttribute(ATTRS.ON);
    const { eventName, fn } = parseOnAttr(attr);

    addEventHandler(el, eventName, (event) => {
      event.preventDefault();
      const bindCtx = getBindContext(el);
      fn.call(bindCtx.store, event, bindCtx);
    });
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
  if (!elementEventHandlers.get(event)) {
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

// Bind an element to the store value at path.
function bindElement(element, store, path, key) {
  let value = null;
  if (key) {
    value = key;
  } else {
    value = store.$get(path);
    if (typeof value === 'function') {
      const bindCtx = getBindContext(element);
      value = value(bindCtx);
    }
  }

  if (element.tagName === 'INPUT') {
    if (element.type === 'checkbox') {
      bindCheckbox(element, store, path, value);
    } else {
      bindInput(element, store, path, value);
    }
  } else {
    bindText(element, store, path, value);
  }
}

// Bind an input element to the store value at path.
function bindInput(element, store, path, value) {
  if (element.value !== value) {
    element.value = value;
  }
  addEventHandler(element, 'input', (e) => {
    store.$set(path, e.target.value);
  });
  storeSubscribe(element, path, () => {
    return store.$subscribe(path, (value) => {
      if (element.value !== value) {
        element.value = value;
      }
    });
  });
}

// Bind a checkbox element to the store value at path.
function bindCheckbox(element, store, path, value) {
  if (typeof value !== 'boolean') {
    console.warn(`Ignoring non-boolean value "${value}" for checkbox element`);
    return;
  }
  if (element.checked !== value) {
    element.checked = value;
  }
  addEventHandler(element, 'change', (e) => {
    store.$set(path, e.target.checked);
  });
  storeSubscribe(element, path, () => {
    return store.$subscribe(path, (value) => {
      if (element.checked !== value) {
        element.checked = value;
      }
    });
  });
}

// Bind any element's textContent to the store value at path.
function bindText(element, store, path, value) {
  if (element.textContent !== value) {
    element.textContent = value;
  }
  storeSubscribe(element, path, () => {
    return store.$subscribe(path, (value) => {
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
    throw new Error(`Value of ${path} is null or undefined`);
  }
  if (!Symbol.iterator in Object(items)) {
    throw new Error(`Value of ${path} is not iterable`);
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
    throw new Error(`${ATTRS.FOR} requires a template element`);
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
  if (!el) throw new Error('Element not found');

  for (const store of newStores) {
    if (stores.has(store.$name)) {
      throw new Error(`Store with name "${store.$name}" already exists`);
    }
    stores.set(store.$name, store);
  }

  setupBindings(el);
  setupEventHandlers(el);
}

export { bind };
