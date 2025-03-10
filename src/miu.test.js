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
});
