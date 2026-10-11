import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, getAllPanels } from '../../src/store/layoutStore';

function freshStore() {
  useLayoutStore.setState({
    root: null,
    openOrder: [],
    maximizedId: null,
    lastClosed: null,
  });
}

/** Left-to-right topic order of the current tree, for comparing shapes. */
function leafOrder(): string[] {
  return getAllPanels(useLayoutStore.getState().root).map((p) => p.topicName);
}

describe('layoutStore maximize', () => {
  beforeEach(freshStore);

  it('setMaximizedId sets and clears the maximized panel', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/imu', type: 'sensor_msgs/Imu' });
    const id = useLayoutStore.getState().openOrder[0];
    store.setMaximizedId(id);
    expect(useLayoutStore.getState().maximizedId).toBe(id);
    store.setMaximizedId(null);
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });

  it('closePanel clears maximizedId only when the maximized panel is the one closed', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    const [idA, idB] = useLayoutStore.getState().openOrder;

    store.setMaximizedId(idA);
    store.closePanel(idB);
    expect(useLayoutStore.getState().maximizedId).toBe(idA);

    store.closePanel(idA);
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });

  it('closeAllPanels clears maximizedId', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    const id = useLayoutStore.getState().openOrder[0];
    store.setMaximizedId(id);
    store.closeAllPanels();
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });

  it('closePanelsForBag clears maximizedId only if the maximized panel belonged to that bag', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't', bagId: 'bagA' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't', bagId: 'bagB' });
    const ids = useLayoutStore.getState().openOrder;
    const idA = ids.find((i) => i.includes('bagA'))!;
    const idB = ids.find((i) => i.includes('bagB'))!;

    store.setMaximizedId(idB);
    store.closePanelsForBag('bagA');
    // idB survives (different bag), maximize state untouched.
    expect(useLayoutStore.getState().maximizedId).toBe(idB);

    store.closePanelsForBag('bagB');
    expect(useLayoutStore.getState().maximizedId).toBeNull();
    void idA;
  });

  it('restoreLayout always resets maximizedId to null', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    const id = useLayoutStore.getState().openOrder[0];
    store.setMaximizedId(id);
    store.restoreLayout({ node: 'panel', id, kind: 'plot', topicName: '/a', type: 't' });
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });
});

describe('layoutStore movePanel', () => {
  beforeEach(freshStore);

  it('moves a panel right by docking it next to its right-hand neighbor', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/c', type: 't' });
    const [idA] = useLayoutStore.getState().openOrder;
    // Order after opening: a, b, c (left to right). Moving /a right docks
    // it next to /b's right edge, yielding exactly b, a, c.
    store.movePanel(idA, 'right');
    // dockPanel doesn't touch openOrder (it's a move, not open/close), so
    // check the actual tree order instead via a fresh traversal.
    const leafOrder = getAllPanels(useLayoutStore.getState().root).map((p) => p.topicName);
    expect(leafOrder).toEqual(['/b', '/a', '/c']);
  });

  it('is a no-op at the start of the order moving left', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    const [idA] = useLayoutStore.getState().openOrder;
    const before = useLayoutStore.getState().root;
    store.movePanel(idA, 'left');
    expect(useLayoutStore.getState().root).toBe(before);
  });

  it('is a no-op at the end of the order moving right', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    const [, idB] = useLayoutStore.getState().openOrder;
    const before = useLayoutStore.getState().root;
    store.movePanel(idB, 'right');
    expect(useLayoutStore.getState().root).toBe(before);
  });

  it('is a no-op for an unknown panel id', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    const before = useLayoutStore.getState().root;
    store.movePanel('does-not-exist', 'right');
    expect(useLayoutStore.getState().root).toBe(before);
  });
});

describe('layoutStore panel-close undo', () => {
  beforeEach(freshStore);

  it('restores a closed panel to its original position in the tree', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/c', type: 't' });
    const [, idB] = useLayoutStore.getState().openOrder;

    store.closePanel(idB);
    expect(leafOrder()).toEqual(['/a', '/c']);
    expect(useLayoutStore.getState().lastClosed?.leaf.topicName).toBe('/b');

    expect(useLayoutStore.getState().reopenLastClosed()).toBe(true);
    // The whole point: back to a, b, c, not a, c, b.
    expect(leafOrder()).toEqual(['/a', '/b', '/c']);
  });

  it('restores the first panel of a row to the left of its neighbour', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/c', type: 't' });
    const [idA] = useLayoutStore.getState().openOrder;

    store.closePanel(idA);
    expect(leafOrder()).toEqual(['/b', '/c']);

    useLayoutStore.getState().reopenLastClosed();
    expect(leafOrder()).toEqual(['/a', '/b', '/c']);
  });

  it('reopens a vertically stacked panel above its neighbour', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    const [idA, idB] = useLayoutStore.getState().openOrder;
    // Split the row: /b goes below /a.
    store.dockPanel(idB, idA, 'bottom');
    expect(useLayoutStore.getState().root?.node).toBe('split');

    const before = useLayoutStore.getState().root;
    store.closePanel(idB);
    useLayoutStore.getState().reopenLastClosed();

    // Structural equality of the whole tree, ignoring the freshly generated
    // split id. This is stronger than comparing leaf order: it checks the
    // vertical nesting came back too.
    const strip = (n: unknown): unknown =>
      n && typeof n === 'object'
        ? Array.isArray(n)
          ? n.map(strip)
          : Object.fromEntries(
              Object.entries(n as Record<string, unknown>)
                .filter(([k]) => k !== 'id' || k === 'id' && (n as { node?: string }).node === 'panel')
                .map(([k, v]) => [k, strip(v)]),
            )
        : n;
    expect(strip(useLayoutStore.getState().root)).toEqual(strip(before));
  });

  it('reopens a maximized panel as maximized again', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: '3d', topicName: '/scan', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/imu', type: 't' });
    const [idA] = useLayoutStore.getState().openOrder;
    store.setMaximizedId(idA);

    store.closePanel(idA);
    expect(useLayoutStore.getState().maximizedId).toBeNull();

    useLayoutStore.getState().reopenLastClosed();
    expect(useLayoutStore.getState().maximizedId).toBe(idA);
  });

  it('falls back to a plain open when the recorded sibling is gone', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    const ids = useLayoutStore.getState().openOrder;

    store.closePanel(ids[1]);
    const record = useLayoutStore.getState().lastClosed;
    expect(record?.siblingId).toBe(ids[0]);

    // Simulate the sibling disappearing without going through closePanel (which
    // would overwrite the record). This is the defensive branch: undo must
    // still put the panel back rather than silently doing nothing.
    store.closePanel(ids[0]);
    useLayoutStore.setState({
      root: { node: 'panel', id: ids[0], kind: 'plot', topicName: '/a', type: 't' },
      openOrder: [ids[0]],
      lastClosed: record,
    });

    expect(useLayoutStore.getState().reopenLastClosed()).toBe(true);
    expect(leafOrder()).toEqual(['/a', '/b']);
  });

  it('reopens a panel that was the only one open', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/solo', type: 't' });
    const [id] = useLayoutStore.getState().openOrder;
    store.closePanel(id);
    expect(useLayoutStore.getState().root).toBeNull();

    expect(useLayoutStore.getState().reopenLastClosed()).toBe(true);
    expect(leafOrder()).toEqual(['/solo']);
  });

  it('clears the record after a successful undo so it cannot fire twice', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.closePanel(useLayoutStore.getState().openOrder[1]);

    expect(useLayoutStore.getState().reopenLastClosed()).toBe(true);
    expect(useLayoutStore.getState().lastClosed).toBeNull();
    expect(useLayoutStore.getState().reopenLastClosed()).toBe(false);
    expect(leafOrder()).toEqual(['/a', '/b']);
  });

  it('supersedes the record when a new panel is opened', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.closePanel(useLayoutStore.getState().openOrder[1]);
    expect(useLayoutStore.getState().lastClosed).not.toBeNull();

    useLayoutStore.getState().openPanel({ kind: 'plot', topicName: '/c', type: 't' });
    expect(useLayoutStore.getState().lastClosed).toBeNull();
  });

  it('clears the record on closeAllPanels, restoreLayout, and closePanelsForBag', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't', bagId: 'bagA' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't', bagId: 'bagB' });
    const ids = useLayoutStore.getState().openOrder;

    store.closePanel(ids[1]);
    store.closeAllPanels();
    expect(useLayoutStore.getState().lastClosed).toBeNull();

    store.openPanel({ kind: 'plot', topicName: '/c', type: 't', bagId: 'bagA' });
    store.openPanel({ kind: 'plot', topicName: '/d', type: 't', bagId: 'bagB' });
    store.closePanel(useLayoutStore.getState().openOrder[1]);
    store.closePanelsForBag('bagA');
    expect(useLayoutStore.getState().lastClosed).toBeNull();

    store.openPanel({ kind: 'plot', topicName: '/e', type: 't' });
    store.closePanel(useLayoutStore.getState().openOrder[0]);
    store.restoreLayout(null);
    expect(useLayoutStore.getState().lastClosed).toBeNull();
  });

  it('is a no-op when nothing has been closed', () => {
    expect(useLayoutStore.getState().reopenLastClosed()).toBe(false);
  });

  it('ignores closing a panel that is not open', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.closePanel('not-a-real-id');
    expect(useLayoutStore.getState().lastClosed).toBeNull();
    expect(leafOrder()).toEqual(['/a']);
  });

  it('clearLastClosed drops the record without reopening', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.closePanel(useLayoutStore.getState().openOrder[1]);

    useLayoutStore.getState().clearLastClosed();
    expect(useLayoutStore.getState().lastClosed).toBeNull();
    expect(useLayoutStore.getState().reopenLastClosed()).toBe(false);
  });

  it('refuses to duplicate a panel that was reopened by other means', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    store.closePanel(useLayoutStore.getState().openOrder[1]);
    // User reopens it by clicking the topic before pressing undo.
    useLayoutStore.getState().openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    expect(useLayoutStore.getState().lastClosed).toBeNull();
    expect(leafOrder()).toEqual(['/a', '/b']);
  });
});

describe('layoutStore placing new panels', () => {
  beforeEach(freshStore);

  /** The tree as nested arrays of topic names: H[...] / V[...]. */
  const shape = (n = useLayoutStore.getState().root): unknown =>
    !n ? null : n.node === 'panel' ? n.topicName : { [n.orientation === 'horizontal' ? 'H' : 'V']: n.children.map((c) => shape(c)) };
  const open = (...names: string[]) => {
    for (const t of names) useLayoutStore.getState().openPanel({ kind: 'plot', topicName: t, type: 't' });
  };

  it('fills three columns, then stacks into the emptiest column, leftmost first', () => {
    const expected: unknown[] = [
      '/1',
      { H: ['/1', '/2'] },
      { H: ['/1', '/2', '/3'] },
      { H: [{ V: ['/1', '/4'] }, '/2', '/3'] },
      { H: [{ V: ['/1', '/4'] }, { V: ['/2', '/5'] }, '/3'] },
      { H: [{ V: ['/1', '/4'] }, { V: ['/2', '/5'] }, { V: ['/3', '/6'] }] },
      { H: [{ V: ['/1', '/4', '/7'] }, { V: ['/2', '/5'] }, { V: ['/3', '/6'] }] },
      { H: [{ V: ['/1', '/4', '/7'] }, { V: ['/2', '/5', '/8'] }, { V: ['/3', '/6'] }] },
    ];
    for (let i = 0; i < expected.length; i++) {
      open(`/${i + 1}`);
      expect(shape(), `after ${i + 1} panels`).toEqual(expected[i]);
    }
  });

  it('keeps open panels where they are: a column that is already a stack just gets longer', () => {
    open('/1', '/2', '/3', '/4', '/5', '/6');
    const before = useLayoutStore.getState().root;
    if (before?.node !== 'split') throw new Error('expected a split');
    const firstColumnId = before.children[0]!.id;
    open('/7');
    const after = useLayoutStore.getState().root;
    if (after?.node !== 'split') throw new Error('expected a split');
    // Same split ids, so React keeps every existing panel mounted.
    expect(after.id).toBe(before.id);
    expect(after.children.map((c) => c.id)).toEqual(before.children.map((c) => c.id));
    expect(after.children[0]!.id).toBe(firstColumnId);
  });

  it('balances around a column the user already stacked', () => {
    open('/1', '/2', '/3');
    useLayoutStore.getState().dockPanel(useLayoutStore.getState().openOrder[2]!, useLayoutStore.getState().openOrder[0]!, 'bottom');
    expect(shape()).toEqual({ H: [{ V: ['/1', '/3'] }, '/2'] });
    open('/4'); // two columns, so a third is added
    open('/5'); // three columns of 2, 1, 1: the second gets it
    expect(shape()).toEqual({ H: [{ V: ['/1', '/3'] }, { V: ['/2', '/5'] }, '/4'] });
  });

  it('a top level made vertical grows rows the same way', () => {
    open('/1', '/2');
    useLayoutStore.getState().dockPanel(useLayoutStore.getState().openOrder[1]!, useLayoutStore.getState().openOrder[0]!, 'bottom');
    expect(shape()).toEqual({ V: ['/1', '/2'] });
    open('/3', '/4');
    expect(shape()).toEqual({ V: [{ H: ['/1', '/4'] }, '/2', '/3'] });
  });

  it('undo still puts a closed panel back where it was', () => {
    open('/1', '/2', '/3', '/4', '/5');
    const before = shape();
    const id = useLayoutStore.getState().openOrder[4]!; // /5, under /2
    useLayoutStore.getState().closePanel(id);
    expect(useLayoutStore.getState().reopenLastClosed()).toBe(true);
    expect(shape()).toEqual(before);
  });
});
