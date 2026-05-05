// Modal stack management — ESC closes the topmost modal/panel.

/** A function that closes a modal or panel. */
export type CloseFn = () => void;

/** Interface for the modal stack returned by createModalStack. */
export interface ModalStack {
  /** Register a close handler (pushed onto the stack). */
  register(closeFn: CloseFn): void;
  /** Unregister a close handler (removed from anywhere in the stack). */
  unregister(closeFn: CloseFn): void;
  /** Close the topmost registered modal/panel. */
  closeTop(): void;
  /** Returns true when the stack is empty. */
  isEmpty(): boolean;
  /** Returns the number of registered modals/panels. */
  length(): number;
}

export function createModalStack(): ModalStack {
  const stack: CloseFn[] = [];

  function register(closeFn: CloseFn): void {
    stack.push(closeFn);
  }

  function unregister(closeFn: CloseFn): void {
    const idx: number = stack.indexOf(closeFn);
    if (idx !== -1) stack.splice(idx, 1);
  }

  function closeTop(): void {
    const closeFn: CloseFn | undefined = stack[stack.length - 1];
    if (closeFn) closeFn();
  }

  function isEmpty(): boolean {
    return stack.length === 0;
  }

  function length(): number {
    return stack.length;
  }

  return {
    register,
    unregister,
    closeTop,
    isEmpty,
    length,
  };
}
