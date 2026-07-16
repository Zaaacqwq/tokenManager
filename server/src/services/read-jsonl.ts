import fs from 'fs';
import { StringDecoder } from 'string_decoder';

const CHUNK_SIZE = 1024 * 1024; // 1MB

/**
 * Synchronous generator yielding one non-empty line at a time from a JSONL
 * file. Reads in 1MB chunks so memory stays bounded regardless of file size
 * (session files can exceed 100MB — reading them whole caused an OOM crash
 * loop, see OOM-FIX-NOTES.md on the VPS). Synchronous on purpose: callers
 * iterate inside better-sqlite3 transactions. StringDecoder keeps multi-byte
 * UTF-8 sequences split across chunk boundaries intact.
 */
export function* readJsonlLines(file: string): Generator<string> {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK_SIZE);
    const decoder = new StringDecoder('utf-8');
    let remainder = '';
    let bytesRead: number;

    while ((bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, null)) > 0) {
      const text = remainder + decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) yield line;
      }
    }

    const tail = remainder + decoder.end();
    if (tail.trim()) yield tail;
  } finally {
    fs.closeSync(fd);
  }
}
