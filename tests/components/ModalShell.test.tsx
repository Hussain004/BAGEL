// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModalShell } from '../../src/components/modals/ModalShell';

// jsdom has no layout, so offsetParent is always null and the focus trap would
// see every control as hidden. Treat anything attached to the document as visible.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement;
    },
  });
});
afterEach(cleanup);

function open(onClose = vi.fn()) {
  const utils = render(
    <ModalShell title="Settings" onClose={onClose}>
      <button>First</button>
      <input aria-label="Name" />
      <button>Last</button>
    </ModalShell>,
  );
  return { onClose, ...utils };
}

const closeBtn = () => screen.getByRole('button', { name: 'Close dialog' });

describe('ModalShell', () => {
  it('names the dialog by its title and focuses the close button first', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(document.activeElement).toBe(closeBtn());
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    open();
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn());

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle of the dialog', () => {
    open();
    screen.getByRole('button', { name: 'First' }).focus();
    const notPrevented = fireEvent.keyDown(window, { key: 'Tab' });
    expect(notPrevented).toBe(true);
  });

  it('Escape closes once', () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape in a text field only blurs it, so typed input is not lost', () => {
    const { onClose } = open();
    const input = screen.getByLabelText('Name');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does not reach other window handlers', () => {
    open();
    const other = vi.fn();
    window.addEventListener('keydown', other);
    fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', other);
    expect(other).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not on a click inside the dialog', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives focus back to what had it before the dialog opened', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = open();
    expect(document.activeElement).toBe(closeBtn());
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('stacked dialogs get distinct title ids', () => {
    render(
      <>
        <ModalShell title="One" onClose={() => {}}>a</ModalShell>
        <ModalShell title="Two" onClose={() => {}}>b</ModalShell>
      </>,
    );
    const ids = screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
  });
});
