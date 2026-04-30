// Modal stack management — ESC closes the topmost modal/panel.

export function createModalStack() {
  const stack = [];

  function register(closeFn) {
    stack.push(closeFn);
  }

  function unregister(closeFn) {
    const idx = stack.indexOf(closeFn);
    if (idx !== -1) stack.splice(idx, 1);
  }

  function closeTop() {
    const closeFn = stack[stack.length - 1];
    if (closeFn) closeFn();
  }

  function isEmpty() {
    return stack.length === 0;
  }

  function length() {
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
