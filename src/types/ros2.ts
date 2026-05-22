/**
 * TypeScript interfaces for common ROS2 message types.
 * These mirror the standard ROS2 message definitions.
 */

export interface Time {
  sec: number;
  nanosec: number;
}

export interface Duration {
  sec: number;
  nanosec: number;
}

export interface Header {
  stamp: Time;
  frame_id: string;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Point;
  orientation: Quaternion;
}

export interface PoseStamped {
  header: Header;
  pose: Pose;
}

export interface Twist {
  linear: Vector3;
  angular: Vector3;
}

export interface TwistStamped {
  header: Header;
  twist: Twist;
}

export interface TwistWithCovariance {
  twist: Twist;
  covariance: number[];
}

export interface TwistWithCovarianceStamped {
  header: Header;
  twist: TwistWithCovariance;
}

export interface Odometry {
  header: Header;
  child_frame_id: string;
  pose: { pose: Pose; covariance: number[] };
  twist: { twist: Twist; covariance: number[] };
}

export interface Imu {
  header: Header;
  orientation: Quaternion;
  orientation_covariance: number[];
  angular_velocity: Vector3;
  angular_velocity_covariance: number[];
  linear_acceleration: Vector3;
  linear_acceleration_covariance: number[];
}

export interface NavSatFix {
  header: Header;
  status: { status: number; service: number };
  latitude: number;
  longitude: number;
  altitude: number;
  position_covariance: number[];
  position_covariance_type: number;
}

export interface LaserScan {
  header: Header;
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: number[];
  intensities: number[];
}

export interface TransformStamped {
  header: Header;
  child_frame_id: string;
  transform: {
    translation: Vector3;
    rotation: Quaternion;
  };
}

export interface TFMessage {
  transforms: TransformStamped[];
}
