/**
 * Layout import. The layouts below are written for these tests but follow the
 * structures found in published ones (Nav2, Autoware, Isaac ROS,
 * ros2_control_demos, quad-sdk, PlotJuggler's pj4 fixtures): nested mosaics,
 * Tab panels, both Image config styles, indexed and filtered plot paths,
 * classic and pj4 PlotJuggler curves, XY plots, several tabs.
 */
import { describe, it, expect } from 'vitest';
import { importLayout, splitPath } from '../../src/utils/layoutImport';
import { getAllPanels, type LayoutNode } from '../../src/store/layoutStore';
import type { TopicInfo } from '../../src/types/bag';

const t = (name: string, type: string): TopicInfo => ({ name, type, messageCount: 10, serializationFormat: 'cdr' });
const TOPICS = [
  t('/scan', 'sensor_msgs/msg/LaserScan'),
  t('/points', 'sensor_msgs/msg/PointCloud2'),
  t('/map', 'nav_msgs/msg/OccupancyGrid'),
  t('/diagnostics', 'diagnostic_msgs/msg/DiagnosticArray'),
  t('/rosout', 'rcl_interfaces/msg/Log'),
  t('/camera/image_raw', 'sensor_msgs/msg/Image'),
  t('/camera/compressed', 'sensor_msgs/msg/CompressedImage'),
  t('/odom', 'nav_msgs/msg/Odometry'),
  t('/cmd_vel', 'geometry_msgs/msg/TwistStamped'),
  t('/controller/cmd_vel_out', 'geometry_msgs/msg/TwistStamped'),
  t('/control/diagnostic', 'tier4_debug_msgs/msg/Float32MultiArrayStamped'),
  t('/robot_1/control/grfs', 'quad_msgs/msg/GRFArray'),
  t('/robot_1/state', 'quad_msgs/msg/RobotState'),
];
const NAMES = TOPICS.map((x) => x.name);

/** The tree as `kind:topic` leaves and `H[...]` / `V[...]` splits, for compact assertions. */
const shape = (n: LayoutNode | null): string =>
  !n ? '-' : n.node === 'panel' ? `${n.kind}:${n.topicName}` : `${n.orientation === 'horizontal' ? 'H' : 'V'}[${n.children.map(shape).join(', ')}]`;

describe('splitPath', () => {
  it('picks the longest topic and converts the field to BAGEL paths', () => {
    expect(splitPath('/controller/cmd_vel_out.twist.linear.x', [...NAMES, '/controller'], '.')).toEqual(['/controller/cmd_vel_out', 'twist.linear.x']);
    expect(splitPath('/control/diagnostic.data[36]', NAMES, '.')).toEqual(['/control/diagnostic', 'data[36]']);
    expect(splitPath('/robot_1/control/grfs/vectors.0/x', NAMES, '/')).toEqual(['/robot_1/control/grfs', 'vectors[0].x']);
    expect(splitPath('/control/diagnostic/data[5]', NAMES, '/')).toEqual(['/control/diagnostic', 'data[5]']);
    expect(splitPath('/odometry.pose', NAMES, '.')).toBeNull(); // /odom is a prefix of the text, not of the topic
  });
});

describe('Foxglove layouts', () => {
  const nav = {
    configById: {
      '3D!a': { followTf: 'map', topics: { '/scan': { visible: true }, '/map': { visible: true }, '/points': { visible: false } } },
      'DiagnosticSummary!b': { topicToRender: '/diagnostics' },
      'RosOut!c': {},
      '3D!d': { topics: { '/scan': { visible: true } } },
      'Teleop!e': { topic: '/cmd_vel' },
    },
    layout: {
      first: '3D!a',
      second: { first: 'DiagnosticSummary!b', second: { first: 'RosOut!c', second: { first: '3D!d', second: 'Teleop!e', direction: 'row' }, direction: 'column' }, direction: 'column' },
      direction: 'row',
      splitPercentage: 70,
    },
  };

  it('keeps the split tree and maps each panel kind', () => {
    const r = importLayout(JSON.stringify(nav), TOPICS, 'b1');
    expect(r.source).toBe('foxglove');
    // The second 3D panel on /scan merges into the first; the Teleop panel is dropped.
    expect(shape(r.root)).toBe('H[3d:/scan, V[diagnostic:/diagnostics, log:/rosout]]');
    expect(r.notes).toContain('Teleop panels have no BAGEL equivalent and were left out.');
    expect(r.notes.some((n) => n.startsWith('2 3d panels on /scan became one'))).toBe(true);
    const leaf = getAllPanels(r.root!)[0]!;
    expect(leaf).toMatchObject({ id: '3d:b1:/scan', type: 'sensor_msgs/msg/LaserScan', bagId: 'b1' });
  });

  it('prefers a point cloud for the 3D panel, and reads both Image config styles and Raw paths', () => {
    const doc = {
      configById: {
        '3D!a': { topics: { '/map': { visible: true }, '/points': { visible: true } } },
        'Image!b': { imageMode: { imageTopic: '/camera/image_raw' } },
        'Image!c': { cameraTopic: '/camera/compressed' },
        'RawMessages!d': { topicPath: '/odom.pose.pose' },
        'Image!e': { imageMode: { imageTopic: '/not/recorded' } },
      },
      layout: { first: { first: '3D!a', second: 'Image!b', direction: 'row' }, second: { first: 'Image!c', second: { first: 'RawMessages!d', second: 'Image!e', direction: 'row' }, direction: 'row' }, direction: 'column' },
    };
    const r = importLayout(JSON.stringify(doc), TOPICS, 'b1');
    expect(shape(r.root)).toBe('V[H[3d:/points, image:/camera/image_raw], H[image:/camera/compressed, raw:/odom]]');
    expect(r.notes).toContain('/not/recorded is not in this bag.');
  });

  it('maps plot paths to fields, other topics to extra series, and skips filters', () => {
    const doc = {
      configById: {
        'Plot!a': { paths: [
          { value: '/cmd_vel.twist.linear.x' },
          { value: '/controller/cmd_vel_out.twist.linear.x' },
          { value: '/cmd_vel.twist.angular.z' },
          { value: '/odom.pose.pose.position{x>0}.x' },
          { value: '/odom.twist.twist.linear.x.@derivative' },
        ] },
      },
      layout: 'Plot!a',
    };
    const r = importLayout(JSON.stringify(doc), TOPICS, 'b1');
    expect(shape(r.root)).toBe('plot:/cmd_vel');
    const p = r.plots['plot:b1:/cmd_vel']!;
    expect(p.onlyFields).toEqual(['twist.linear.x', 'twist.angular.z']);
    expect(p.extraSeries).toEqual([{ id: expect.any(String), bagId: 'b1', topic: '/controller/cmd_vel_out', field: 'twist.linear.x', alias: 'cmd_vel_out.twist.linear.x' }]);
    expect(r.notes.filter((n) => n.startsWith('Filters and modifiers'))).toHaveLength(2);
  });

  it('merges several plots of one topic, keeping every field once', () => {
    const plot = (...idx: number[]) => ({ paths: idx.map((i) => ({ value: `/control/diagnostic.data[${i}]` })) });
    const doc = { configById: { 'Plot!a': plot(2, 1), 'Plot!b': plot(3, 1), 'Plot!c': plot(36) }, layout: { first: 'Plot!a', second: { first: 'Plot!b', second: 'Plot!c', direction: 'column' }, direction: 'column' } };
    const r = importLayout(JSON.stringify(doc), TOPICS);
    expect(shape(r.root)).toBe('plot:/control/diagnostic');
    expect(r.plots['plot:/control/diagnostic']!.onlyFields).toEqual(['data[2]', 'data[1]', 'data[3]', 'data[36]']);
    expect(r.notes).toContain('3 plot panels on /control/diagnostic became one (BAGEL shows each topic once per panel kind); all their fields are kept.');
  });

  it('opens the active tab of a Tab panel, and a single-panel layout', () => {
    const doc = {
      configById: {
        'Tab!t': { activeTabIdx: 1, tabs: [{ title: 'Map', layout: '3D!a' }, { title: 'Logs', layout: { first: 'RosOut!b', second: 'DiagnosticSummary!c', direction: 'row' } }] },
        '3D!a': { topics: { '/map': { visible: true } } },
        'RosOut!b': {},
        'DiagnosticSummary!c': {},
      },
      layout: 'Tab!t',
    };
    const r = importLayout(JSON.stringify(doc), TOPICS);
    expect(shape(r.root)).toBe('H[log:/rosout, diagnostic:/diagnostics]');
    expect(r.notes).toContain('Only the open tab ("Logs") of a tabbed layout is imported.');
  });

  it('says so when nothing matches', () => {
    const r = importLayout(JSON.stringify({ configById: { 'Image!a': { imageMode: { imageTopic: '/x' } } }, layout: 'Image!a' }), TOPICS);
    expect(r.root).toBeNull();
    expect(r.notes).toContain('Nothing in the layout matched a topic in this bag.');
  });
});

describe('PlotJuggler layouts', () => {
  const classic = `<?xml version='1.0' encoding='UTF-8'?>
<root>
 <tabbed_widget parent="main_window" name="Main Window">
  <Tab containers="1" tab_name="Ignored">
   <Container><DockSplitter orientation="-" sizes="1" count="1"><DockArea name="..."><plot mode="TimeSeries"><curve name="/odom/pose/pose/position/x"/></plot></DockArea></DockSplitter></Container>
  </Tab>
  <Tab containers="1" tab_name="DiffBot">
   <Container>
    <DockSplitter orientation="-" sizes="0.5;0.5" count="2">
     <DockSplitter orientation="|" sizes="0.5;0.5" count="2">
      <DockArea name="...">
       <plot flip_y="false" mode="TimeSeries" style="LinesAndDots">
        <range top="1" bottom="0" right="10" left="0"/>
        <limitY/>
        <curve name="/cmd_vel/twist/linear/x" color="#f1854c"/>
        <curve name="/controller/cmd_vel_out/twist/linear/x" color="#d62728"/>
       </plot>
      </DockArea>
      <DockArea name="...">
       <plot mode="XYPlot" style="Dots">
        <curve curve_x="/robot_1/control/grfs/vectors.0/x" curve_y="/robot_1/control/grfs/vectors.0/y" name="/robot_1/control/grfs/vectors.0/[x;y]" color="#00843d"/>
       </plot>
      </DockArea>
     </DockSplitter>
     <DockArea name="...">
      <plot mode="TimeSeries"><curve name="/control/diagnostic/data[5]"/><curve name="/not/here/x"/></plot>
     </DockArea>
    </DockSplitter>
   </Container>
  </Tab>
  <currentTabIndex index="1"/>
 </tabbed_widget>
 <use_relative_time_offset enabled="1"/>
</root>`;

  it('keeps the dock splitters, curves and XY plots of the open tab', () => {
    const r = importLayout(classic, TOPICS, 'b1');
    expect(r.source).toBe('plotjuggler');
    // "-" stacks children top to bottom, "|" puts them side by side.
    expect(shape(r.root)).toBe('V[H[plot:/cmd_vel, plot:/robot_1/control/grfs], plot:/control/diagnostic]');
    expect(r.plots['plot:b1:/cmd_vel']).toMatchObject({ onlyFields: ['twist.linear.x'], extraSeries: [expect.objectContaining({ topic: '/controller/cmd_vel_out', field: 'twist.linear.x' })] });
    expect(r.plots['plot:b1:/robot_1/control/grfs']).toEqual({ onlyFields: ['vectors[0].x', 'vectors[0].y'], xyX: 'vectors[0].x' });
    expect(r.plots['plot:b1:/control/diagnostic']!.onlyFields).toEqual(['data[5]']);
    expect(r.notes).toContain('Only the open tab ("DiffBot") of 2 is imported.');
    expect(r.notes).toContain('/not/here/x is not in this bag.');
  });

  it('reads pj4 curves (topic and field apart) and notes views it cannot show', () => {
    const pj4 = `<?xml version='1.0' encoding='UTF-8'?>
<root binding="generic" format="PlotJuggler" pj4_version="4">
  <tabbed_widget id="" name="main" parent="main_window">
    <Tab containers="1" tab_name="tab1"><Container>
      <DockSplitter count="2" orientation="|" sizes="0.5;0.5">
        <DockArea name="..."><plot mode="TimeSeries"><curve color="#1f77b4" field="pose/pose/position/x" topic="odom" visible="true"/></plot></DockArea>
        <DockArea name="..."><scene3d camera_model="orbit" version="1"/></DockArea>
      </DockSplitter>
    </Container></Tab>
  </tabbed_widget>
</root>`;
    const r = importLayout(pj4, TOPICS);
    expect(shape(r.root)).toBe('plot:/odom');
    expect(r.plots['plot:/odom']!.onlyFields).toEqual(['pose.pose.position.x']);
    expect(r.notes).toContain('PlotJuggler scene3d views have no BAGEL equivalent and were left out.');
  });
});

describe('bad input', () => {
  it('throws on text that is not a layout, and on broken JSON or XML', () => {
    expect(() => importLayout('hello', TOPICS)).toThrow(/Not a layout/);
    expect(() => importLayout('{"layout": ', TOPICS)).toThrow();
    expect(() => importLayout('<root><tabbed_widget>', TOPICS)).toThrow();
    expect(() => importLayout('<root/>', TOPICS)).toThrow(/no <tabbed_widget>/);
  });
  it('treats an empty or odd Foxglove document as having nothing to import', () => {
    for (const doc of [{}, { layout: null }, { layout: 42 }, { layout: 'Plot!x' }]) {
      expect(importLayout(JSON.stringify(doc), TOPICS).root).toBeNull();
    }
  });
});
