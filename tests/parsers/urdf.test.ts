import { describe, it, expect } from 'vitest';
import { parseUrdf, extractPackageNames } from '../../src/parsers/urdf';

const PRIMITIVES_URDF = `<?xml version="1.0"?>
<robot name="test_bot">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.1" rpy="0 0 0"/>
      <geometry>
        <box size="0.4 0.3 0.1"/>
      </geometry>
      <material name="body"><color rgba="0.2 0.4 0.7 1"/></material>
    </visual>
  </link>
  <link name="wheel">
    <visual>
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry>
        <cylinder radius="0.08" length="0.04"/>
      </geometry>
    </visual>
  </link>
  <link name="ball">
    <visual>
      <geometry>
        <sphere radius="0.05"/>
      </geometry>
    </visual>
  </link>
  <joint name="base_to_wheel" type="continuous">
    <parent link="base_link"/>
    <child link="wheel"/>
    <origin xyz="0.15 0.17 0.0" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
  </joint>
  <joint name="base_to_ball" type="fixed">
    <parent link="base_link"/>
    <child link="ball"/>
    <origin xyz="0 0 0.5" rpy="0 0 0"/>
  </joint>
</robot>`;

const MESH_URDF = `<?xml version="1.0"?>
<robot name="mesh_bot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://robot_pkg/meshes/base.stl" scale="0.5 0.5 0.5"/>
      </geometry>
    </visual>
  </link>
  <link name="arm">
    <visual>
      <geometry>
        <mesh filename="package://robot_pkg/meshes/arm.dae"/>
      </geometry>
    </visual>
  </link>
  <link name="gripper">
    <visual>
      <geometry>
        <mesh filename="package://gripper_pkg/meshes/grip.obj"/>
      </geometry>
    </visual>
  </link>
  <joint name="base_arm" type="revolute">
    <parent link="base_link"/>
    <child link="arm"/>
    <origin xyz="0 0 0.3" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="arm_grip" type="revolute">
    <parent link="arm"/>
    <child link="gripper"/>
    <origin xyz="0 0 0.5" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <mimic joint="base_arm" multiplier="0.5" offset="0.1"/>
  </joint>
</robot>`;

const XACRO_URDF = `<?xml version="1.0"?>
<robot name="xacro_bot" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:include filename="$(find robot_description)/urdf/base.xacro"/>
  <link name="base_link"/>
</robot>`;

const NAMED_MATERIAL_URDF = `<?xml version="1.0"?>
<robot name="named_mat">
  <material name="grey"><color rgba="0.5 0.5 0.5 1"/></material>
  <link name="base_link">
    <visual>
      <geometry><box size="1 1 1"/></geometry>
      <material name="grey"/>
    </visual>
  </link>
</robot>`;

const MISSING_ORIGIN_URDF = `<?xml version="1.0"?>
<robot name="no_origin">
  <link name="base_link">
    <visual>
      <geometry><sphere radius="1"/></geometry>
    </visual>
  </link>
</robot>`;

describe('parseUrdf', () => {
  it('parses primitives (box, cylinder, sphere) with origins', () => {
    const { model, warnings } = parseUrdf(PRIMITIVES_URDF);

    expect(model.name).toBe('test_bot');
    expect(warnings).toHaveLength(0);
    expect(model.links.size).toBe(3);
    expect(model.joints.size).toBe(2);

    const base = model.links.get('base_link');
    expect(base?.visuals[0].geometry).toEqual({ kind: 'box', size: [0.4, 0.3, 0.1] });
    expect(base?.visuals[0].origin?.xyz).toEqual([0, 0, 0.1]);
    expect(base?.visuals[0].material?.color?.rgba).toEqual([0.2, 0.4, 0.7, 1]);

    const wheel = model.links.get('wheel');
    expect(wheel?.visuals[0].geometry).toEqual({
      kind: 'cylinder',
      radius: 0.08,
      length: 0.04,
    });

    const ball = model.links.get('ball');
    expect(ball?.visuals[0].geometry).toEqual({ kind: 'sphere', radius: 0.05 });
    // No <origin> defaults to undefined; renderer treats as identity.
    expect(ball?.visuals[0].origin).toBeUndefined();
  });

  it('parses meshes with scale and tracks every URI', () => {
    const { model, warnings } = parseUrdf(MESH_URDF);

    expect(warnings).toHaveLength(0);
    expect(model.meshUris).toEqual([
      'package://gripper_pkg/meshes/grip.obj',
      'package://robot_pkg/meshes/arm.dae',
      'package://robot_pkg/meshes/base.stl',
    ]);

    const baseMesh = model.links.get('base_link')?.visuals[0].geometry;
    expect(baseMesh).toEqual({
      kind: 'mesh',
      uri: 'package://robot_pkg/meshes/base.stl',
      scale: [0.5, 0.5, 0.5],
    });

    const armMesh = model.links.get('arm')?.visuals[0].geometry;
    // No `scale=` attr should default to (1, 1, 1).
    expect(armMesh).toEqual({
      kind: 'mesh',
      uri: 'package://robot_pkg/meshes/arm.dae',
      scale: [1, 1, 1],
    });

    expect(extractPackageNames(model)).toEqual(['gripper_pkg', 'robot_pkg']);

    // Joint with limits.
    const baseArm = model.joints.get('base_arm');
    expect(baseArm?.type).toBe('revolute');
    expect(baseArm?.limit).toEqual({ lower: -3.14, upper: 3.14 });
    expect(baseArm?.axis).toEqual([0, 0, 1]);

    // Joint with mimic.
    const armGrip = model.joints.get('arm_grip');
    expect(armGrip?.mimic).toEqual({
      joint: 'base_arm',
      multiplier: 0.5,
      offset: 0.1,
    });
  });

  it('handles missing optional <origin> elements', () => {
    const { model, warnings } = parseUrdf(MISSING_ORIGIN_URDF);
    expect(warnings).toHaveLength(0);
    const visual = model.links.get('base_link')?.visuals[0];
    expect(visual?.origin).toBeUndefined();
    expect(visual?.geometry).toEqual({ kind: 'sphere', radius: 1 });
  });

  it('walks the joint hierarchy and discovers root links', () => {
    const { model } = parseUrdf(PRIMITIVES_URDF);
    // base_link is never a child; wheel + ball are children of joints.
    expect(model.rootLinks).toEqual(['base_link']);
  });

  it('rejects malformed XML with a clear error', () => {
    expect(() => parseUrdf('<robot><link name="oops">')).toThrow(/Malformed URDF XML/);
    expect(() => parseUrdf('<robot><link name="a"><visual><geometry></visual></robot>')).toThrow();
  });

  it('detects xacro tags and refuses to parse', () => {
    expect(() => parseUrdf(XACRO_URDF)).toThrow(/xacro/i);
  });

  it('resolves named materials declared at the top level', () => {
    const { model, warnings } = parseUrdf(NAMED_MATERIAL_URDF);
    expect(warnings).toHaveLength(0);
    const visual = model.links.get('base_link')?.visuals[0];
    expect(visual?.material?.name).toBe('grey');
    expect(visual?.material?.color?.rgba).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('warns about unknown top-level elements like <gazebo> without failing', () => {
    const urdf = `<?xml version="1.0"?>
<robot name="ros1_style">
  <link name="base_link"><visual><geometry><sphere radius="1"/></geometry></visual></link>
  <gazebo reference="base_link"><material>Gazebo/Blue</material></gazebo>
  <gazebo reference="base_link"><something/></gazebo>
  <transmission name="tran1"/>
</robot>`;
    const { model, warnings } = parseUrdf(urdf);
    expect(model.links.size).toBe(1);
    // Deduplicated per element name: one gazebo warning, one transmission warning.
    const kinds = warnings.map((w) => `${w.kind}:${w.message.split(' ')[1]}`);
    expect(kinds).toContain('unknown-element:<gazebo>');
    expect(kinds).toContain('unknown-element:<transmission>');
    expect(warnings.filter((w) => w.message.includes('<gazebo>'))).toHaveLength(1);
  });

  it('flags duplicate link and joint names instead of overwriting', () => {
    const urdf = `<?xml version="1.0"?>
<robot name="dup">
  <link name="a"><visual><geometry><sphere radius="1"/></geometry></visual></link>
  <link name="a"><visual><geometry><sphere radius="2"/></geometry></visual></link>
</robot>`;
    const { model, warnings } = parseUrdf(urdf);
    expect(model.links.size).toBe(1);
    expect(model.links.get('a')?.visuals[0].geometry).toEqual({ kind: 'sphere', radius: 1 });
    expect(warnings.some((w) => w.kind === 'duplicate-name')).toBe(true);
  });

  it('throws for empty / non-URDF input', () => {
    expect(() => parseUrdf('')).toThrow(/empty/i);
    expect(() => parseUrdf('<not_a_robot/>')).toThrow(/<robot>/);
  });
});
