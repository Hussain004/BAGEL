/**
 * Panel components by kind, loaded on demand: the 3D scene, the splat viewer
 * and the rest only download when a panel of that kind is first opened, so the
 * entry chunk carries none of them.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PanelKind } from '../../store/layoutStore';

export interface PanelProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

const panel = <K extends string>(load: () => Promise<Record<K, ComponentType<PanelProps>>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));

export const PANEL_COMPONENTS: Record<PanelKind, LazyExoticComponent<ComponentType<PanelProps>>> = {
  plot: panel(() => import('./TimeSeriesPlot'), 'TimeSeriesPlot'),
  image: panel(() => import('./ImageViewer'), 'ImageViewer'),
  raw: panel(() => import('./RawMessageInspector'), 'RawMessageInspector'),
  trajectory: panel(() => import('./TrajectoryPlot'), 'TrajectoryPlot'),
  tf: panel(() => import('./TFTree'), 'TFTree'),
  '3d': panel(() => import('./ThreeDScene'), 'ThreeDScene'),
  diagnostic: panel(() => import('./DiagnosticArray'), 'DiagnosticArray'),
  log: panel(() => import('./Log'), 'Log'),
  health: panel(() => import('./BagHealth'), 'BagHealth'),
  splat: panel(() => import('./SplatViewer'), 'SplatViewer'),
  state: panel(() => import('./StateTransitions'), 'StateTransitions'),
  search: panel(() => import('./Search'), 'SearchPanel'),
};
