/**
 * Custom dark-themed select component.
 *
 * Factory function that creates a reusable dropdown select matching
 * the app's design language.  The popup reuses the same visual tokens
 * as context menus and add-pane popups.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface CustomSelectOpts {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

export interface CustomSelect {
  el: HTMLElement;
  value: () => string;
  setValue: (v: string) => void;
  setOptions: (opts: SelectOption[]) => void;
  destroy: () => void;
}

const CHEVRON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';

export function createCustomSelect(opts: CustomSelectOpts): CustomSelect {
  const root = document.createElement('div');
  root.className = 'custom-select';
  root.setAttribute('role', 'listbox');

  let _options = [...opts.options];
  let _value = opts.value ?? '';
  let _highlightedIndex = -1;

  // -- Trigger --

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'custom-select-trigger-label';

  const chevron = document.createElement('span');
  chevron.className = 'custom-select-trigger-chevron';
  chevron.innerHTML = CHEVRON_SVG;

  trigger.append(label, chevron);

  // -- Dropdown --

  const dropdown = document.createElement('div');
  dropdown.className = 'custom-select-dropdown';

  root.append(trigger, dropdown);

  // -- State helpers --

  function selectedOption(): SelectOption | undefined {
    return _options.find(o => o.value === _value);
  }

  function updateLabel(): void {
    const opt = selectedOption();
    if (opt) {
      label.textContent = opt.label;
      trigger.classList.remove('is-placeholder');
    } else {
      label.textContent = opts.placeholder || '';
      trigger.classList.add('is-placeholder');
    }
  }

  function renderOptions(): void {
    dropdown.innerHTML = '';
    _options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'custom-select-option';
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      if (opt.value === _value) btn.classList.add('is-selected');
      if (i === _highlightedIndex) btn.classList.add('is-highlighted');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectOption(opt.value);
      });
      btn.addEventListener('mouseenter', () => {
        clearHighlighted();
        _highlightedIndex = i;
        btn.classList.add('is-highlighted');
      });
      dropdown.appendChild(btn);
    });
  }

  function clearHighlighted(): void {
    dropdown.querySelectorAll('.is-highlighted').forEach(el => el.classList.remove('is-highlighted'));
    _highlightedIndex = -1;
  }

  function highlightIndex(i: number): void {
    const items = dropdown.querySelectorAll<HTMLElement>('.custom-select-option');
    clearHighlighted();
    const clamped = Math.max(0, Math.min(i, items.length - 1));
    _highlightedIndex = clamped;
    if (items[clamped]) {
      items[clamped].classList.add('is-highlighted');
      items[clamped].scrollIntoView({ block: 'nearest' });
    }
  }

  function open(): void {
    if (root.classList.contains('is-open')) return;
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');

    // Auto-flip if near bottom of viewport
    const rect = root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    root.classList.toggle('is-open-above', spaceBelow < 260 && rect.top > spaceBelow);

    // Highlight current selection
    const idx = _options.findIndex(o => o.value === _value);
    _highlightedIndex = idx;
    renderOptions();
    if (idx >= 0) {
      const items = dropdown.querySelectorAll<HTMLElement>('.custom-select-option');
      if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  function close(): void {
    root.classList.remove('is-open', 'is-open-above');
    trigger.setAttribute('aria-expanded', 'false');
    clearHighlighted();
  }

  function selectOption(val: string): void {
    const changed = val !== _value;
    _value = val;
    updateLabel();
    close();
    if (changed) opts.onChange(val);
  }

  // -- Event listeners --

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (root.classList.contains('is-open')) {
      close();
    } else {
      open();
    }
  });

  root.addEventListener('keydown', (e) => {
    if (!root.classList.contains('is-open')) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        open();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        highlightIndex(_highlightedIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        highlightIndex(_highlightedIndex - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (_highlightedIndex >= 0 && _highlightedIndex < _options.length) {
          selectOption(_options[_highlightedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        trigger.focus();
        break;
    }
  });

  // Close on outside click
  const onDocClick = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  const onDocFocus = (e: FocusEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('focusin', onDocFocus);

  // -- Initial render --

  updateLabel();

  // -- Public API --

  return {
    el: root,
    value: () => _value,
    setValue(v: string) {
      _value = v;
      updateLabel();
    },
    setOptions(newOpts: SelectOption[]) {
      _options = [...newOpts];
      updateLabel();
      if (root.classList.contains('is-open')) renderOptions();
    },
    destroy() {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('focusin', onDocFocus);
      root.remove();
    },
  };
}
