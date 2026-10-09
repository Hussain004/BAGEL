// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TopicRow } from '../../src/components/panels/TopicInspector/TopicRow';
import { getAllPanels, useLayoutStore } from '../../src/store/layoutStore';
import type { TopicInfo } from '../../src/types/bag';

const IMU: TopicInfo = {
  name: '/imu/data',
  type: 'sensor_msgs/msg/Imu',
  messageCount: 1500,
  serializationFormat: 'cdr',
  frequency: 50,
};

const opened = () => getAllPanels(useLayoutStore.getState().root).map((p) => `${p.kind}:${p.topicName}`);

beforeEach(() => {
  useLayoutStore.setState({ root: null, openOrder: [], maximizedId: null, lastClosed: null });
});
afterEach(cleanup);

function row() {
  render(<TopicRow topic={IMU} index={0} />);
  return screen.getByRole('listitem');
}

describe('TopicRow keyboard handling', () => {
  it('is a focusable list item that announces its name, type, count and rate', () => {
    const el = row();
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-label')).toBe('/imu/data, sensor_msgs/msg/Imu, 1500 messages, 50.0 Hz');
  });

  it('Enter opens the suggested panel', () => {
    fireEvent.keyDown(row(), { key: 'Enter' });
    expect(opened()).toHaveLength(1);
    expect(opened()[0]).toMatch(/:\/imu\/data$/);
  });

  it('Space opens it too, and does not scroll the list', () => {
    const notPrevented = fireEvent.keyDown(row(), { key: ' ' });
    expect(notPrevented).toBe(false);
    expect(opened()).toHaveLength(1);
  });

  it('other keys do nothing', () => {
    const el = row();
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) fireEvent.keyDown(el, { key });
    expect(opened()).toEqual([]);
  });

  it('Enter or Space on an inner button is left to that button, not the row', () => {
    row();
    const inner = screen.getAllByRole('button')[0]!;
    for (const key of ['Enter', ' ']) {
      // Not prevented: the browser can still turn the key into the button's own click.
      expect(fireEvent.keyDown(inner, { key })).toBe(true);
    }
    expect(opened()).toEqual([]);
  });

  it('a click on an inline button opens that button\'s panel only', () => {
    row();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(opened()).toHaveLength(1);
  });
});
