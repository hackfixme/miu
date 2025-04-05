# Miu <img width="60" height="40" src="/assets/logo.svg">

Miu is a small JavaScript data binding library for building simple web user
interfaces. It keeps the UI in sync with the data using a minimal, declarative API.

It is deliberately light on features, and designed as a response to the
mega-frameworks that rule the modern web. It harkens to a simpler time in web
development, sometime after jQuery, but before React.

> [!WARNING]
> The project is in early development, so expect bugs and missing features.
> It is usable in its current state, but please [report any issues](https://github.com/hackfixme/miu/issues).


## Features

- **Simple, declarative bindings** - Use data attributes for one and two-way data
  binding between DOM elements and data stores
- **Array/object iteration** - Render dynamic lists and collections with automatic
  DOM updates
- **Event handling** - Bind DOM events or store update events directly to store methods
- **Clear separation of concerns** - Keep markup in HTML, logic in JavaScript, and
  styling in CSS
- **Direct DOM manipulation** - No virtual DOM, just straightforward DOM updates when
  data changes
- **No build step required** - Just import and use
- **Zero dependencies** - No npm needed, no third-party vulnerabilities to worry about
- **Tiny footprint** - 8KB minified, 3KB gzipped


## Usage

> [!NOTE]
> Proper documentation will be added soon. In the meantime, here's a quick showcase
> of the features and API. You can also take a look at the [examples](/examples), and
> the fairly extensive [test suite](/src).

First, create a reactive store:
```js
const userStore = new Store('users', {
  list: ['Alice', 'Bob'],
  newUser: '',

  addUser() {
    if (this.newUser.trim()) {
      this.list.push(this.newUser);
      this.newUser = '';
    }
  }
});

// Bind it to your HTML
bind(document.body, [userStore]);
```

Then bind your HTML to the store using data attributes:
```html
<!-- One-way binding -->
<span data-miu-bind="users.list.length->text"></span>

<!-- Two-way binding -->
<input data-miu-bind="users.newUser<->value@input">

<!-- DOM event binding -->
<button data-miu-bind="users.addUser@click">Add</button>

<!-- Array iteration -->
<ul data-miu-for="users.list">
  <template>
    <li data-miu-bind="$->text"></li>
  </template>
</ul>
```


### API

The Store class provides these methods:

- `$subscribe(path, callback)` - Subscribe to changes at path
- `$get(path)` - Get value at specified path
- `$set(path, value)` - Set value at specified path
- `$data` - Get a deep copy of the current state

Path notation supports:
- Dot notation: `user.name`
- Array/Map/Object indexing: `users[0]` or `user[userId]`

You can also access and modify store values directly as you would expect:

```js
userStore.list[0];
userStore.list.push('Charlie');
userStore.list.splice(0, 1);
```

Any data modification done this way triggers UI updates.


## What's missing

TBA


## Comparison to existing frameworks

TBA


## License

[MIT](/LICENSE)
