import { expect, describe, test, vi } from 'vitest';
import { bind } from './bind.js';
import { Store } from './store.js';
// TODO: Remove deepCopy once $data is implemented for all paths, and
// Array.length and Map.size are properly proxied.
import { deepCopy } from './util.js';

describe('bind', () => {
  test('text elements bind to store value - one-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      text: 'initial',
      text2: 'another'
    });

    document.body.innerHTML = `
      <div data-miu-bind="text:${storeName}.text"></div>
      <span data-miu-bind="text:${storeName}.text"></span>
      <p data-miu-bind="text:${storeName}.text2"></p>
    `;
    bind(document.body, [store]);

    const div = document.querySelector('div');
    const span = document.querySelector('span');
    const p = document.querySelector('p');
    expect(div.textContent).toBe('initial');
    expect(span.textContent).toBe('initial');
    expect(p.textContent).toBe('another');

    store.text = 'updated';
    expect(div.textContent).toBe('updated');
    expect(span.textContent).toBe('updated');
    expect(p.textContent).toBe('another');
  });

  test('binds to arbitrary attributes on regular elements - one-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { cls: 'initial' });

    document.body.innerHTML = `
      <div data-miu-bind="class:${storeName}.cls"></div>
    `;
    bind(document.body, [store]);

    const div = document.querySelector('div');
    expect(div.getAttribute('class')).toBe('initial');

    // Store updates element
    store.cls = 'store-update';
    expect(div.getAttribute('class')).toBe('store-update');
  });

  test('binds to arbitrary attributes on input elements - one-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { cls: 'initial' });

    document.body.innerHTML = `
      <input type="text" data-miu-bind="class:${storeName}.cls">
    `;
    bind(document.body, [store]);

    const input = document.querySelector('input');
    expect(input.getAttribute('class')).toBe('initial');

    // Store updates element
    store.cls = 'store-update';
    expect(input.getAttribute('class')).toBe('store-update');
  });

  test('text input binds to string store value - two-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'initial' });

    document.body.innerHTML = `
      <input type="text" data-miu-bind="value:${storeName}.value:on(input)">
    `;
    bind(document.body, [store]);

    const input = document.querySelector('input');
    expect(input.value).toBe('initial');

    // Store updates element
    store.value = 'store update';
    expect(input.value).toBe('store update');

    // Element updates store
    input.value = 'element update';
    input.dispatchEvent(new Event('input'));
    expect(store.value).toBe('element update');
  });

  test('number input binds to numeric store value - two-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 42 });

    document.body.innerHTML = `
      <input type="number" data-miu-bind="value:${storeName}.value:on(input)">
    `;
    bind(document.body, [store]);

    const input = document.querySelector('input');
    expect(input.value).toBe('42');

    store.value = 100;
    expect(input.value).toBe('100');

    input.value = '200';
    input.dispatchEvent(new Event('input'));
    expect(store.value).toBe('200'); // Note: Will be string unless explicitly converted
  });

  test('checkbox input binds to boolean store value - two-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { checked: true });

    document.body.innerHTML = `
      <input type="checkbox" data-miu-bind="checked:${storeName}.checked:on(change)">
    `;
    bind(document.body, [store]);

    const checkbox = document.querySelector('input');
    expect(checkbox.checked).toBe(true);

    store.checked = false;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(store.checked).toBe(true);
  });

  test('throws on invalid attribute format', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 42 });

    // Missing bind target
    document.body.innerHTML = `
      <button data-miu-bind="${storeName}.value">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`Invalid bind attribute format: ${storeName}.value`);
  });

});

describe('for', () => {
  test('handles empty arrays correctly', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: []
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li data-miu-bind="text:$.text"></li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial empty state
    let items = document.querySelectorAll('li');
    expect(items.length).toBe(0);

    // Adding items works
    store.items.push({ text: 'first item' });
    items = document.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('first item');

    // Clearing array removes all items
    // NOTE: store.items.length = 0 is not supported.
    store.items = [];
    items = document.querySelectorAll('li');
    expect(items.length).toBe(0);
  });

  test('renders array elements and handles element removal', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: [
        { text: 'item1' },
        { text: 'item2' },
      ],
      removeItem(event, context) {
        this.items.splice(context.index, 1);
      }
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <span data-miu-bind="text:$.text"></span>
            <button data-miu-on="click:${storeName}.removeItem">×</button>
          </li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial render
    let items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('span').textContent).toBe('item1');
    expect(items[1].querySelector('span').textContent).toBe('item2');

    // Store updates UI
    store.items.push({ text: 'item3' });
    items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].querySelector('span').textContent).toBe('item1');
    expect(items[1].querySelector('span').textContent).toBe('item2');
    expect(items[2].querySelector('span').textContent).toBe('item3');

    // UI event updates store and UI
    items[1].querySelector('button').click();
    expect(store.items.length).toBe(2);
    items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('span').textContent).toBe('item1');
    expect(items[1].querySelector('span').textContent).toBe('item3');
  });

  test('handles array reordering correctly', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: [
        { id: 1, text: 'first' },
        { id: 2, text: 'second' },
        { id: 3, text: 'third' }
      ]
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template><li><span data-miu-bind="text:$.id"></span>:<span data-miu-bind="text:$.text"></span></li></template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial order
    let items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('1:first');
    expect(items[1].textContent).toBe('2:second');
    expect(items[2].textContent).toBe('3:third');

    // Reverse array order
    store.items.reverse();
    items = document.querySelectorAll('li');
    expect(items[0].textContent).toBe('3:third');
    expect(items[1].textContent).toBe('2:second');
    expect(items[2].textContent).toBe('1:first');

    // Sort by text
    store.items.sort((a, b) => a.text.localeCompare(b.text));
    items = document.querySelectorAll('li');
    expect(items[0].textContent).toBe('1:first');
    expect(items[1].textContent).toBe('2:second');
    expect(items[2].textContent).toBe('3:third');
  });

  test('handles sorting with computed values', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: [
        { value: 3, computed: () => 3 * 2 },
        { value: 1, computed: () => 1 * 2 },
        { value: 2, computed: () => 2 * 2 }
      ]
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template><li><span data-miu-bind="text:$.value"></span>:<span data-miu-bind="text:$.computed"></span></li></template>
      </ul>
    `;
    bind(document.body, [store]);

    let items = document.querySelectorAll('li');
    expect(items[0].textContent).toBe('3:6');
    expect(items[1].textContent).toBe('1:2');
    expect(items[2].textContent).toBe('2:4');

    store.items.sort((a, b) => a.value - b.value);
    items = document.querySelectorAll('li');
    expect(items[0].textContent).toBe('1:2');
    expect(items[1].textContent).toBe('2:4');
    expect(items[2].textContent).toBe('3:6');
  });

  test('maintains element state through array operations', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: [
        { id: 1, text: 'first' },
        { id: 2, text: 'second' },
        { id: 3, text: 'third' }
      ]
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <input type="text" data-miu-bind="value:$.text:on(input)">
          </li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Modify an input value
    let inputs = document.querySelectorAll('input');
    inputs[1].value = 'modified';
    inputs[1].dispatchEvent(new Event('input'));

    // Sort the array
    store.items.sort((a, b) => b.id - a.id);

    // Check if the modified value persists
    inputs = document.querySelectorAll('input');
    expect(inputs[1].value).toBe('modified');
    expect(store.items[1].text).toBe('modified');
  });

  test('renders Map entries and handles entry removal', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: new Map([
        ['key1', { text: 'first' }],
        ['key2', { text: 'second' }]
      ]),
      removeItem(event, context) {
        this.items.delete(context.key);
      }
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <div><span data-miu-bind="text:$key"></span>:<span data-miu-bind="text:$value.text"></span></div>
            <button data-miu-on="click:${storeName}.removeItem">×</button>
          </li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial render
    let items = document.querySelectorAll('li > div');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key2:second');

    // Store updates UI
    store.items.set('key3', { text: 'third' });
    expect(deepCopy(store.items).size).toBe(3);
    items = document.querySelectorAll('li > div');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key2:second');
    expect(items[2].textContent).toBe('key3:third');

    // UI event updates store and UI
    document.querySelector('li:nth-of-type(2) button').click();
    expect(deepCopy(store.items).size).toBe(2);
    items = document.querySelectorAll('li > div');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key3:third');
  });

  test('renders Object entries and handles entry removal', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: {
        key1: { text: 'first' },
        key2: { text: 'second' }
      },
      removeItem(event, context) {
        delete this.items[context.key];
      }
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <div><span data-miu-bind="text:$key"></span>:<span data-miu-bind="text:$value.text"></span></div>
            <button data-miu-on="click:${storeName}.removeItem">×</button>
          </li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial render
    let items = document.querySelectorAll('li > div');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key2:second');

    // Store updates UI
    store.items.key3 = { text: 'third' };
    expect(Object.keys(store.items).length).toBe(3);
    items = document.querySelectorAll('li > div');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key2:second');
    expect(items[2].textContent).toBe('key3:third');

    // UI event updates store and UI
    document.querySelector('li:nth-of-type(2) button').click();
    expect(Object.keys(store.items).length).toBe(2);
    items = document.querySelectorAll('li > div');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key3:third');
  });

  test('renders nested arrays and objects', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      users: [
        {
          name: 'John',
          contacts: [
            { type: 'email', value: 'john@test.com' },
            { type: 'phone', value: '123-456' }
          ]
        },
        {
          name: 'Jane',
          contacts: [
            { type: 'email', value: 'jane@test.com' }
          ]
        }
      ]
    });

    document.body.innerHTML = `
      <div data-miu-for="${storeName}.users">
        <template>
          <div class="user">
            <h3 data-miu-bind="text:$.name"></h3>
            <ul data-miu-for="$.contacts">
              <template>
                <li><span data-miu-bind="text:$.type"></span>:<span data-miu-bind="text:$.value"></span></li>
              </template>
            </ul>
          </div>
        </template>
      </div>
    `;
    bind(document.body, [store]);

    const users = document.querySelectorAll('.user');
    expect(users.length).toBe(2);

    const firstUser = users[0];
    expect(firstUser.querySelector('h3').textContent).toBe('John');
    const firstUserContacts = firstUser.querySelectorAll('li');
    expect(firstUserContacts.length).toBe(2);
    expect(firstUserContacts[0].textContent).toBe('email:john@test.com');
    expect(firstUserContacts[1].textContent).toBe('phone:123-456');

    const secondUser = users[1];
    expect(secondUser.querySelector('h3').textContent).toBe('Jane');
    const secondUserContacts = secondUser.querySelectorAll('li');
    expect(secondUserContacts.length).toBe(1);
    expect(secondUserContacts[0].textContent).toBe('email:jane@test.com');
  });

  test('throws on missing template', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      value: []
    });

    document.body.innerHTML = `
      <div data-miu-for="${storeName}.value"></div>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow('data-miu-for requires a template element');
  });

  test('throws on non-iterable value', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      value: 42
    });

    document.body.innerHTML = `
      <div data-miu-for="${storeName}.value">
        <template></template>
      </div>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`Value of ${storeName}.value is not iterable`);
  });
});

describe('on', () => {
  test('handles store function handlers', () => {
    const storeName = `test-${randomString()}`;
    const storeHandler = vi.fn();
    const store = new Store(storeName, {
      handler: storeHandler
    });

    document.body.innerHTML = `
      <button data-miu-on="click:${storeName}.handler">Test</button>
    `;
    bind(document.body, [store]);

    document.querySelector('button').click();

    expect(storeHandler).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      undefined
    );
  });

  test('handles store function handlers with bind context', () => {
    const storeName = `test-${randomString()}`;
    const storeHandler = vi.fn();
    const store = new Store(storeName, {
      items: [
        { text: 'item1' },
        { text: 'item2' },
      ],
      handler: storeHandler
    });

    const globalHandler = vi.fn();
    globalThis.globalHandler = globalHandler;

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <button data-miu-on="click:${storeName}.handler">Test</button>
          </li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    document.querySelectorAll('button')[1].click();

    expect(storeHandler).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      {
        item: { text: 'item2' },
        index: '1',
        key: null,
        path: 'items',
        store: store
      }
    );
  });

  test('handles global function handlers', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName);

    const globalHandler = vi.fn();
    globalThis.globalHandler = globalHandler;

    document.body.innerHTML = `
      <button data-miu-on="click:globalHandler">Test</button>
    `;
    bind(document.body, [store]);

    document.querySelector('button').click();

    expect(globalHandler).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      undefined
    );

    delete globalThis.globalHandler;
  });

  test('handles global function handlers with bind context', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: [
        { text: 'item1' },
        { text: 'item2' },
      ],
    });

    const globalHandler = vi.fn();
    globalThis.globalHandler = globalHandler;

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <button data-miu-on="click:globalHandler">Test</button>
          </li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    document.querySelectorAll('button')[1].click();

    expect(globalHandler).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      {
        item: { text: 'item2' },
        index: '1',
        key: null,
        path: 'items',
        store: store
      }
    );

    delete globalThis.globalHandler;
  });

  test('handles multiple events on same element', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      clickCount: 0,
      mouseoverCount: 0,
      handleClick() { this.clickCount++ },
      handleMouseover() { this.mouseoverCount++ }
    });

    document.body.innerHTML = `
      <button
        data-miu-on="click:${storeName}.handleClick
                     mouseenter:${storeName}.handleMouseover">
        Test
      </button>
    `;
    bind(document.body, [store]);

    const button = document.querySelector('button');
    button.click();
    button.dispatchEvent(new Event('mouseenter'));

    expect(store.clickCount).toBe(1);
    expect(store.mouseoverCount).toBe(1);
  });

  test('handles store path triggers', () => {
    const storeName = `test-${randomString()}`;
    const handler = vi.fn();
    const store = new Store(storeName, {
      count: 0,
      handler
    });

    document.body.innerHTML = `
      <button data-miu-on="${storeName}.count:${storeName}.handler">Test</button>
    `;
    bind(document.body, [store]);

    store.count = 1;

    expect(handler).toHaveBeenCalledTimes(1);
    const [[event, value, bindCtx]] = handler.mock.calls;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('store:change');
    expect(event.detail).toEqual({ path: 'count' });
    expect(value).toBe(1);
    expect(bindCtx).toBeUndefined();
  });

  test('throws on invalid event format', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {});

    document.body.innerHTML = `
      <button data-miu-on="click:store:func">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow('Invalid on attribute format: click:store:func');
  });

  test('throws when store handler reference is not a function', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {});

    document.body.innerHTML = `
      <button data-miu-on="click:${storeName}.nonexistentHandler">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`${storeName}.nonexistentHandler is not a function`);
  });

  test('throws when global handler reference is not a function', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {});

    globalThis.notAFunction = 'string';
    document.body.innerHTML = `
      <button data-miu-on="click:notAFunction">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow('notAFunction is not a function');

    delete globalThis.notAFunction;
  });
});

function randomString() {
  return Math.random().toString(36).substring(2, 10);
}
