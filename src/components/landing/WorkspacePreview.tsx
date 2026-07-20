import { motion, useReducedMotion } from 'framer-motion';

const TOPICS = [
  { name: '/lidar/points', type: 'PointCloud2', color: '#56f6b2', count: '18.4K' },
  { name: '/camera/front', type: 'Image', color: '#49bfff', count: '30 Hz' },
  { name: '/tf', type: 'TFMessage', color: '#8e83ff', count: '2.1K' },
  { name: '/vehicle/odom', type: 'Odometry', color: '#f7c96c', count: '100 Hz' },
];

export function WorkspacePreview() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      className="workspace-preview"
      initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.28, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      aria-label="BAGEL workspace preview"
    >
      <div className="workspace-preview__bar">
        <div className="workspace-preview__file">
          <span className="status-dot status-dot--live" />
          warehouse_run_07.mcap
        </div>
        <div className="workspace-preview__bar-stats">
          <span>12:48</span><span>4.7M msgs</span><span>8.2 GB</span>
        </div>
      </div>

      <div className="workspace-preview__body">
        <aside className="topic-rail" aria-label="Preview topics">
          <div className="topic-rail__label">TOPICS / 64</div>
          {TOPICS.map((topic, index) => (
            <motion.div
              key={topic.name}
              className={index === 0 ? 'topic-rail__item topic-rail__item--active' : 'topic-rail__item'}
              initial={reduceMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + index * 0.07, duration: 0.4 }}
            >
              <span className="topic-rail__swatch" style={{ background: topic.color }} />
              <span className="topic-rail__copy"><strong>{topic.name}</strong><small>{topic.type}</small></span>
              <small>{topic.count}</small>
            </motion.div>
          ))}
        </aside>

        <div className="viewport-card">
          <div className="viewport-card__chrome">
            <span>3D VIEWPORT</span>
            <span className="viewport-card__mode"><i /> MAP FRAME</span>
          </div>
          <div className="viewport-card__scene">
            <div className="viewport-card__grid" />
            <div className="viewport-card__scan viewport-card__scan--one" />
            <div className="viewport-card__scan viewport-card__scan--two" />
            <div className="viewport-card__route" />
            <div className="viewport-card__vehicle"><span /></div>
            <div className="viewport-card__axis"><i className="axis-x" /><i className="axis-y" /><i className="axis-z" /></div>
            <div className="viewport-card__readout"><span>X&nbsp; 14.204</span><span>Y&nbsp; -2.810</span><span>Z&nbsp; 0.034</span></div>
          </div>
        </div>
      </div>

      <PreviewTimeline />
    </motion.section>
  );
}

function PreviewTimeline() {
  return (
    <div className="preview-timeline" aria-label="Playback timeline preview">
      <button type="button" className="preview-play" aria-label="Play preview" tabIndex={-1}>
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.7 2.9v10.2L13 8 4.7 2.9Z" /></svg>
      </button>
      <span className="preview-time">00:04:21.084</span>
      <div className="preview-timeline__track">
        <div className="preview-timeline__density" />
        <div className="preview-timeline__fill" />
        <motion.span className="preview-timeline__playhead" animate={{ left: ['42%', '68%', '42%'] }} transition={{ duration: 9, ease: 'easeInOut', repeat: Infinity }} />
      </div>
      <span className="preview-time preview-time--muted">00:12:48.219</span>
      <button type="button" className="preview-speed" tabIndex={-1}>1.0x</button>
    </div>
  );
}
