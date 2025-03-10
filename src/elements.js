import { StoreRegistry } from './store.js';

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

// Wait for DOM updates. Similar to more complex versions in Vue and Alpine.
// See https://alpinejs.dev/magics/nextTick
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

// Setup data bindings and update DOM element values.
function setupBindings(root, store) {
  // Setup for loops first as they create new elements.
  root.querySelectorAll(`[${MIU_ATTRS.FOR}]`).forEach(element => {
    bindingUtil.bindForEach(element, store);
  });

  // Setup all bindings, using a context if within a for loop.
  root.querySelectorAll(`[${MIU_ATTRS.BIND}]`).forEach(element => {
    bindingUtil.bindElement(element, store);
  });
}

// Return context data for elements within a for loop. The data includes the
// item and item index within the array.
function getBindContext(element) {
  const forParent = element.closest(`[${MIU_ATTRS.FOR}]`);
  const parentContext = bindContexts.get(forParent);
  const idx = element.closest(`[${MIU_ATTRS.INDEX}]`)?.getAttribute(MIU_ATTRS.INDEX);

  let context = {};
  if (parentContext && idx) {
    context = { item: parentContext[idx], index: idx };
  }

  return context;
}

// Attach event handlers to child elements of root. The handler method name is
// retrieved from the `data-miu-on` attribute and is expected to exist on the store.
function setupEventHandlers(root, store) {
  root.querySelectorAll(`[${MIU_ATTRS.ON}]`).forEach(element => {
    const binding = element.getAttribute(MIU_ATTRS.ON);
    const [eventName, methodName] = binding.split(':');

    if (!eventName || !methodName) {
      console.error(`Invalid event binding syntax: "${binding}". Expected "event:method"`);
      return;
    }

    if (typeof store[methodName] !== 'function') {
      console.warn(`Method "${methodName}" not found in store`);
    }

    addEventHandler(element, eventName, (event) => {
      event.preventDefault();
      const context = getBindContext(element);
      store[methodName].call(store, event, context);
    });
  });
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

// Utilities for handling element bindings
const bindingUtil = {
  bindElement(element, store) {
    // TODO: Support JSON path.
    const path = element.getAttribute(MIU_ATTRS.BIND);
    const context = getBindContext(element);

    if (element.tagName === 'INPUT') {
      if (element.type === 'checkbox') {
        this.bindCheckbox(element, store, path, context);
      } else {
        this.bindInput(element, store, path, context);
      }
    } else {
      this.bindText(element, store, path, context);
    }
  },

  bindInput(element, store, path, context) {
    const newVal = (context?.item ?? store)[path] ?? '';
    if (element.value !== newVal) {
      element.value = newVal;
    }
    addEventHandler(element, 'input', (e) => {
      (context?.item ?? store)[path] = e.target.value;
    });
    storeSubscribe(element, path, () => {
      store.subscribe(path, (value) => {
        if (element.value !== value) {
          element.value = value;
        }
      });
    });
  },

  bindCheckbox(element, store, path, context) {
    const newVal = (context?.item ?? store)[path] ?? false;
    if (element.checked !== newVal) {
      element.checked = newVal;
    }
    addEventHandler(element, 'change', (e) => {
      (context?.item ?? store)[path] = e.target.checked;
    });
    storeSubscribe(element, path, () => {
      store.subscribe(path, (value) => {
        if (element.checked !== value) {
          element.checked = value;
        }
      });
    });
  },

  bindText(element, store, path, context) {
    const newVal = (context?.item ?? store)[path] ?? '';
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
  },

  bindForEach(element, store) {
    const template = element.querySelector('template');
    if (!template) {
      console.error(`${MIU_ATTRS.FOR} requires a template element`);
      return;
    }

    const path = element.getAttribute(MIU_ATTRS.FOR);

    const render = (items) => {
      if (!Array.isArray(items)) {
        console.error(`Value of "${path}" is not an array`);
        return;
      }

      // Set the items rendered under this element. This is used to pass the
      // items and their index to all child event handlers.
      bindContexts.set(element, items);

      // Remove excess elements
      while (element.children.length - 1 > items.length) {
        element.lastElementChild.remove();
      }

      items.forEach((item, index) => {
        const el = element.children[index+1]; // +1 to account for the template
        if (!el) {
          // No element for this item, so create it.
          const clone = document.importNode(template.content, true);
          element.appendChild(clone);
          const child = element.lastElementChild;
          // Set the index of this item so that it can be passed to all child
          // event handlers.
          child.setAttribute(MIU_ATTRS.INDEX, index);
          setupBindings(child, store);
          setupEventHandlers(child, store);
        } else {
          // The element exists, so just update its index and bindings.
          el.setAttribute(MIU_ATTRS.INDEX, index);
          setupBindings(el, store);
        }
      });
    };

    store.subscribe(path, render);
    render(store[path]);
  }
};

class MiuElement extends HTMLElement {
  static observedAttributes = ['store'];

  async connectedCallback() {
    // Try to get store from parent first if no store attribute
    const storeName = this.getAttribute('store');
    const parentEl = this.closest('miu-el:not(:scope)');

    try {
      if (storeName) {
        this.store = await StoreRegistry.waitFor(storeName);
      } else if (parentEl) {
        // Inherit parent's store if no store specified
        this.store = parentEl.store;
      } else {
        throw new Error('No store found');
      }

      setupBindings(this, this.store);
      setupEventHandlers(this, this.store);

      await nextTick(); // Wait for DOM updates
      this.dispatchEvent(new CustomEvent('storeready'));
    } catch (err) {
      console.error(`Error connecting to store:`, err);
    }
  }

  // TODO: Implement
  // disconnectedCallback() {}

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'store' && oldValue && oldValue !== newValue && this.isConnected) {
      this.connectedCallback(); // Reinitialize with new store
    }
  }
}

export function initElements() {
  customElements.define('miu-el', MiuElement);
}
