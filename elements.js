import { StoreRegistry } from './store.js';

const MIU_ATTRS = {
  BIND: 'data-miu-bind',
  FOR: 'data-miu-for',
  ON_CLICK: 'data-miu-click'
};

function processBindings(root, store, context = null) {
  root.querySelectorAll(`[${MIU_ATTRS.BIND}]`).forEach(element => {
    // TODO: Support JSON path
    const path = element.getAttribute(MIU_ATTRS.BIND);
    if (context) {
      // For array elements
      if (element.tagName === 'INPUT') {
        element.value = context[path] || '';
        if (element.type === 'checkbox') {
          element.checked = context[path] || false;
          element.addEventListener('change', (e) => {
            context[path] = e.target.checked;
          });
        } else {
          element.addEventListener('input', (e) => {
            context[path] = e.target.value;
          });
        }
      } else {
        element.textContent = context[path] || '';
      }
    } else {
      // Normal binding
      if (element.tagName === 'INPUT') {
        bindingUtil.bindInput(element, store, path);
      } else {
        bindingUtil.bindText(element, store, path);
      }
    }
  });

  root.querySelectorAll(`[${MIU_ATTRS.ON_CLICK}]`).forEach(element => {
    const methodName = element.getAttribute(MIU_ATTRS.ON_CLICK);
    element.addEventListener('click', (event) => {
      if (typeof store[methodName] === 'function') {
        event.preventDefault();
        store[methodName](event);
      }
    });
  });
}

// Utilities for handling element bindings
const bindingUtil = {
  bindInput(element, store, path) {
    element.value = store[path] || '';
    element.addEventListener('input', (e) => {
      store[path] = e.target.value;
    });
    store.subscribe(path, (value) => {
      if (element.value !== value) {
        element.value = value;
      }
    });
  },

  bindText(element, store, path) {
    element.textContent = store[path] || '';
    store.subscribe(path, (value) => {
      element.textContent = value;
    });
  },

  bindForEach(element, store, path) {
    const template = element.querySelector('template');
    if (!template) {
      console.error(`${MIU_ATTRS.FOR} requires a template element`);
      return;
    }

    const render = (items) => {
      // Preserve the template
      element.textContent = '';
      element.appendChild(template);

      if (Array.isArray(items)) {
        items.forEach((item, index) => {
          const clone = document.importNode(template.content, true);

          clone.querySelectorAll('[data-id="index"]').forEach(el => {
            el.dataset.id = index;
          });

          processBindings(clone, store, item);
          element.appendChild(clone);
        });
      }
    };

    render(store[path]);
    store.subscribe(path, render);
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

      // Process for bindings first
      this.querySelectorAll(`[${MIU_ATTRS.FOR}]`).forEach(element => {
        const path = element.getAttribute(MIU_ATTRS.FOR);
        bindingUtil.bindForEach(element, this.store, path);
      });

      // Process regular bindings
      processBindings(this, this.store);

      this.dispatchEvent(new CustomEvent('storeready'));
    } catch (err) {
      console.error(`Error connecting to store:`, err);
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'store' && oldValue && oldValue !== newValue && this.isConnected) {
      this.connectedCallback(); // Reinitialize with new store
    }
  }
}

export function initElements() {
  customElements.define('miu-el', MiuElement);
}
