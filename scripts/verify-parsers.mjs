/**
 * Node.js verification script for BAGEL parsers.
 * Tests both sql.js (db3) and @mcap/core (mcap) against real test files.
 * 
 * Run: node --experimental-vm-modules scripts/verify-parsers.mjs
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// ============================================================
// 1. Test sql.js with the real .db3 file
// ============================================================
async function testDb3() {
  console.log('\n=== Testing DB3 Parser ===\n');
  
  const dbPath = join(
    'C:', 'Users', 'hussa', 'OneDrive - Higher Education Commission',
    'Documents', 'GitHub', 'BAGEL', 'test_files', 'db3', 'sample.625-2.bag2_0.db3'
  );
  
  try {
    // Load sql.js
    const initSqlJs = (await import('sql.js')).default;
    console.log('sql.js import type:', typeof initSqlJs);
    
    const SQL = await initSqlJs();
    console.log('SQL initialized:', typeof SQL.Database);
    
    const fileBuffer = readFileSync(dbPath);
    console.log('File size:', (fileBuffer.length / 1024 / 1024).toFixed(1), 'MB');
    
    const db = new SQL.Database(new Uint8Array(fileBuffer));
    
    // Query topics
    const topics = db.exec('SELECT id, name, type, serialization_format FROM topics');
    console.log('\nTopics found:', topics[0]?.values.length || 0);
    if (topics[0]?.values) {
      for (const row of topics[0].values.slice(0, 10)) {
        console.log(`  [${row[0]}] ${row[1]} → ${row[2]} (${row[3]})`);
      }
      if (topics[0].values.length > 10) {
        console.log(`  ... and ${topics[0].values.length - 10} more`);
      }
    }
    
    // Query message stats
    const timeRange = db.exec('SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM messages');
    if (timeRange[0]?.values.length > 0) {
      const [minTs, maxTs, count] = timeRange[0].values[0];
      const durationSec = (Number(BigInt(maxTs) - BigInt(minTs)) / 1e9).toFixed(1);
      console.log(`\nMessages: ${count}`);
      console.log(`Duration: ${durationSec}s`);
    }
    
    db.close();
    console.log('\n✅ DB3 parsing successful!\n');
  } catch (err) {
    console.error('❌ DB3 parsing failed:', err.message);
  }
}

// ============================================================
// 2. Test @mcap/core with MCAP test files (check if they're valid)
// ============================================================
async function testMcap() {
  console.log('\n=== Testing MCAP Parser ===\n');
  
  const mcapDir = join(
    'C:', 'Users', 'hussa', 'OneDrive - Higher Education Commission',
    'Documents', 'GitHub', 'BAGEL', 'test_files', 'mcap', 'data'
  );
  
  try {
    const { McapStreamReader } = await import('@mcap/core');
    
    // Find a .mcap file with actual messages
    const { readdirSync, statSync } = await import('fs');
    
    // Look for larger mcap files first
    const findMcapFiles = (dir) => {
      const files = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...findMcapFiles(fullPath));
        } else if (entry.name.endsWith('.mcap')) {
          files.push({ path: fullPath, size: statSync(fullPath).size });
        }
      }
      return files;
    };
    
    const mcapFiles = findMcapFiles(mcapDir).sort((a, b) => b.size - a.size);
    console.log(`Found ${mcapFiles.length} .mcap files`);
    console.log(`Largest: ${mcapFiles[0]?.size} bytes, smallest: ${mcapFiles[mcapFiles.length-1]?.size} bytes`);
    
    // Check the magic bytes of the first few files
    for (const file of mcapFiles.slice(0, 5)) {
      const data = readFileSync(file.path);
      const header = Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(data.slice(0, 8)).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
      console.log(`\n  ${file.path.split('\\').pop()} (${file.size}b): ${header} | ${ascii}`);
      
      // Try parsing
      try {
        const reader = new McapStreamReader();
        reader.append(data);
        let schemas = 0, channels = 0, messages = 0;
        for (let record; (record = reader.nextRecord()); ) {
          if (record.type === 'Schema') schemas++;
          if (record.type === 'Channel') channels++;
          if (record.type === 'Message') messages++;
        }
        console.log(`    → Parsed OK: ${schemas} schemas, ${channels} channels, ${messages} messages`);
      } catch (e) {
        console.log(`    → Parse error: ${e.message.slice(0, 80)}`);
      }
    }
    
    console.log('\n✅ MCAP test complete!\n');
  } catch (err) {
    console.error('❌ MCAP test failed:', err.message);
  }
}

// Run both tests
await testDb3();
await testMcap();
