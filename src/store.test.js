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

  const testInvalidPathSyntax = (method, ...args) => {
    const store = createTestStore();
    describe('invalid path syntax', () => {
      test.each([
        ['empty brackets', 'items[]'],
        ['unclosed brackets', 'userMap[key'],
        ['consecutive dots', 'user..name'],
        ['leading dot', '.user.name'],
        ['trailing dot', 'user.name.'],
        ['starting number', '1user.name'],
        ['containing hyphen', 'users-2.name'],
      ])('%s', (_, path) => {
        expect(() => {
          store[method](path, ...args);
        }).toThrow('Invalid path syntax');
      });
    });
  };

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

      test('returns data for nested values', () => {
        const store = createTestStore();
        expect(store.user.$data).toEqual({
          name: 'John',
          settings: {
            theme: 'light'
          }
        });
        expect(store.items.$data).toEqual(['a', 'b', 'c']);
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

      test('retrieves array length', () => {
        expect(store.$get('items.length')).toBe(3);
      });

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

      testInvalidPathSyntax('$get');
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

      test('allows setting Array.length', () => {
        store.items.length = 2;
        expect(store.items).toEqual(['a', 'b']);
        store.$set('items.length', 1);
        expect(store.items).toEqual(['a']);

        store.$set('items.length', 5);
        expect(store.items).toEqual(['a', undefined, undefined, undefined, undefined]);
      });

      test('throws error for invalid array indices', () => {
        expect(() => store.$set('items[-1]', 'x')).toThrow('Invalid array index: -1');
        expect(() => store.$set('items[999]', 'x')).toThrow('Invalid array index: 999');
      });

      test('throws error when setting Map.size', () => {
        expect(() => store.$set('userMap.size', 0))
          .toThrow('Cannot set property size of #<Map> which has only a getter');
      });

      testInvalidPathSyntax('$set', '');
    });

    describe('$subscribe', () => {
      let store;
      beforeEach(() => { store = createTestStore(); });

      const testSubscription = ({ name, path, operation, expectedChanges }) => {
        test(name, () => {
          const changes = [];
          const unsubscribe = store.$subscribe(path, value => changes.push(value));

          // Test subscription
          operation();
          expect(changes).toEqual(expectedChanges);

          // Test unsubscribe
          changes.length = 0;
          unsubscribe();
          operation();
          expect(changes).toEqual([]);
        });
      };

      testSubscription({
        name: 'notifies on direct property changes',
        path: 'user.name',
        operation: () => { store.user.name = 'Jane'; },
        expectedChanges: ['Jane']
      });

      testSubscription({
        name: 'notifies on nested property changes',
        path: 'user.settings.theme',
        operation: () => { store.user.settings.theme = 'dark'; },
        expectedChanges: ['dark']
      });

      testSubscription({
        name: 'notifies on array element changes',
        path: 'items[1]',
        operation: () => { store.items[1] = 'x'; },
        expectedChanges: ['x']
      });

      testSubscription({
        name: 'notifies parent on array element changes',
        path: 'items',
        operation: () => { store.items[0] = 'x'; },
        expectedChanges: [['x', 'b', 'c']]
      });

      testSubscription({
        name: 'notifies on array push operation',
        path: 'items',
        operation: () => { store.items.push('d'); },
        expectedChanges: [['a', 'b', 'c', 'd']]
      });

      testSubscription({
        name: 'notifies on array pop operation',
        path: 'items',
        operation: () => { store.items.pop(); },
        expectedChanges: [['a', 'b']]
      });

      testSubscription({
        name: 'notifies on array shift operation',
        path: 'items',
        operation: () => { store.items.shift(); },
        expectedChanges: [['b', 'c']]
      });

      testSubscription({
        name: 'notifies on array unshift operation',
        path: 'items',
        operation: () => { store.items.unshift('x'); },
        expectedChanges: [['x', 'a', 'b', 'c']]
      });

      testSubscription({
        name: 'notifies on array splice operation',
        path: 'items',
        operation: () => { store.items.splice(1, 1, 'x', 'y'); },
        expectedChanges: [['a', 'x', 'y', 'c']]
      });

      testSubscription({
        name: 'notifies on array sort operation',
        path: 'items',
        operation: () => { store.items.sort(); },
        expectedChanges: [['a', 'b', 'c']]
      });

      testSubscription({
        name: 'notifies on array reverse operation',
        path: 'items',
        operation: () => { store.items.reverse(); },
        expectedChanges: [['c', 'b', 'a']]
      });

      testSubscription({
        name: 'notifies on array length changes via push',
        path: 'items.length',
        operation: () => { store.items.push('d'); },
        expectedChanges: [4]
      });

      testSubscription({
        name: 'notifies on array length changes via splice',
        path: 'items.length',
        operation: () => { store.items.splice(0, 2); },
        expectedChanges: [1]
      });

      testSubscription({
        name: 'notifies on Map size changes',
        path: 'userMap.size',
        operation: () => { store.userMap.set('u2', { role: 'user' }); },
        expectedChanges: [2]
      });

      testSubscription({
        name: 'notifies on Map value changes',
        path: 'userMap[u1].role',
        operation: () => { store.userMap.get('u1').role = 'user'; },
        expectedChanges: ['user']
      });

      testSubscription({
        name: 'notifies Map key subscribers when using Map.set',
        path: 'userMap[u2]',
        operation: () => { store.userMap.set('u2', { role: 'guest' }); },
        expectedChanges: [{ role: 'guest' }]
      });

      testSubscription({
        name: 'notifies Map subscribers when using Map.set',
        path: 'userMap',
        operation: () => { store.userMap.set('u2', { role: 'guest' }); },
        expectedChanges: [new Map([
          ['u1', { role: 'admin' }],
          ['u2', { role: 'guest' }]
        ])]
      });

      testSubscription({
        name: 'notifies when using Map.delete',
        path: 'userMap[u1]',
        operation: () => { store.userMap.delete('u1'); },
        expectedChanges: [undefined]
      });

      testSubscription({
        name: 'notifies parent path when using Map.delete',
        path: 'userMap',
        operation: () => { store.userMap.delete('u1'); },
        expectedChanges: [new Map()]
      });

      test('handles multiple array mutations in sequence', () => {
        const changes = [];
        store.$subscribe('items', value => changes.push([...value]));

        store.items[0] = 'x';
        store.items[1] = 'y';
        store.items.push('d');

        expect(changes).toEqual([
          ['x', 'b', 'c'],
          ['x', 'y', 'c'],
          ['x', 'y', 'c', 'd']
        ]);
      });

      test('handles empty array operations correctly', () => {
        const store = new Store('testStore', { emptyArr: [] });
        const changes = [];
        store.$subscribe('emptyArr', value => changes.push([...value]));

        store.emptyArr.push('a');
        store.emptyArr.push('b');
        store.emptyArr.pop();

        expect(changes).toEqual([
          ['a'],
          ['a', 'b'],
          ['a']
        ]);
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

      test('supports multiple subscribers to same path', () => {
        const changes1 = [];
        const changes2 = [];

        store.$subscribe('user.name', (value) => changes1.push(value));
        store.$subscribe('user.name', (value) => changes2.push(value));

        store.user.name = 'Jane';
        store.user.name = 'Bob';

        expect(changes1).toEqual(['Jane', 'Bob']);
        expect(changes2).toEqual(['Jane', 'Bob']);
      });

      test('unsubscribe removes only the specific callback', () => {
        const changes1 = [];
        const changes2 = [];

        const unsub1 = store.$subscribe('user.name', (value) => changes1.push(value));
        store.$subscribe('user.name', (value) => changes2.push(value));

        store.user.name = 'Jane';
        unsub1();
        store.user.name = 'Bob';

        expect(changes1).toEqual(['Jane']);
        expect(changes2).toEqual(['Jane', 'Bob']);
      });

      test('handles subscriptions to non-existent paths', () => {
        const changes = [];
        store.$subscribe('user.nonexistent.deep', (value) => changes.push(value));

        store.$set('user.nonexistent', { deep: 'value' });
        expect(changes).toEqual(['value']);

        store.$set('user.nonexistent.deep', 'updated');
        expect(changes).toEqual(['value', 'updated']);
      });

      test('notifies with undefined when path is deleted', () => {
        const changes = [];
        store.$subscribe('user.settings', value => changes.push(value));
        delete store.user.settings;
        expect(changes).toEqual([undefined]);
      });

      test('notifies child paths with undefined when parent is deleted', () => {
        const changes = [];
        store.$subscribe('user.settings.theme', value => changes.push(value));
        delete store.user.settings;
        expect(changes).toEqual([undefined]);
      });

      test('notifies parent paths with new state when child is deleted', () => {
        const changes = [];
        store.$subscribe('user', value => changes.push(value));
        delete store.user.settings;
        expect(changes).toEqual([{ name: 'John' }]);
      });

      test('parent path subscribers receive updates for nested changes', () => {
        const userChanges = [];
        const nameChanges = [];

        store.$subscribe('user', (value) => userChanges.push(value));
        store.$subscribe('user.name', (value) => nameChanges.push(value));

        store.user.name = 'Jane';

        expect(nameChanges).toEqual(['Jane']);
        expect(userChanges).toEqual([{ name: 'Jane', settings: { theme: 'light' } }]);
      });

      test('handles subscription to root path', () => {
        const changes = [];
        store.$subscribe('', (value) => changes.push(value));

        store.user.name = 'Jane';
        expect(changes).toEqual([store.$data]);
      });

      test('notifies all relevant subscribers when value changes', () => {
        const exactChanges = [];
        const childChanges = [];
        const parentChanges = [];

        // Set up subscribers at different levels
        store.$subscribe('user.name', value => exactChanges.push(value));
        store.$subscribe('user.name.first', value => childChanges.push(value));
        store.$subscribe('user', value => parentChanges.push(value));

        // Trigger a change
        store.user.name = 'Jane';

        // All subscribers should be notified
        expect(exactChanges).toEqual(['Jane']);
        expect(childChanges).toEqual([undefined]); // Since user.name is now a string, not an object
        expect(parentChanges).toEqual([{
          name: 'Jane',
          settings: { theme: 'light' }
        }]);
      });

      test('notifies all relevant subscribers for nested object changes', () => {
        const store = new Store('test', {
          user: {
            profile: {
              name: {
                first: 'John',
                last: 'Doe'
              }
            }
          }
        });

        const exactChanges = [];
        const childChanges = [];
        const parentChanges = [];
        const rootChanges = [];

        store.$subscribe('user.profile.name', value => exactChanges.push(value));
        store.$subscribe('user.profile.name.first', value => childChanges.push(value));
        store.$subscribe('user.profile', value => parentChanges.push(value));
        store.$subscribe('user', value => rootChanges.push(value));

        store.user.profile.name.first = 'Jane';

        expect(childChanges).toEqual(['Jane']);
        expect(exactChanges).toEqual([{ first: 'Jane', last: 'Doe' }]);
        expect(parentChanges).toEqual([{
          name: { first: 'Jane', last: 'Doe' }
        }]);
        expect(rootChanges).toEqual([{
          profile: { name: { first: 'Jane', last: 'Doe' } }
        }]);
      });

      testInvalidPathSyntax('$subscribe', () => {});
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

    test('throws error on invalid array index access', () => {
      const store = createTestStore();
      expect(() => { store.items[-1] = 'x'; }).toThrow('Invalid array index');
      expect(() => { store.items[999] = 'x'; }).toThrow('Invalid array index');
    });
  });
});
