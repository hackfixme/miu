import { StoreRegistry } from './store.js';

export function initElements() {
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
    }
  };

  // Main app container element
  customElements.define('miu-app', class extends HTMLElement {
    async connectedCallback() {
      const storeName = this.getAttribute('store');
      try {
        this.store = await StoreRegistry.waitFor(storeName);
        this._processBindings(this);
        this.dispatchEvent(new CustomEvent('storeready'));
      } catch (err) {
        console.error(`Error connecting to store "${storeName}":`, err);
      }
    }

    _processBindings(root) {
      root.querySelectorAll('[miu-bind]').forEach(element => {
        const path = element.getAttribute('miu-bind');
        if (element.tagName === 'INPUT') {
          bindingUtil.bindInput(element, this.store, path);
        } else {
          bindingUtil.bindText(element, this.store, path);
        }
      });

      root.querySelectorAll('[miu-on\\:click]').forEach(element => {
        const methodName = element.getAttribute('miu-on:click');
        element.addEventListener('click', (event) => {
          if (typeof this.store[methodName] === 'function') {
            this.store[methodName](event);
          }
        });
      });
    }
  });

  // List rendering element
  customElements.define('miu-list', class extends HTMLElement {
    async connectedCallback() {
      const storeName = this.closest('miu-app').getAttribute('store');
      try {
        this.store = await StoreRegistry.waitFor(storeName);
        const path = this.getAttribute('for-each');
        this.template = this.querySelector('template');

        if (!this.template) {
          console.error('miu-list requires a template element');
          return;
        }

        this._render(this.store[path]);
        this.store.subscribe(path, (items) => {
          this._render(items);
        });
      } catch (err) {
        console.error(`Error connecting to store "${storeName}":`, err);
      }
    }

    _processItemBindings(element, item, index) {
      element.querySelectorAll('[miu-bind]').forEach(el => {
        const prop = el.getAttribute('miu-bind');

        if (el.tagName === 'INPUT') {
          el.value = item[prop] || '';

          if (el.type === 'checkbox') {
            el.checked = item[prop] || false;
            el.addEventListener('change', (e) => {
              item[prop] = e.target.checked;
            });
          } else {
            el.addEventListener('input', (e) => {
              item[prop] = e.target.value;
            });
          }
        } else {
          el.textContent = item[prop] || '';
        }
      });

      element.querySelectorAll('[miu-on\\:click]').forEach(el => {
        const methodName = el.getAttribute('miu-on:click');
        el.addEventListener('click', (event) => {
          if (typeof this.store[methodName] === 'function') {
            event.preventDefault();
            this.store[methodName](event);
          }
        });
      });
    }

    _render(items) {
      const template = this.template;
      this.textContent = '';
      this.appendChild(template);

      if (Array.isArray(items)) {
        items.forEach((item, index) => {
          const clone = document.importNode(this.template.content, true);

          clone.querySelectorAll('[data-id="index"]').forEach(el => {
            el.dataset.id = index;
          });

          this._processItemBindings(clone, item, index);
          this.appendChild(clone);
        });
      }
    }
  });
}
