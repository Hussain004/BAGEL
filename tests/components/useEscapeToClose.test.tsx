// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEscapeToClose } from '../../src/hooks/useEscapeToClose';

afterEach(cleanup);

function Popover({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEscapeToClose(open, onClose);
  return null;
}

describe('useEscapeToClose', () => {
  it('closes on Escape ahead of a window-level shortcut handler', () => {
    const onClose = vi.fn();
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut); // like the global "Esc closes a panel" handler
    render(<Popover open onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', shortcut);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shortcut).not.toHaveBeenCalled();
  });

  it('does nothing while closed, so Escape reaches the shortcut handler', () => {
    const onClose = vi.fn();
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    render(<Popover open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', shortcut);
    expect(onClose).not.toHaveBeenCalled();
    expect(shortcut).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    render(<Popover open onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once closed or unmounted', () => {
    const onClose = vi.fn();
    const { rerender, unmount } = render(<Popover open onClose={onClose} />);
    rerender(<Popover open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    rerender(<Popover open onClose={onClose} />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('with two layers open, one Escape closes exactly one', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Popover open onClose={outer} />
        <Popover open onClose={inner} />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(outer.mock.calls.length + inner.mock.calls.length).toBe(1);
  });
});
