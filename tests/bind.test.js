import { expect, describe, test, vi } from 'vitest';
import { bind } from '../src/bind.js';
import { Store } from '../src/store.js';

describe('bind element', () => {
  test('text elements bind to store value - one-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      text: 'initial',
      text2: 'another'
    });

    document.body.innerHTML = `
      <div data-miu-bind="${storeName}.text->text"></div>
      <span data-miu-bind="${storeName}.text->text"></span>
      <p data-miu-bind="${storeName}.text2->text"></p>
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
      <div data-miu-bind="${storeName}.cls->class"></div>
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
      <input type="text" data-miu-bind="${storeName}.cls->class">
    `;
    bind(document.body, [store]);

    const input = document.querySelector('input');
    expect(input.getAttribute('class')).toBe('initial');

    // Store updates element
    store.cls = 'store-update';
    expect(input.getAttribute('class')).toBe('store-update');
  });

  test('text elements bind to array length - one-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: ['item1', 'item2'],
    });

    document.body.innerHTML = `
      <span data-miu-bind="${storeName}.items.length->text"></span>
    `;
    bind(document.body, [store]);

    const span = document.querySelector('span');
    expect(span.textContent).toBe('2');

    store.items.push('item3');
    expect(span.textContent).toBe('3');
  });

  test('text input binds to string store value - two-way', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'initial' });

    document.body.innerHTML = `
      <input type="text" data-miu-bind="${storeName}.value<->value@input">
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
      <input type="number" data-miu-bind="${storeName}.value<->value@input">
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
      <input type="checkbox" data-miu-bind="${storeName}.checked<->checked@change">
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

  test('preserves child elements when setting text content', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      user: 'Alice',
    });

    document.body.innerHTML = `
      <div data-miu-bind="${storeName}.user->text"><span>Bob</span></div>
    `;
    bind(document.body, [store]);

    const parentEl = document.querySelector('div');
    const childEl = document.querySelector('span');
    expect(parentEl.textContent).toBe('AliceBob');
    expect(childEl.textContent).toBe('Bob');
  });

  test('supports multiple one-way bindings', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      text: 'initial text',
      cls: 'initial-class',
      title: 'initial title'
    });

    document.body.innerHTML = `
      <div data-miu-bind="${storeName}.text->text
                          ${storeName}.cls->class
                          ${storeName}.title->title"></div>
    `;
    bind(document.body, [store]);

    const div = document.querySelector('div');
    expect(div.textContent).toBe('initial text');
    expect(div.getAttribute('class')).toBe('initial-class');
    expect(div.getAttribute('title')).toBe('initial title');

    store.text = 'updated text';
    store.cls = 'updated-class';
    expect(div.textContent).toBe('updated text');
    expect(div.getAttribute('class')).toBe('updated-class');
    expect(div.getAttribute('title')).toBe('initial title');
  });

  test('supports multiple two-way bindings', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      value: 'initial value',
      placeholder: 'initial placeholder'
    });

    document.body.innerHTML = `
      <input type="text"
             data-miu-bind="${storeName}.value<->value@input
                           ${storeName}.placeholder<->placeholder@change">
    `;
    bind(document.body, [store]);

    const input = document.querySelector('input');
    expect(input.value).toBe('initial value');
    expect(input.placeholder).toBe('initial placeholder');

    // Store updates element
    store.value = 'updated value';
    store.placeholder = 'updated placeholder';
    expect(input.value).toBe('updated value');
    expect(input.placeholder).toBe('updated placeholder');

    // Element updates store
    input.value = 'element value';
    input.dispatchEvent(new Event('input'));
    expect(store.value).toBe('element value');

    input.placeholder = 'element placeholder';
    input.dispatchEvent(new Event('change'));
    expect(store.placeholder).toBe('element placeholder');

    // The other store value remains unchanged
    expect(store.value).toBe('element value');
  });

  test('supports mix of one-way and two-way bindings', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      value: 'initial value',
      cls: 'initial-class'
    });

    document.body.innerHTML = `
      <input type="text"
             data-miu-bind="${storeName}.value<->value@input
                           ${storeName}.cls->class">
    `;
    bind(document.body, [store]);

    const input = document.querySelector('input');
    expect(input.value).toBe('initial value');
    expect(input.getAttribute('class')).toBe('initial-class');

    // Store updates both
    store.value = 'updated value';
    store.cls = 'updated-class';
    expect(input.value).toBe('updated value');
    expect(input.getAttribute('class')).toBe('updated-class');

    // Element only updates two-way binding
    input.value = 'element value';
    input.dispatchEvent(new Event('input'));
    expect(store.value).toBe('element value');

    input.setAttribute('class', 'element-class');
    expect(store.cls).toBe('updated-class'); // unchanged
  });

  test('supports binding different stores to different elements', () => {
    const storeName1 = `test-${randomString()}`;
    const store1 = new Store(storeName1, {
      parent: 'Alice'
    });
    const storeName2 = `test-${randomString()}`;
    const store2 = new Store(storeName2, {
      parent: 'Bob',
      child: 'Charlie'
    });

    document.body.innerHTML = `
      <span id="el1" data-miu-bind="${storeName1}.parent->text"></span>
      <div  id="el2" data-miu-bind="${storeName2}.parent->text"><span data-miu-bind="${storeName2}.child->text"></span></div>
    `;
    bind('#el1', [store1]);
    bind('#el2', [store2]);
    bind('#el2 > span', [store2]);

    const el1 = document.querySelector('#el1');
    const el2 = document.querySelector('#el2');
    const el2Child = document.querySelector('#el2 > span');

    // Check initial render
    expect(el1.textContent).toBe('Alice');
    expect(el2.textContent).toBe('BobCharlie');
    expect(el2Child.textContent).toBe('Charlie');

    // Store updates UI
    store2.child = 'Charlie updated'
    expect(el1.textContent).toBe('Alice');
    expect(el2.textContent).toBe('BobCharlie updated');
    expect(el2Child.textContent).toBe('Charlie updated');

    store2.parent = 'Bob updated'
    expect(el1.textContent).toBe('Alice');
    expect(el2.textContent).toBe('Bob updatedCharlie updated');
    expect(el2Child.textContent).toBe('Charlie updated');
  });

  test('supports style bindings', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      color: '#ff0000',
      bgColor: '#00ff00'
    });

    document.body.innerHTML = `
      <p data-miu-bind="
         ${storeName}.color->style.color
         ${storeName}.bgColor->style.backgroundColor
         "></p>
    `;
    bind(document.body, [store]);

    // Check initial render
    const item = document.querySelector('p');
    expect(item.style.color).toBe('rgb(255, 0, 0)');
    expect(item.style.backgroundColor).toBe('rgb(0, 255, 0)');

    // Store updates UI
    store.color = '#0000ff';
    expect(item.style.color).toBe('rgb(0, 0, 255)');
    expect(item.style.backgroundColor).toBe('rgb(0, 255, 0)');
  });

  test('supports computed values', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      value: 1,
      textValue() {
        return this.value;
      }
    });

    document.body.innerHTML = `
      <p data-miu-bind="${storeName}.textValue->text"></p>
    `;
    bind(document.body, [store]);

    // Check initial render
    const item = document.querySelector('p');
    expect(item.textContent).toBe('1');

    // Store updates UI
    store.value = 2;
    // Ideally the above value change should be enough to trigger the UI update,
    // but since dependencies in computed values aren't being tracked yet, we
    // need to manually update the function path itself for the trigger.
    store.textValue = store.textValue;
    expect(item.textContent).toBe('2');
  });

  test('throws on two-way binding without event', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'test' });

    document.body.innerHTML = `
      <input data-miu-bind="${storeName}.value<->value">
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`Two-way binding requires @event: ${storeName}.value<->value`);
  });

  test('throws on two-way binding with empty event', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'test' });

    document.body.innerHTML = `
      <input data-miu-bind="${storeName}.value<->value@">
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`Two-way binding requires both target and event: ${storeName}.value<->value@`);
  });

  test('throws on two-way binding with empty target', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'test' });

    document.body.innerHTML = `
      <input data-miu-bind="${storeName}.value<->@input">
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`Two-way binding requires both target and event: ${storeName}.value<->@input`);
  });

  test('throws on one-way binding with event', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'test' });

    document.body.innerHTML = `
      <input data-miu-bind="${storeName}.value->value@input">
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`One-way binding should not specify @event: ${storeName}.value->value@input`);
  });
});

describe('bind event', () => {
  test('supports store function handlers', () => {
    const storeName = `test-${randomString()}`;
    const storeHandler = vi.fn();
    const store = new Store(storeName, {
      handler: storeHandler
    });

    document.body.innerHTML = `
      <button data-miu-bind="${storeName}.handler@click">Test</button>
    `;
    bind(document.body, [store]);

    document.querySelector('button').click();

    expect(storeHandler).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      undefined
    );
  });

  test('supports store function handlers with bind context', () => {
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
            <button data-miu-bind="${storeName}.handler@click">Test</button>
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
        store: store,
        element: expect.any(HTMLElement),
      }
    );
  });

  test('supports global function handlers', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName);

    const globalHandler = vi.fn();
    globalThis.globalHandler = globalHandler;

    document.body.innerHTML = `
      <button data-miu-bind="globalHandler@click">Test</button>
    `;
    bind(document.body, [store]);

    document.querySelector('button').click();

    expect(globalHandler).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      undefined
    );

    delete globalThis.globalHandler;
  });

  test('supports global function handlers with bind context', () => {
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
            <button data-miu-bind="globalHandler@click">Test</button>
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
        store: store,
        element: expect.any(HTMLElement),
      }
    );

    delete globalThis.globalHandler;
  });

  test('supports multiple events on same element', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      clickCount: 0,
      mouseoverCount: 0,
      handleClick() { this.clickCount++ },
      handleMouseover() { this.mouseoverCount++ }
    });

    document.body.innerHTML = `
      <button
        data-miu-bind="${storeName}.handleClick@click
                       ${storeName}.handleMouseover@mouseenter">
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

  test('supports store path triggers', () => {
    const storeName = `test-${randomString()}`;
    const handler = vi.fn();
    const store = new Store(storeName, {
      count: 0,
      handler
    });

    document.body.innerHTML = `
      <button data-miu-bind="${storeName}.handler@${storeName}.count">Test</button>
    `;
    bind(document.body, [store]);

    store.count = 1;

    expect(handler).toHaveBeenCalledTimes(1);
    const [[event, bindCtx, value]] = handler.mock.calls;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('store:change');
    expect(event.detail).toEqual({ path: 'count' });
    expect(value).toBe(1);
    expect(bindCtx).toBeUndefined();
  });

  test('removes store subscriptions of removed elements', () => {
    const storeName = `test-${randomString()}`;

    let onSelectedCalls = 0;
    const store = new Store(storeName, {
      items: [1, 2],
      selected: '',
      onSelected() {
        onSelectedCalls++;
      },
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li data-miu-bind="$->text ${storeName}.onSelected@${storeName}.selected"></li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial render
    let items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('1');
    expect(items[1].textContent).toBe('2');
    expect(onSelectedCalls).toBe(0);

    // Update the watched value, which triggers the 2 subscriptions.
    store.selected = 'val1';
    expect(onSelectedCalls).toBe(2);

    // Remove the last element.
    store.items.splice(1);
    items = document.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('1');
    expect(onSelectedCalls).toBe(2);

    // When the element is deleted, its subscriptions should be deleted as well.
    // So this update should trigger a single call from the existing element.
    store.selected = 'val2';
    expect(onSelectedCalls).toBe(3);

    // When all elements are deleted, all their subscriptions should be deleted as well.
    store.items.length = 0;
    items = document.querySelectorAll('li');
    expect(items.length).toBe(0);
    store.selected = 'val3';
    expect(onSelectedCalls).toBe(3);
  });

  test('throws on invalid event binding syntax', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 42 });

    // Missing bind target
    document.body.innerHTML = `
      <button data-miu-bind="${storeName}.value">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`Invalid event binding syntax: ${storeName}.value`);
  });

  test('throws when store handler reference is not a function', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {});

    document.body.innerHTML = `
      <button data-miu-bind="${storeName}.nonexistentHandler@click">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow(`${storeName}.nonexistentHandler is not a function`);
  });

  test('throws when global handler reference is not a function', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {});

    globalThis.notAFunction = 'string';
    document.body.innerHTML = `
      <button data-miu-bind="notAFunction@click">Test</button>
    `;

    expect(() => bind(document.body, [store]))
      .toThrow('notAFunction is not a function');

    delete globalThis.notAFunction;
  });
});

describe('for', () => {
  test('renders primitive array elements', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: ['item1', 'item2'],
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li data-miu-bind="$->text"></li>
        </template>
      </ul>
    `;
    bind(document.body, [store]);

    // Check initial render
    let items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('item1');
    expect(items[1].textContent).toBe('item2');

    // Store updates UI
    store.items[1] = 'item2 - updated'
    expect(items[1].textContent).toBe('item2 - updated');

    store.items.push('item3');
    items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('item1');
    expect(items[1].textContent).toBe('item2 - updated');
    expect(items[2].textContent).toBe('item3');
  });

  test('supports empty arrays correctly', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      items: []
    });

    document.body.innerHTML = `
      <ul data-miu-for="${storeName}.items">
        <template>
          <li data-miu-bind="$.text->text"></li>
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

  test('renders array elements and handles array updates', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, {
      itemName: '',
      items: [
        { text: 'item1' },
        { text: 'item2' },
      ],
      addItem() {
        this.items.push({ name: this.itemName });
        this.itemName = '';
      },
      removeItem(event, context) {
        this.items.splice(context.index, 1);
      }
    });

    document.body.innerHTML = `
      <input data-miu-bind="${storeName}.itemName<->value@input">
      <ul data-miu-for="${storeName}.items">
        <template>
          <li>
            <span data-miu-bind="$.text->text"></span>
            <button data-miu-bind="${storeName}.removeItem@click">×</button>
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

    // A store method call should update both the store and the UI.
    const input = document.querySelector('input');
    input.value = 'newItem';
    store.addItem();
    expect(store.items.length).toBe(3);
    items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(input.value).toBe('');
  });

  test('supports array reordering correctly', () => {
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
        <template><li><span data-miu-bind="$.id->text"></span>:<span data-miu-bind="$.text->text"></span></li></template>
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

  test('supports sorting with computed values', () => {
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
        <template><li><span data-miu-bind="$.value->text"></span>:<span data-miu-bind="$.computed->text"></span></li></template>
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
            <input type="text" data-miu-bind="$.text<->value@input">
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
            <div><span data-miu-bind="$key->text"></span>:<span data-miu-bind="$value.text->text"></span></div>
            <button data-miu-bind="${storeName}.removeItem@click">×</button>
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
    expect(store.items.size).toBe(3);
    items = document.querySelectorAll('li > div');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('key1:first');
    expect(items[1].textContent).toBe('key2:second');
    expect(items[2].textContent).toBe('key3:third');

    // UI event updates store and UI
    document.querySelector('li:nth-of-type(2) button').click();
    expect(store.items.size).toBe(2);
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
            <div><span data-miu-bind="$key->text"></span>:<span data-miu-bind="$value.text->text"></span></div>
            <button data-miu-bind="${storeName}.removeItem@click">×</button>
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
            <h3 data-miu-bind="$.name->text"></h3>
            <ul data-miu-for="$.contacts">
              <template>
                <li><span data-miu-bind="$.type->text"></span>:<span data-miu-bind="$.value->text"></span></li>
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

function randomString() {
  return Math.random().toString(36).substring(2, 10);
}
