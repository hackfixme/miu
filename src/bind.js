import { stores } from './store.js';

const MIU_ATTRS = {
  BIND:  'data-miu-bind',
  FOR:   'data-miu-for',
  INDEX: 'data-miu-index',
  ON:    'data-miu-on',
};

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
  for (const el of root.querySelectorAll(`[${MIU_ATTRS.FOR}]`)) {
    const attr = parseAttr(el.getAttribute(MIU_ATTRS.FOR));
    bindForEach(el, attr.store, attr.path);
  };

  // Setup all other bindings.
  for (const el of root.querySelectorAll(`[${MIU_ATTRS.BIND}]`)) {
    const attr = parseAttr(el.getAttribute(MIU_ATTRS.BIND));
    bindElement(el, attr.store, attr.path);
  };
}

// Return context data for elements within a for loop. The data includes the
// item, the item index within the array, the store associated with the parent
// for element, and the store path to the items.
function getBindContext(element) {
  const forParent = element.closest(`[${MIU_ATTRS.FOR}]`);
  const parentCtx = bindContexts.get(forParent);
  const idx = element.closest(`[${MIU_ATTRS.INDEX}]`)?.getAttribute(MIU_ATTRS.INDEX);

  let context = {};
  if (parentCtx?.store && idx) {
    context = {
      item: parentCtx.items[idx],
      index: idx,
      store: parentCtx.store,
      path: parentCtx.path,
    };
  }

  return context;
}

// Parse an element attribute. It is expected to be in one of these formats:
// - "<event>:<function name>" for event handling,
// - "<store name>.<store path>" for data binding,
// - "@.<store path>" for elements within a for loop. The @ refers to the item
//   in the current iteration.
//
// It returns an object with `eventName`, `store` and `path` properties. Only `path`
// is guaranteed to be defined.
// TODO: Handle @index.
function parseAttr(attr) {
  const parts = attr.split(':');
  if (parts.length > 2) {
    throw new Error(`Invalid attribute format: ${attr}`);
  }

  if (parts.length === 1) {
    return parseStorePath(attr);
  }

  const [eventName, storePath] = parts;
  if (!eventName) {
    throw new Error(`Invalid event name in: ${attr}`);
  }

  return { eventName, ...parseStorePath(storePath) };
}

// Parse a store path in the format "<store name>.<store path>". If the store
// exists, returns the store instance and path without the store name.
function parseStorePath(storePath) {
  const [storeName, ...pathParts] = storePath.split('.');
  if (!storeName || pathParts.length === 0) {
    throw new Error(`Invalid path format: ${storePath}`);
  }

  if (storeName === '@') {
    // Inner loop notation. Will be resolved externally.
    return { path: pathParts.join('.') };
  }

  const store = stores.get(storeName);
  if (!store) {
    throw new Error(`Store not found: ${storeName}`);
  }

  return { store, path: pathParts.join('.') };
}

// Attach event handlers to child elements of root. The handler method name is
// retrieved from the `data-miu-on` attribute and is expected to exist on the store.
function setupEventHandlers(root) {
  for (const el of root.querySelectorAll(`[${MIU_ATTRS.ON}]`)) {
    const attr = el.getAttribute(MIU_ATTRS.ON);
    const { eventName, store, path } = parseAttr(attr);
    const fullPath = `${store._name}.${path}`;

    if (!eventName || !path) {
      throw new (`Invalid event binding: "${attr}"`);
    }

    const fn = store._get(path);
    if (typeof fn !== 'function') {
      console.warn(`Function "${fullPath}" not found`);
    }

    addEventHandler(el, eventName, (event) => {
      event.preventDefault();
      const context = getBindContext(el);
      fn.call(store, event, context);
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
  if (!elementStoreSubs.get(path)) {
    const unsub = subFn();
    elementStoreSubs.set(element, unsub);
  }
}

// Bind an element to the store value at path.
function bindElement(element, store, path) {
  if (!store) {
    // This element might be inside a loop. Try getting its parent context.
    const ctx = getBindContext(element);
    store = ctx.store;
    path = `${ctx.path}[${ctx.index}].${path}`;
  }

  if (element.tagName === 'INPUT') {
    if (element.type === 'checkbox') {
      bindCheckbox(element, store, path);
    } else {
      bindInput(element, store, path);
    }
  } else {
    bindText(element, store, path);
  }
}

// Bind an input element to the store value at path.
function bindInput(element, store, path) {
  const newVal = store._get(path);
  if (element.value !== newVal) {
    element.value = newVal;
  }
  addEventHandler(element, 'input', (e) => {
    store._set(path, e.target.value);
  });
  storeSubscribe(element, path, () => {
    store.subscribe(path, (value) => {
      if (element.value !== value) {
        element.value = value;
      }
    });
  });
}

// Bind a checkbox element to the store value at path.
function bindCheckbox(element, store, path) {
  const newVal = store._get(path);
  if (element.checked !== newVal) {
    element.checked = newVal;
  }
  addEventHandler(element, 'change', (e) => {
    store._set(path, e.target.checked);
  });
  storeSubscribe(element, path, () => {
    store.subscribe(path, (value) => {
      if (element.checked !== value) {
        element.checked = value;
      }
    });
  });
}

// Bind any element's textContent to the store value at path.
function bindText(element, store, path, context) {
  const newVal = store._get(path);
  if (element.textContent !== newVal) {
    element.textContent = newVal;
  }
  storeSubscribe(element, path, () => {
    store.subscribe(path, (value) => {
      if (element.textContent !== value) {
        element.textContent = value;
      }
    });
  });
}

// Iterate over array items from the store at path, creating or removing elements
// as needed. Bindings and event handlers are also created for child elements.
// This attempts to render elements efficiently, by reusing ones that already exist.
function bindForEach(element, store, path) {
  const template = element.firstElementChild;
  if (!(template instanceof HTMLTemplateElement)) {
    // TODO: Maybe loosen this restriction? It should be possible to loop over
    // an array without filling a template.
    throw new Error(`${MIU_ATTRS.FOR} requires a template element`);
  }

  const fullPath = `${store._name}.${path}`;

  const render = (items) => {
    if (!Array.isArray(items)) {
      throw new Error(`Value of "${fullPath}" is not an array`);
    }

    // Set the context for this loop. This is used for binding child elements
    // and is passed to child event handlers.
    bindContexts.set(element, { store, path, items });

    // Remove excess elements
    while (element.children.length - 1 > items.length) {
      element.lastElementChild.remove();
    }

    items.forEach((item, index) => {
      // TODO: Filter only elements managed by Miu, to allow other elements to
      // exist within the for-loop container.
      const el = element.children[index+1]; // +1 to account for the template
      if (!el) {
        // No element for this item, so create it.
        const clone = document.importNode(template.content, true);
        element.appendChild(clone);
        const child = element.lastElementChild;
        // Set the index of this item so that it can be passed to all child
        // event handlers.
        child.setAttribute(MIU_ATTRS.INDEX, index);
        setupBindings(child);
        setupEventHandlers(child);
      } else {
        // The element exists, so just update its index and bindings.
        el.setAttribute(MIU_ATTRS.INDEX, index);
        setupBindings(el);
      }
    });
  };

  store.subscribe(path, render);
  render(store._get(path));
}

// Bind an element and its children to the given stores. element can either be a
// CSS selector or an HTMLElement.
function bind(element, newStores) {
  const el = typeof element === 'string' ? document.querySelector(element) : element;
  if (!el) throw new Error('Element not found');

  for (const store of newStores) {
    if (stores.has(store._name)) {
      throw new Error(`Store with name "${store._name}" already exists`);
    }
    stores.set(store._name, store);
  }

  setupBindings(el);
  setupEventHandlers(el);
}

export { bind };
