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
});

function randomString() {
  return Math.random().toString(36).substring(2, 10);
}
