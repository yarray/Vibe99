import test from 'node:test';
import assert from 'node:assert/strict';

import { createDispatcher } from '../src/input/dispatcher.js';

/**
 * IME composition events must never fire shortcuts. On WebKitGTK a keydown
 * during composition arrives with keyCode 229 / isComposing; matching a
 * chord against it would preventDefault the event (breaking the
 * composition) and, for chords the user has bound, run the action again on
 * top of the committed text.
 */

function makeEvent(overrides = {}) {
  return {
    key: 'n',
    keyCode: 78,
    isComposing: false,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...overrides,
  };
}

function makeDeps(handlers = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      getKeymap: () => [{ mode: '*', chord: 'Ctrl+N', action: 'newPane' }],
      actions: {
        newPane: (event) => {
          calls.push(['newPane', event]);
          (handlers.newPane ?? (() => {}))();
        },
      },
      getMode: () => 'default',
      isInputFocused: () => false,
      isCommandPaletteOpen: () => false,
    },
  };
}

test('a plain matching keydown fires the action', () => {
  const { calls, deps } = makeDeps();
  const dispatch = createDispatcher(deps);
  const event = makeEvent();

  dispatch(event);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'newPane');
});

test('events with isComposing are ignored', () => {
  const { calls, deps } = makeDeps();
  const dispatch = createDispatcher(deps);
  const event = makeEvent({ isComposing: true });

  dispatch(event);

  assert.equal(calls.length, 0);
});

test('events with keyCode 229 are ignored', () => {
  const { calls, deps } = makeDeps();
  const dispatch = createDispatcher(deps);
  const event = makeEvent({ keyCode: 229 });

  dispatch(event);

  assert.equal(calls.length, 0);
});

test('events with key Process are ignored', () => {
  const { calls, deps } = makeDeps();
  const dispatch = createDispatcher(deps);
  const event = makeEvent({ key: 'Process', keyCode: 229 });

  dispatch(event);

  assert.equal(calls.length, 0);
});

test('IME events are not preventDefault-ed either', () => {
  const { deps } = makeDeps();
  const dispatch = createDispatcher(deps);
  let prevented = 0;
  const event = makeEvent({ keyCode: 229, preventDefault() { prevented += 1; } });

  dispatch(event);

  assert.equal(prevented, 0);
});
