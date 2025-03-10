import { expect, describe, test } from 'vitest';
import { Store } from './miu.js';

function randomString() {
  return Math.random().toString(36).substring(2, 10);
}

describe('Miu data binding', () => {
  test('store updates element value', async () => {
    const storeID = randomString();
    const store = new Store(`test-${storeID}`, { value: 'before' });

    document.body.innerHTML = `
      <miu-el store="test-${storeID}">
        <input data-miu-bind="value">
      </miu-el>
    `;
    await customElements.whenDefined('miu-el');

    const input = document.querySelector('input');
    expect(input.value).toBe('before');
    store.value = 'after';
    expect(input.value).toBe('after');
  });

  test('element updates store value', async () => {
    const storeID = randomString();
    const store = new Store(`test-${storeID}`, { value: 'before' });

    document.body.innerHTML = `
      <miu-el store="test-${storeID}">
        <input data-miu-bind="value">
      </miu-el>
    `;
    await customElements.whenDefined('miu-el');

    expect(store.value).toBe('before');
    const input = document.querySelector('input');
    input.value = 'after';
    input.dispatchEvent(new Event('input'));
    expect(store.value).toBe('after');
  });

  test('array elements are reactive', async () => {
    const storeID = randomString();
    const store = new Store(`test-${storeID}`, {
      items: [
        { text: 'item1' },
        { text: 'item2' },
      ],
      removeItem(event, context) {
        this.items.splice(context.index, 1);
      }
    });

    document.body.innerHTML = `
      <miu-el store="test-${storeID}">
        <ul data-miu-for="items">
          <template>
            <li>
              <span data-miu-bind="text"></span>
              <button data-miu-on="click:removeItem">×</button>
            </li>
          </template>
        </ul>
      </miu-el>
    `;
    await customElements.whenDefined('miu-el');

    // Check initial render
    let items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('span').textContent).toBe('item1');
    expect(items[1].querySelector('span').textContent).toBe('item2');

    // Test store mutation
    store.items.push({ text: 'item3' });
    items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].querySelector('span').textContent).toBe('item1');
    expect(items[1].querySelector('span').textContent).toBe('item2');
    expect(items[2].querySelector('span').textContent).toBe('item3');

    // Test UI deletion
    items[1].querySelector('button').click();
    expect(store.items.length).toBe(2);
    items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('span').textContent).toBe('item1');
    expect(items[1].querySelector('span').textContent).toBe('item3');
  });
});
