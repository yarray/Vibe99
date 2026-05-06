/**
 * Tests for create-pane.ts
 */
import { describe, it, expect } from 'vitest';
import { createPane } from './create-pane';

describe('createPane', () => {
  it('creates a pane with the given id', () => {
    const pane = createPane({ id: 'test-pane' });
    expect(pane.id).toBe('test-pane');
  });

  it('use() registers a behavior', () => {
    const pane = createPane({ id: 'p' });
    const opened = { flag: false };
    pane.use({
      name: 'test-behavior',
      open: () => { opened.flag = true; },
    });
    pane.open();
    expect(opened.flag).toBe(true);
  });

  it('open() calls all behavior open() methods', () => {
    const order: string[] = [];
    const pane = createPane({ id: 'p' });
    pane.use({ name: 'a', open: () => order.push('a') });
    pane.use({ name: 'b', open: () => order.push('b') });
    pane.open();
    expect(order).toEqual(['a', 'b']);
  });

  it('open() is idempotent', () => {
    let count = 0;
    const pane = createPane({ id: 'p' });
    pane.use({ open: () => { count++; } });
    pane.open();
    pane.open();
    expect(count).toBe(1);
  });

  it('command() dispatches to behavior and returns result', () => {
    const pane = createPane({ id: 'p' });
    pane.use({
      command: (_p, payload) => {
        return `result: ${payload}`;
      },
    });
    const result = pane.command('foo', 'bar');
    expect(result).toBe('result: bar');
  });

  it('capability() returns named property from a behavior', () => {
    const pane = createPane({ id: 'p' });
    pane.use({
      myCapability: () => 'cap-value',
    });
    const cap = pane.capability<( () => string)>('myCapability');
    expect(cap?.()).toBe('cap-value');
  });

  it('getState / setState work correctly', () => {
    const pane = createPane({ id: 'p', initialState: { initial: 1 } });
    expect(pane.getState<number>('initial')).toBe(1);
    pane.setState({ added: 'hello' });
    expect(pane.getState<string>('added')).toBe('hello');
  });

  it('close() calls behaviors in reverse order', () => {
    const order: string[] = [];
    const pane = createPane({ id: 'p' });
    pane.use({ name: 'a', close: () => order.push('a') });
    pane.use({ name: 'b', close: () => order.push('b') });
    pane.open();
    pane.close();
    expect(order).toEqual(['b', 'a']);
  });

  it('close() is idempotent', () => {
    let count = 0;
    const pane = createPane({ id: 'p' });
    pane.use({ close: () => { count++; } });
    pane.open();
    pane.close();
    pane.close();
    expect(count).toBe(1);
  });

  it('on() registers event handlers and returns unsubscribe', () => {
    const pane = createPane({ id: 'p' });
    const events: string[] = [];
    const unsub = pane.on('open', () => events.push('open fired'));
    pane.open();
    unsub();
    pane.open(); // second open should not fire (already open)
    expect(events).toEqual(['open fired']);
  });

  it('lifecycle event handler receives all events', () => {
    const events: string[] = [];
    const pane = createPane({ id: 'p' });
    pane.on('lifecycle', (e) => events.push(e.type));
    pane.open();
    pane.setState({ x: 1 });
    pane.close();
    expect(events).toContain('open');
    expect(events).toContain('state-change');
    expect(events).toContain('close');
  });

  it('serialize() returns id and snapshot of state', () => {
    const pane = createPane({ id: 'p', initialState: { foo: 'bar' } });
    pane.setState({ baz: 42 });
    const ser = pane.serialize();
    expect(ser.id).toBe('p');
    expect(ser.state).toEqual({ foo: 'bar', baz: 42 });
  });

  it('use() after close() is a no-op', () => {
    const pane = createPane({ id: 'p' });
    pane.open();
    pane.close();
    // Should not throw
    pane.use({ open: () => { throw new Error('should not be called'); } });
  });
});