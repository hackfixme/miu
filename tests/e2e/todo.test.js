import { test, expect } from 'vitest';
import { logError, loadTestFrame } from './util.js';

/** NOTE **
 * I want to reuse the existing Todo example instead of setting up Miu manually.
 * Unfortunately, Vitest doesn't have good support for loading arbitrary HTML
 * files, and the only workable solution I've found is to do this in an iframe.
 * This has the drawback of having to use the DOM API directly instead of
 * Vitest's browser test APIs.
 *
 * One alternative would be to use Playwright directly, but I ran into some
 * issues setting that up, and I would rather use Vitest's abstraction than deal
 * with Playwright directly. Another would be to add custom commands over the
 * Playwright API[1], but that seems too hacky to me right now, though I might
 * consider it in the future.
 *
 * Also see this related issue[2].
 *
 * [1]: https://vitest.dev/guide/browser/commands.html#custom-commands
 *
 * [2]: https://github.com/vitest-dev/vitest/issues/6966
*/

test('todo example', async () => {
  const { doc, errors } = await loadTestFrame('/examples/todo.html');

  const headingEl = doc.querySelector('h1');
  expect(headingEl).toBeTruthy();
  expect(headingEl.textContent).toBe('Todo List');

  const inputEl = doc.getElementById('newTask');
  const buttonEl = doc.querySelector('button.add');
  const taskCountEl = doc.querySelector('#count span');
  let taskCount = 0;

  const addTask = (text) => {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event('input'));
    buttonEl.click();
    taskCount++;
    expect(taskCountEl.textContent).toBe(taskCount.toString());
    expect(errors).toHaveLength(0, errors.map(e => logError(e)));
  }

  const removeTask = (index) => {
    const tasksEl = doc.querySelectorAll('#taskList .task');
    tasksEl[index].querySelector('button.remove').click();
    taskCount--;
    expect(taskCountEl.textContent).toBe(taskCount.toString());
    expect(errors).toHaveLength(0, errors.map(e => logError(e)));
  }

  const checkTask = (index) => {
    const tasksEl = doc.querySelectorAll('#taskList .task');
    const checkbox = tasksEl[index].querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(errors).toHaveLength(0, errors.map(e => logError(e)));
  }

  const assertTasksEqual = (tasks) => {
    const tasksEl = doc.querySelectorAll('#taskList .task');
    expect(tasksEl.length).toEqual(tasks.length);
    let checkbox;
    for (let i = 0; i < tasks.length; i++) {
      expect(tasksEl[i].textContent).toContain(tasks[i].text);
      checkbox = tasksEl[i].querySelector('input[type="checkbox"]');
      expect(checkbox.checked).toBe(tasks[i].checked);
    }
  }

  addTask('One');
  addTask('Two');
  addTask('Three');
  assertTasksEqual([
    { text: 'One', checked: false },
    { text: 'Two', checked: false },
    { text: 'Three', checked: false },
  ]);

  checkTask(1);
  assertTasksEqual([
    { text: 'One', checked: false },
    { text: 'Two', checked: true },
    { text: 'Three', checked: false },
  ]);

  removeTask(0);
  assertTasksEqual([
    { text: 'Two', checked: true },
    { text: 'Three', checked: false },
  ]);

  removeTask(1);
  assertTasksEqual([
    { text: 'Two', checked: true },
  ]);

  removeTask(0);
  assertTasksEqual([]);
});
