import { describe, expect, it } from 'vitest';
import { groupBagFiles, parseRosbag2Metadata, type NamedFile } from '../../src/utils/bagGroups';

const f = (name: string, dir = ''): NamedFile => ({ name, dir });
const names = (g: Array<{ files: NamedFile[] }>) => g.map((x) => x.files.map((y) => y.name));

describe('groupBagFiles name heuristic', () => {
  it('groups a rosbag2 split numbered from 0, in index order', () => {
    const groups = groupBagFiles([f('rec_2.mcap'), f('rec_0.mcap'), f('rec_10.mcap'), f('rec_1.mcap')]);
    expect(groups).toHaveLength(1);
    // Index order, not lexical: _10 sorts after _2.
    expect(groups[0]!.files.map((x) => x.name)).toEqual(['rec_0.mcap', 'rec_1.mcap', 'rec_2.mcap', 'rec_10.mcap']);
    expect(groups[0]!.displayName).toBe('rec (4 of 11 parts)');
    expect(groups[0]!.missing).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it('reports a complete split without a missing list', () => {
    const [g] = groupBagFiles([f('a_0.db3'), f('a_1.db3'), f('a_2.db3')]);
    expect(g!.displayName).toBe('a (3 parts)');
    expect(g!.missing).toEqual([]);
  });

  it('notes a missing middle part but still groups the rest', () => {
    const [g] = groupBagFiles([f('a_0.mcap'), f('a_1.mcap'), f('a_3.mcap')]);
    expect(g!.files).toHaveLength(3);
    expect(g!.missing).toEqual([3]);
    expect(g!.displayName).toBe('a (3 of 4 parts)');
  });

  it('does NOT merge separate numbered runs that do not start at 0', () => {
    const groups = groupBagFiles([f('run_1.mcap'), f('run_2.mcap')]);
    expect(names(groups)).toEqual([['run_1.mcap'], ['run_2.mcap']]);
  });

  it('does not merge different extensions, stems, or folders', () => {
    expect(names(groupBagFiles([f('a_0.mcap'), f('a_1.db3')]))).toEqual([['a_0.mcap'], ['a_1.db3']]);
    expect(names(groupBagFiles([f('a_0.mcap'), f('b_1.mcap')]))).toEqual([['a_0.mcap'], ['b_1.mcap']]);
    const groups = groupBagFiles([f('a_0.mcap', 'day1'), f('a_1.mcap', 'day2')]);
    expect(groups).toHaveLength(2);
  });

  it('keeps two separate splits in one drop apart', () => {
    const groups = groupBagFiles([f('x_0.mcap', 'x'), f('x_1.mcap', 'x'), f('y_0.mcap', 'y'), f('y_1.mcap', 'y')]);
    expect(names(groups)).toEqual([['x_0.mcap', 'x_1.mcap'], ['y_0.mcap', 'y_1.mcap']]);
  });

  it('refuses duplicate indices from two sources', () => {
    expect(groupBagFiles([f('a_0.mcap', 'p'), f('a_0.mcap', 'p'), f('a_1.mcap', 'p')])).toHaveLength(3);
  });

  it('a lone numbered file is just a file', () => {
    expect(names(groupBagFiles([f('a_0.mcap')]))).toEqual([['a_0.mcap']]);
  });

  it('never groups point clouds or splats', () => {
    expect(groupBagFiles([f('s_0.ply'), f('s_1.ply')])).toHaveLength(2);
  });

  it('drops unsupported files and keeps first-appearance order', () => {
    const groups = groupBagFiles([f('notes.txt'), f('b.mcap'), f('metadata.yaml'), f('a_0.mcap'), f('a_1.mcap'), f('c.pcd')]);
    expect(names(groups)).toEqual([['b.mcap'], ['a_0.mcap', 'a_1.mcap'], ['c.pcd']]);
  });

  it('returns nothing when no file is supported', () => {
    expect(groupBagFiles([f('metadata.yaml'), f('readme.md')])).toEqual([]);
  });
});

describe('metadata.yaml', () => {
  const yaml = `rosbag2_bagfile_information:
  version: 5
  storage_identifier: mcap
  relative_file_paths:
    - rosbag2_2024_0.mcap
    - "rosbag2_2024_1.mcap"
    - 'sub/rosbag2_2024_2.mcap'
  duration:
    nanoseconds: 1
`;

  it('reads block-style paths, quoted or nested', () => {
    expect(parseRosbag2Metadata(yaml)).toEqual(['rosbag2_2024_0.mcap', 'rosbag2_2024_1.mcap', 'rosbag2_2024_2.mcap']);
  });

  it('reads flow style and CRLF line endings', () => {
    expect(parseRosbag2Metadata('relative_file_paths: [a_0.db3, b_1.db3]')).toEqual(['a_0.db3', 'b_1.db3']);
    expect(parseRosbag2Metadata(yaml.replace(/\n/g, '\r\n'))).toHaveLength(3);
  });

  it('returns nothing for text without the key', () => {
    expect(parseRosbag2Metadata('hello: world')).toEqual([]);
    expect(parseRosbag2Metadata('')).toEqual([]);
  });

  it('is authoritative, grouping parts whose names break the numbering rule', () => {
    const text = 'relative_file_paths:\n  - run_a.mcap\n  - run_b.mcap\n';
    const groups = groupBagFiles([f('run_a.mcap'), f('run_b.mcap'), f('other.mcap'), f('metadata.yaml')], text);
    expect(names(groups)).toEqual([['run_a.mcap', 'run_b.mcap'], ['other.mcap']]);
    expect(groups[0]!.displayName).toContain('2 parts');
  });

  it('flags metadata that lists more parts than were provided', () => {
    const text = 'relative_file_paths:\n  - r_0.mcap\n  - r_1.mcap\n  - r_2.mcap\n';
    const [g] = groupBagFiles([f('r_0.mcap'), f('r_1.mcap')], text);
    expect(g!.displayName).toBe('r (2 of 3 parts)');
  });
});
