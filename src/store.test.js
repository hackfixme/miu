import { describe, test, expect, beforeEach } from 'vitest';
import { Store } from './store.js';

describe('Store', () => {
  const createTestStore = () => new Store('testStore', {
    user: {
      name: 'John',
      settings: {
        theme: 'light'
      }
    },
    items: ['a', 'b', 'c'],
    userMap: new Map([['u1', { role: 'admin' }]])
  });

  describe('constructor', () => {
    test('creates store with initial state', () => {
      const store = new Store('testStore', { count: 0 });
      expect(store.count).toBe(0);
    });

    test('throws error for non-string name', () => {
      expect(() => new Store(123)).toThrow('Store name must be a string');
      expect(() => new Store(null)).toThrow('Store name must be a string');
      expect(() => new Store(undefined)).toThrow('Store name must be a string');
    });

    test('creates unique stores with different names', () => {
      const store1 = new Store('store1', { value: 1 });
      const store2 = new Store('store2', { value: 2 });

      expect(store1.value).toBe(1);
      expect(store2.value).toBe(2);

      // Modifying one store shouldn't affect the other
      store1.value = 10;
      expect(store1.value).toBe(10);
      expect(store2.value).toBe(2);
    });

    test('handles falsy initial values correctly', () => {
      const store = new Store('falsyStore', {
        zero: 0,
        empty: '',
        nullValue: null,
        falseBool: false
      });

      expect(store.zero).toBe(0);
      expect(store.empty).toBe('');
      expect(store.nullValue).toBe(null);
      expect(store.falseBool).toBe(false);
    });
  });

  describe('api', () => {
    test('exposes internal methods and properties via proxy wrapper', () => {
      const store = new Store('apiStore');

      expect(store.$name).toBe('apiStore');
      expect(typeof store.$get).toBe('function');
      expect(typeof store.$set).toBe('function');
      expect(typeof store.$subscribe).toBe('function');
    });

    test('prevents modification of API properties', () => {
      const store = new Store('protectedStore');

      expect(() => { store.$name = 'newName'; }).toThrow("'$name' is read-only");
      expect(store.$name).toBe('protectedStore');

      expect(() => { store.$get = () => {} }).toThrow("'$get' is read-only");
      expect(typeof store.$get).toBe('function');
    });

    describe('$data', () => {
      test('is empty when no initial state provided', () => {
        const store = new Store('emptyStore');
        expect(store.$data).toEqual({});
      });

      test('preserves data structure but removes functions', () => {
        const initialState = {
          nested: {
            foo: 'bar',
            fn: () => false
          },
          array: [1, 2, () => true, undefined, null],
          topFn: function() { return false }
        };

        const store = new Store('complexStore', initialState);
        const data = store.$data;

        // Functions are removed from objects but preserved as undefined in arrays
        // to preserve array length and indices.
        expect(data).toEqual({
          nested: {
            foo: 'bar'
          },
          array: [1, 2, undefined, undefined, null]
        });

        // Check that functions are completely removed, not just undefined.
        expect(data.nested.hasOwnProperty('fn')).toBe(false);
        expect(data.hasOwnProperty('topFn')).toBe(false);
      });
    });

    describe('$get', () => {
      let store;
      beforeEach(() => { store = createTestStore(); });

      test('retrieves nested object values using dot notation', () => {
        expect(store.$get('user.name')).toBe('John');
        expect(store.$get('user.settings.theme')).toBe('light');
      });

      test('retrieves array values using index notation', () => {
        expect(store.$get('items[0]')).toBe('a');
        expect(store.$get('items[2]')).toBe('c');
        // Negative and out of bounds indices behave as expected
        expect(store.$get('items[-1]')).toBeUndefined();
        expect(store.$get('items[3]')).toBeUndefined();
      });

      test('retrieves Map values using key or property notation', () => {
        expect(store.$get('userMap[u1].role')).toBe('admin');
        expect(store.$get('userMap.u1.role')).toBe('admin');
      });

      test('returns undefined for non-existent paths', () => {
        expect(store.$get('user.nonexistent')).toBeUndefined();
        expect(store.$get('items[99]')).toBeUndefined();
      });
    });

    describe('$set', () => {
      let store;
      beforeEach(() => { store = createTestStore(); });

      test('sets nested object values using dot notation', () => {
        store.$set('user.name', 'Jane');
        expect(store.user.name).toBe('Jane');

        store.$set('user.settings.theme', 'dark');
        expect(store.user.settings.theme).toBe('dark');
      });

      test('sets array values using index notation', () => {
        store.$set('items[1]', 'x');
        expect(store.items[1]).toBe('x');
      });

      test('sets Map values using key or property notation', () => {
        store.$set('userMap[u1].role', 'user');
        expect(store.userMap.get('u1').role).toBe('user');
        store.$set('userMap.u1.role', 'user2');
        expect(store.userMap.get('u1').role).toBe('user2');
      });

      test('creates intermediate objects for non-existent paths', () => {
        store.$set('deeply.nested.value', 42);
        expect(store.deeply.nested.value).toBe(42);
      });

      test('throws error for invalid array indices', () => {
        expect(() => store.$set('items[-1]', 'x')).toThrow('Invalid array index: -1');
        expect(() => store.$set('items[3]', 'x')).toThrow('Invalid array index: 3');
      });
    });

    describe('$subscribe', () => {
      let store;
      beforeEach(() => { store = createTestStore(); });

      test('notifies subscribers of direct property changes', () => {
        const changes = [];

        store.$subscribe('user.name', (value) => changes.push(value));
        store.user.name = 'Jane';

        expect(changes).toEqual(['Jane']);
      });

      test('notifies subscribers of nested property changes', () => {
        const changes = [];

        store.$subscribe('user.settings.theme', (value) => changes.push(value));
        store.user.settings.theme = 'dark';

        expect(changes).toEqual(['dark']);
      });

      test('notifies subscribers of array element changes', () => {
        const changes = [];

        store.$subscribe('items[1]', (value) => changes.push(value));
        store.items[1] = 'x';

        expect(changes).toEqual(['x']);
      });

      test('notifies subscribers when array methods modify the array', () => {
        const changes = [];

        store.$subscribe('items', (value) => changes.push([...value]));
        store.items.push('d');

        expect(changes).toEqual([['a', 'b', 'c', 'd']]);
      });

      test('notifies subscribers of Map value changes', () => {
        const changes = [];

        store.$subscribe('userMap[u1].role', (value) => changes.push(value));
        store.userMap.get('u1').role = 'user';

        expect(changes).toEqual(['user']);
      });

      test('notifies Map key subscribers when using Map.set', () => {
        const changes = [];
        store.$subscribe('userMap[u2]', (value) => changes.push(value));
        store.userMap.set('u2', { role: 'guest' });
        expect(changes).toEqual([{ role: 'guest' }]);
      });

      test('notifies Map subscribers when using Map.set', () => {
        const changes = [];
        store.$subscribe('userMap', (value) => changes.push(new Map(value)));
        store.userMap.set('u2', { role: 'guest' });
        expect(changes).toEqual([
          new Map([
            ['u1', { role: 'admin' }],
            ['u2', { role: 'guest' }]
          ])
        ]);
      });

      test('notifies when using Map.delete', () => {
        const changes = [];
        store.$subscribe('userMap[u1]', (value) => changes.push(value));
        store.userMap.delete('u1');
        expect(changes).toEqual([undefined]);
      });

      test('notifies parent path when using Map.delete', () => {
        const changes = [];
        store.$subscribe('userMap', (value) => changes.push(value));
        store.userMap.delete('u1');
        expect(changes).toEqual([new Map()]);
      });

      test('does not notify on Map.delete of non-existent key', () => {
        const changes = [];
        store.$subscribe('userMap[nonexistent]', (value) => changes.push(value));
        store.userMap.delete('nonexistent');
        expect(changes).toEqual([]);
      });

      test('Map.delete returns correct boolean result', () => {
        expect(store.userMap.delete('u1')).toBe(true);
        expect(store.userMap.delete('nonexistent')).toBe(false);
      });

      test('notifies when using Map.clear', () => {
        const store = createTestStore();
        const mapChanges = [];
        const entryChanges = [];
        store.$subscribe('userMap', (value) => mapChanges.push(value));
        store.$subscribe('userMap[u1]', (value) => entryChanges.push(value));
        store.userMap.clear();
        expect(mapChanges).toEqual([new Map()]);
        expect(entryChanges).toEqual([undefined]);
      });

      test('handles nested Map operations', () => {
        const store = new Store('test', {
          mapOfMaps: new Map([
            ['m1', new Map([['key', 'value']])]
          ])
        });

        const changes = [];
        store.$subscribe('mapOfMaps[m1][key]', (value) => changes.push(value));
        store.mapOfMaps.get('m1').set('key', 'newValue');
        expect(changes).toEqual(['newValue']);

        store.$subscribe('mapOfMaps[m1]', (value) => changes.push(value));
        store.mapOfMaps.delete('m1');
        expect(changes).toEqual(['newValue', undefined]);
      });
    });
  });

  describe('state', () => {
    test('direct property access and modification', () => {
      const store = new Store('basicStore', { count: 0 });

      expect(store.count).toBe(0);
      store.count = 1;
      expect(store.count).toBe(1);
    });

    test('nested property access and modification', () => {
      const store = new Store('nestedStore', {
        user: {
          profile: {
            name: 'John',
            age: 30
          }
        }
      });

      expect(store.user.profile.name).toBe('John');
      store.user.profile.name = 'Jane';
      expect(store.user.profile.name).toBe('Jane');
    });

    test('creating nested objects when setting deep properties', () => {
      const store = new Store('deepStore', {});

      store.deep = { nested: { property: 'value' } };
      expect(store.deep.nested.property).toBe('value');
    });

    test('maintaining object references for nested properties', () => {
      const store = new Store('refStore', {
        items: { list: [1, 2, 3] }
      });

      const items = store.items;
      items.list.push(4);

      expect(store.items.list).toEqual([1, 2, 3, 4]);
    });

    test('property deletion', () => {
      const store = new Store('deleteStore', {
        user: {
          name: 'John',
          age: 30
        }
      });

      delete store.user.age;
      expect(store.user.age).toBeUndefined();
      expect('age' in store.user).toBe(false);
    });

    test('Map access', () => {
      const store = createTestStore();
      expect(store.userMap.u1.role).toBe('admin');
      expect(store.userMap['u1'].role).toBe('admin');
      expect(store.userMap.get('u1').role).toBe('admin');

      store.userMap.get('u1').role = 'user';
      expect(store.userMap.u1.role).toBe('user');
      store.userMap.u1.role = 'user2';
      expect(store.userMap.u1.role).toBe('user2');

      store.userMap.set('u1', { role: 'user3' });
      expect(store.userMap.u1.role).toBe('user3');
      store.userMap = new Map([['u1', { role: 'user4' }]]);
      expect(store.userMap.u1.role).toBe('user4');
    });
  });
});
