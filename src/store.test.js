import { describe, test, expect, beforeEach, vi } from 'vitest';
import { Store, internals } from './store.js';

function isProxied(v) {
  return v instanceof internals.StateProxy;
}

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

    test('supports falsy initial values correctly', () => {
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

    test('supports cloning a store', () => {
      const original = new Store('original', {
        value: 'initial'
      });

      const clone1 = new Store('clone1', original);
      // The clone store can access the state on the original store
      expect(clone1.value).toBe('initial');
      // It can also update it, which is reflected on the original.
      clone1.value = 'update1 from clone1'
      expect(original.value).toBe('update1 from clone1');

      // Original store subscriptions work as usual
      const changes = [];
      original.$subscribe('value', v => changes.push(`original sub got: ${v}`));
      original.value = 'update1 from original';
      expect(changes).toEqual(['original sub got: update1 from original']);
      // And the changes are reflected on the clone.
      expect(clone1.value).toBe('update1 from original');

      // Subscriptions on the clone work as usual, and subscriptions on the
      // original store will also be notified of state changes on the clone.
      changes.length = 0;
      clone1.$subscribe('value', v => changes.push(`clone1 sub got: ${v}`));
      clone1.value = 'update2 from clone1';
      expect(changes).toEqual([
        'original sub got: update2 from clone1',
        'clone1 sub got: update2 from clone1',
      ]);

      // ... and viceversa.
      changes.length = 0;
      original.value = 'update3 from original';
      expect(changes).toEqual([
        'original sub got: update3 from original',
        'clone1 sub got: update3 from original',
      ]);

      // Cloning a clone is a also possible.
      changes.length = 0;
      const clone2 = new Store('clone2', clone1);
      clone2.$subscribe('value', v => changes.push(`clone2 sub got: ${v}`));
      clone2.value = 'update4 from clone2';
      expect(changes).toEqual([
        'original sub got: update4 from clone2',
        'clone1 sub got: update4 from clone2',
        'clone2 sub got: update4 from clone2',
      ]);

      // Changes on a clone can also be private to it.
      changes.length = 0;
      clone2.$subscribe('otherValue', v => changes.push(`clone2 otherValue sub got: ${v}`));
      clone2.otherValue = 'otherValue update from clone2';
      expect(changes).toEqual([
        'clone2 otherValue sub got: otherValue update from clone2',
      ]);
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
        const date = new Date();
        const initialState = {
          nested: {
            foo: 'bar',
            fn: () => false,
            date: date
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
            foo: 'bar',
            date: date
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
        expect(isProxied(store.deeply)).toBe(true);
        expect(isProxied(store.deeply.nested)).toBe(true);
        expect(isProxied(store.deeply.nested.value)).toBe(false);
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

      test('supports multiple array mutations in sequence', () => {
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

      test('notifies on array length changes', () => {
        const changes = [];
        store.$subscribe('items', value => changes.push([...value]));
        store.$subscribe('items[2]', value => changes.push(value));
        store.$subscribe('items[3]', value => changes.push(value));

        store.items.length = 1;
        expect(changes).toEqual([
          undefined,
          ['a'],
        ]);

        changes.length = 0;

        store.items.length = 3;
        expect(changes).toEqual([
          ['a', undefined, undefined],
        ]);
      });

      test('supports empty array operations correctly', () => {
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

      test('supports nested Map operations', () => {
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

      test('supports subscriptions to non-existent paths', () => {
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

      test('supports subscription to root path', () => {
        const changes = [];
        store.$subscribe('', (value) => changes.push(value));

        store.user.name = 'Jane';

        // We're not doing a check against store.$data, since the notified value
        // will contain proxied values which breaks equality checks. So we check
        // individual data structures instead.

        expect(changes).toHaveLength(1);
        const change = changes[0];
        expect(Object.keys(change)).toEqual(['user', 'items', 'userMap']);

        expect(change.user).toEqual({
          name: 'Jane',
          settings: { theme: 'light' }
        });
        expect(change.items).toEqual(['a', 'b', 'c']);
        expect(Array.from(change.userMap.entries())).toEqual([
          ['u1', { role: 'admin' }]
        ]);
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

        const rootChanges = [];
        const parentChanges = [];
        const exactChanges = [];
        const childChanges = [];

        store.$subscribe('', value => rootChanges.push(value));
        store.$subscribe('user', value => parentChanges.push(value));
        store.$subscribe('user.profile', value => parentChanges.push(value));
        store.$subscribe('user.profile.name', value => parentChanges.push(value));
        store.$subscribe('user.profile.name.first', value => exactChanges.push(value));
        store.$subscribe('user.profile.name.first.someChild', value => childChanges.push(value));

        store.user.profile.name.first = 'Jane';

        // TODO: Maybe there shouldn't be a notification when the object doesn't exist?
        expect(childChanges).toEqual([undefined]);
        expect(exactChanges).toEqual(['Jane']);
        expect(parentChanges).toEqual([
          { first: 'Jane', last: 'Doe' },
          { name: { first: 'Jane', last: 'Doe' } },
          { profile: { name: { first: 'Jane', last: 'Doe' } } },
        ]);
        expect(rootChanges).toEqual([
          { user: { profile: { name: { first: 'Jane', last: 'Doe' } } } }
        ]);
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
    });
  });
});


describe('StateProxy', () => {
  const createProxy = (...args) => {
    return internals.StateProxy.create(...args);
  };

  test('proxies instanceof to the target object', () => {
    const map = new Map([['key1', 'value']]);
    const proxy = createProxy(map);
    expect(proxy.get('key1')).toBe('value');
    expect(map instanceof Map).toBe(true);
    expect(isProxied(map)).toBe(false);
    expect(isProxied(proxy)).toBe(true);
  });

  test('creates proxy only once for the same object', () => {
    const obj = { name: 'test' };
    const proxy1 = createProxy(obj);
    const proxy2 = createProxy(proxy1);

    expect(isProxied(proxy1)).toBe(true);
    expect(proxy1).toBe(proxy2);
  });

  test('proxy handles primitive values', () => {
    const num = 42;
    const str = 'test';
    const bool = true;
    const nil = null;
    const undef = undefined;

    // Primitives should be returned as-is
    expect(createProxy(num)).toBe(42);
    expect(createProxy(str)).toBe('test');
    expect(createProxy(bool)).toBe(true);
    expect(createProxy(nil)).toBe(null);
    expect(createProxy(undef)).toBe(undefined);
  });

  test('binds methods correctly based on their source', () => {
    const obj = {
      value: 42,
      increment() {
        this.value += 1;
      },
    };
    const notify = vi.fn();
    const proxy = createProxy(obj, notify);

    // Custom method should work with proxy binding
    proxy.increment();
    expect(proxy.value).toBe(43);
    expect(notify).toHaveBeenCalledWith('value', 43);
    // The original object should remain unchanged
    expect(obj.value).toBe(42);
  });

  test('proxy handles Date objects', () => {
    const date = new Date(1744361691629); // 2025-04-11T08:54:51.629Z
    const proxy = createProxy({ date: date });

    expect(isProxied(date)).toBe(false);
    expect(isProxied(proxy.date)).toBe(true);

    // Proxy dates can still be used as non-proxied dates.
    expect(proxy.date.getMonth()).toBe(3);
    // But they can't be directly compared, so we can either compare their values...
    expect(proxy.date.valueOf()).toEqual(date.valueOf());
    // ... or compare the raw clone against the original Date object.
    expect(proxy.date.$data).toEqual(date);
  });

  describe('Object handling', () => {
    test('notifies listeners correctly for object operations', () => {
      const obj = { name: 'test' };
      const notify = vi.fn();
      const proxy = createProxy(obj, notify);

      // Set new property
      proxy.age = 25;
      expect(notify).toHaveBeenCalledWith('age', 25);

      // Modify existing
      proxy.name = 'changed';
      expect(notify).toHaveBeenCalledWith('name', 'changed');

      // Delete property
      delete proxy.name;
      expect(notify).toHaveBeenCalledWith('name', undefined);
    });

    test('handles nested object operations correctly', () => {
      const obj = { user: { name: 'test' } };
      const notify = vi.fn();
      const proxy = createProxy(obj, notify);

      proxy.user.name = 'changed';
      expect(notify).toHaveBeenCalledWith('user.name', 'changed');

      // Add nested property
      proxy.user.age = 25;
      expect(notify).toHaveBeenCalledWith('user.age', 25);

      // Delete nested property
      delete proxy.user.name;
      expect(notify).toHaveBeenCalledWith('user.name', undefined);
    });

    test('handles special property types correctly', () => {
      const obj = { name: 'test' };
      const notify = vi.fn();
      const proxy = createProxy(obj, notify);

      // Setting same value should still notify
      proxy.name = 'test';
      expect(notify).toHaveBeenCalledWith('name', 'test');

      // Setting undefined
      proxy.undefinedProp = undefined;
      expect(notify).toHaveBeenCalledWith('undefinedProp', undefined);

      // Symbol properties should notify like normal properties
      const symbol = Symbol('test');
      proxy[symbol] = 'symbol';
      expect(notify).toHaveBeenCalledWith(symbol, 'symbol');
    });
  });

  describe('Array handling', () => {
    test('basic array operations preserve proxy state', () => {
      const nested = { value: 42 };
      const arr = [1, nested, 3];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');
      expect(isProxied(proxy)).toBe(true);

      // Direct access should return same nested proxy
      const proxyNested = proxy[1];
      expect(isProxied(proxyNested)).toBe(true);
      expect(proxy[1]).toBe(proxyNested);

      // Direct modification
      proxy[1] = { value: 43 };
      expect(isProxied(proxy[1])).toBe(true);
      expect(proxy[1].value).toBe(43);
      expect(notify).toHaveBeenCalledWith('arr[1]', proxy[1]);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('supports setting elements at indices greater than length', () => {
      const arr = [1, 2, 3];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');

      proxy[5] = 6;

      expect(proxy).toEqual([1, 2, 3, undefined, undefined, 6]);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('allows modifying array length', () => {
      const nested = { value: 42 };
      const arr = [1, 2, nested];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');

      proxy.length = 5;
      expect(proxy).toEqual([1, 2, { value: 42 }, undefined, undefined]);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('arr', proxy);

      notify.mockClear();
      proxy.length = 2;
      expect(proxy).toEqual([1, 2]);
      expect(notify).toHaveBeenCalledTimes(4);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
      expect(notify).toHaveBeenCalledWith('arr[2]', undefined);
      expect(notify).toHaveBeenCalledWith('arr[3]', undefined);
      expect(notify).toHaveBeenCalledWith('arr[4]', undefined);
    });

    test('array push/pop operations', () => {
      const arr = [{ x: 1 }];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');
      const original = proxy[0];

      // push
      proxy.push({ y: 2 });
      expect(isProxied(proxy[1])).toBe(true);
      expect(proxy[0]).toBe(original);
      expect(notify).toHaveBeenCalledWith('arr', proxy);

      // pop
      const popped = proxy.pop();
      expect(isProxied(popped)).toBe(true);
      expect(proxy[0]).toBe(original);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('array shift/unshift operations', () => {
      const arr = [{ x: 1 }, { x: 2 }];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');
      const original1 = proxy[0];
      const original2 = proxy[1];

      // unshift
      proxy.unshift({ x: 0 });
      expect(isProxied(proxy[0])).toBe(true);
      expect(proxy[1]).toBe(original1);
      expect(proxy[2]).toBe(original2);
      expect(notify).toHaveBeenCalledWith('arr', proxy);

      // shift
      const shifted = proxy.shift();
      expect(isProxied(shifted)).toBe(true);
      expect(proxy[0]).toBe(original1);
      expect(proxy[1]).toBe(original2);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('array splice operations', () => {
      const arr = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');
      const original1 = proxy[0];
      const original2 = proxy[1];
      const original3 = proxy[2];

      // splice - remove and insert
      const removed = proxy.splice(1, 1, { x: 4 }, { x: 5 });

      // Check removed elements are proxied
      expect(isProxied(removed[0])).toBe(true);
      expect(removed[0]).toBe(original2);

      // Check remaining original elements are same proxies
      expect(proxy[0]).toBe(original1);
      expect(proxy[3]).toBe(original3);

      // Check new elements are proxied
      expect(isProxied(proxy[1])).toBe(true);
      expect(isProxied(proxy[2])).toBe(true);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('array sort/reverse operations', () => {
      const arr = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');
      const original1 = proxy[0];
      const original2 = proxy[1];
      const original3 = proxy[2];

      // reverse
      proxy.reverse();
      expect(proxy[0]).toBe(original3);
      expect(proxy[1]).toBe(original2);
      expect(proxy[2]).toBe(original1);
      expect(notify).toHaveBeenCalledWith('arr', proxy);

      // sort (by x value)
      proxy.sort((a, b) => a.x - b.x);
      expect(proxy[0]).toBe(original1);
      expect(proxy[1]).toBe(original2);
      expect(proxy[2]).toBe(original3);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('array fill operations', () => {
      const arr = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');

      proxy.fill({ y: 42 }, 1, 3);
      expect(isProxied(proxy[1])).toBe(true);
      expect(isProxied(proxy[2])).toBe(true);
      expect(proxy[1].y).toBe(42);
      expect(proxy[2].y).toBe(42);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('array concat operations', () => {
      const arr1 = [{ x: 1 }];
      const arr2 = [{ x: 2 }];
      const notify = vi.fn();
      const proxy = createProxy(arr1, notify, 'arr');

      const result = proxy.concat(arr2);
      expect(Array.isArray(result)).toBe(true);
      expect(isProxied(result[0])).toBe(true);
      expect(isProxied(result[1])).toBe(true);
      expect(result[0].x).toBe(1);
      expect(result[1].x).toBe(2);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });

    test('array copyWithin operations', () => {
      const arr = [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }];
      const notify = vi.fn();
      const proxy = createProxy(arr, notify, 'arr');
      const original1 = proxy[0];
      const original2 = proxy[1];

      proxy.copyWithin(2, 0, 2);
      expect(proxy[2]).toEqual({ x: 1 });
      expect(proxy[3]).toEqual({ x: 2 });
      expect(proxy[0]).toBe(original1);
      expect(proxy[1]).toBe(original2);
      expect(notify).toHaveBeenCalledWith('arr', proxy);
    });
  });

  describe('Map handling', () => {
    test('basic Map operations preserve proxy state', () => {
      const nested = { value: 42 };
      const map = new Map([['key1', nested]]);
      const notify = vi.fn();
      const proxy = createProxy(map, notify);

      // Direct access should return same nested proxy
      const proxyNested = proxy.get('key1');
      expect(isProxied(proxyNested)).toBe(true);
      expect(proxy.get('key1')).toBe(proxyNested);

      // Direct modification
      proxy.set('key1', { value: 43 });
      expect(isProxied(proxy.get('key1'))).toBe(true);
      expect(proxy.get('key1').value).toBe(43);
      expect(notify).toHaveBeenCalledWith('[key1]', { value: 43 });
      expect(notify).toHaveBeenCalledWith('', new Map([['key1', { value: 43 }]]));
    });

    test('Map iterator methods preserve proxy state', () => {
      const map = new Map([
        ['key1', { x: 1 }],
        ['key2', { x: 2 }]
      ]);
      const proxy = createProxy(map);

      for (const [key, value] of proxy.entries()) {
        expect(isProxied(value)).toBe(true);
      }

      for (const value of proxy.values()) {
        expect(isProxied(value)).toBe(true);
      }

      proxy.forEach((value) => {
        expect(isProxied(value)).toBe(true);
      });
    });

    test('Map modifications return consistent proxies', () => {
      const map = new Map([['key1', { x: 1 }]]);
      const notify = vi.fn();
      const proxy = createProxy(map, notify);
      const original = proxy.get('key1');

      // set same key
      proxy.set('key1', { x: 2 });
      const newValue = proxy.get('key1');
      expect(isProxied(newValue)).toBe(true);
      expect(newValue).not.toBe(original);
      expect(notify).toHaveBeenCalledWith('[key1]', { x: 2 });
      expect(notify).toHaveBeenCalledWith('', new Map([['key1', { x: 2 }]]));

      // delete and set
      proxy.delete('key1');
      expect(notify).toHaveBeenCalledWith('[key1]', undefined);
      expect(notify).toHaveBeenCalledWith('', new Map());

      proxy.set('key1', { x: 3 });
      expect(isProxied(proxy.get('key1'))).toBe(true);
      expect(notify).toHaveBeenCalledWith('[key1]', { x: 3 });
      expect(notify).toHaveBeenCalledWith('', new Map([['key1', { x: 3 }]]));

      // clear and set
      proxy.clear();
      expect(notify).toHaveBeenCalledWith('[key1]', undefined);
      expect(notify).toHaveBeenCalledWith('', new Map());

      proxy.set('key2', { x: 4 });
      expect(isProxied(proxy.get('key2'))).toBe(true);
      expect(notify).toHaveBeenCalledWith('[key2]', { x: 4 });
      expect(notify).toHaveBeenCalledWith('', new Map([['key2', { x: 4 }]]));
    });

    test('Map size and existence checks', () => {
      const map = new Map([['key1', { x: 1 }]]);
      const notify = vi.fn();
      const proxy = createProxy(map, notify);

      expect(proxy.size).toBe(1);
      expect(proxy.has('key1')).toBe(true);

      proxy.delete('key1');
      expect(proxy.size).toBe(0);
      expect(proxy.has('key1')).toBe(false);
      expect(notify).toHaveBeenCalledWith('[key1]', undefined);
      expect(notify).toHaveBeenCalledWith('', new Map());

      proxy.set('key2', { x: 2 });
      expect(proxy.size).toBe(1);
      expect(proxy.has('key2')).toBe(true);
      expect(notify).toHaveBeenCalledWith('[key2]', { x: 2 });
      expect(notify).toHaveBeenCalledWith('', new Map([['key2', { x: 2 }]]));
    });

    test('Map operations with nested paths', () => {
      const map = new Map();
      const notify = vi.fn();
      const proxy = createProxy(map, notify, 'nested');

      proxy.set('key1', { x: 1 });
      expect(notify).toHaveBeenCalledWith('nested[key1]', { x: 1 });
      expect(notify).toHaveBeenCalledWith('nested', new Map([['key1', { x: 1 }]]));

      proxy.delete('key1');
      expect(notify).toHaveBeenCalledWith('nested[key1]', undefined);
      expect(notify).toHaveBeenCalledWith('nested', new Map());
    });

    test('Map operations require method calls for modifications', () => {
      const map = new Map([['key1', { x: 1 }]]);
      const notify = vi.fn();
      const proxy = createProxy(map, notify);

      // Get works with dot notation
      expect(proxy.key1).toEqual({ x: 1 });
      expect(isProxied(proxy.key1)).toBe(true);

      // Set requires method call
      proxy.key2 = { x: 2 };  // Should not work
      expect(map.has('key2')).toBe(false);

      // Proper way to set
      proxy.set('key2', { x: 2 });
      expect(proxy.get('key2')).toEqual({ x: 2 });
      expect(notify).toHaveBeenCalledWith('[key2]', { x: 2 });
      expect(notify).toHaveBeenCalledWith('', new Map([
        ['key1', { x: 1 }],
        ['key2', { x: 2 }],
      ]));
    });
  });
});
