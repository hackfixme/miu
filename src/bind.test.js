import { expect, describe, test } from 'vitest';
import { bind } from './bind.js';
import { Store } from './store.js';

describe('bind', () => {
  test('text input binds to string store value', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 'initial' });

    document.body.innerHTML = `
      <input type="text" data-miu-bind="${storeName}.value">
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

  test('number input binds to numeric store value', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { value: 42 });

    document.body.innerHTML = `
      <input type="number" data-miu-bind="${storeName}.value">
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

  test('checkbox input binds to boolean store value', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { checked: true });

    document.body.innerHTML = `
      <input type="checkbox" data-miu-bind="${storeName}.checked">
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

  test('text elements bind to store value', () => {
    const storeName = `test-${randomString()}`;
    const store = new Store(storeName, { text: 'initial' });

    document.body.innerHTML = `
      <div data-miu-bind="${storeName}.text"></div>
      <span data-miu-bind="${storeName}.text"></span>
    `;
    bind(document.body, [store]);

    const div = document.querySelector('div');
    const span = document.querySelector('span');
    expect(div.textContent).toBe('initial');
    expect(span.textContent).toBe('initial');

    store.text = 'updated';
    expect(div.textContent).toBe('updated');
    expect(span.textContent).toBe('updated');
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
          <li data-miu-bind="@.text"></li>
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

  test('binds array items and handles item removal', () => {
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
            <span data-miu-bind="@.text"></span>
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
        <template><li><span data-miu-bind="@.id"></span>:<span data-miu-bind="@.text"></span></li></template>
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
        <template><li><span data-miu-bind="@.value"></span>:<span data-miu-bind="@.computed"></span></li></template>
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
            <input type="text" data-miu-bind="@.text">
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
});

function randomString() {
  return Math.random().toString(36).substring(2, 10);
}
