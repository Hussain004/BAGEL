/**
 * SQLite DB3 File Parser
 * 
 * Parses ROS2 .db3 bag files using sql.js (SQLite compiled to WASM).
 * DB3 files are SQLite databases with 'topics' and 'messages' tables.
 */

import initSqlJs, { type Database } from 'sql.js';
import type { BagSummary, TopicInfo } from '../types/bag';

// Use Vite's ?url import to get the WASM file URL
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

/**
 * Lazily initialize sql.js WASM module (singleton)
 */
function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }
  return sqlPromise;
}

/**
 * Parse a .db3 ROS2 bag file and return a BagSummary.
 */
export async function parseDb3(file: File): Promise<BagSummary> {
  const SQL = await getSqlJs();
  const buffer = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(buffer));
  
  try {
    const topics = queryTopics(db);
    const { startTime, endTime, messageCounts } = queryMessageStats(db);
    
    // Merge message counts into topics
    for (const topic of topics) {
      topic.messageCount = messageCounts.get(topic.name) ?? 0;
    }
    
    const durationNs = endTime - startTime;
    const duration = Number(durationNs) / 1e9;
    const totalMessageCount = topics.reduce((sum, t) => sum + t.messageCount, 0);
    
    // Calculate frequencies
    if (duration > 0) {
      for (const topic of topics) {
        topic.frequency = Math.round(topic.messageCount / duration * 10) / 10;
      }
    }
    
    return {
      format: 'db3',
      fileName: file.name,
      fileSize: file.size,
      startTime,
      endTime,
      duration,
      totalMessageCount,
      topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally {
    db.close();
  }
}

/**
 * Query the topics table from the SQLite database.
 */
function queryTopics(db: Database): TopicInfo[] {
  const results = db.exec(`
    SELECT id, name, type, serialization_format 
    FROM topics
  `);
  
  if (results.length === 0) return [];
  
  const { values } = results[0];
  return values.map((row) => ({
    name: row[1] as string,
    type: row[2] as string,
    messageCount: 0, // Will be filled from message stats
    serializationFormat: (row[3] as string) || 'cdr',
  }));
}

/**
 * Query message statistics: time range and per-topic message counts.
 * Uses topic_id joins to get counts per topic name.
 */
function queryMessageStats(db: Database): {
  startTime: bigint;
  endTime: bigint;
  messageCounts: Map<string, number>;
} {
  // Get time range
  const timeResult = db.exec(`
    SELECT MIN(timestamp), MAX(timestamp) FROM messages
  `);
  
  let startTime = 0n;
  let endTime = 0n;
  
  if (timeResult.length > 0 && timeResult[0].values.length > 0) {
    const [minTs, maxTs] = timeResult[0].values[0];
    startTime = BigInt(minTs as number);
    endTime = BigInt(maxTs as number);
  }
  
  // Get per-topic message counts
  const countResult = db.exec(`
    SELECT t.name, COUNT(m.id) as msg_count
    FROM messages m
    JOIN topics t ON m.topic_id = t.id
    GROUP BY t.name
  `);
  
  const messageCounts = new Map<string, number>();
  if (countResult.length > 0) {
    for (const row of countResult[0].values) {
      messageCounts.set(row[0] as string, row[1] as number);
    }
  }
  
  return { startTime, endTime, messageCounts };
}
