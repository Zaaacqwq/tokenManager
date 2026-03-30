import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { syncClaudeFromUpload } from '../services/claude-collector.js';

const router = Router();

// POST /api/upload/claude - Upload Claude Code session JSONL data
// Body: { lines: string[] } - array of JSONL lines from session files
router.post('/claude', authMiddleware, (req: Request, res: Response): void => {
  const { lines } = req.body;

  if (!Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: 'lines array required' });
    return;
  }

  const result = syncClaudeFromUpload(lines);
  res.json(result);
});

// POST /api/upload/claude-bulk - Upload raw JSONL text (easier for scripts)
// Body: raw text, each line is a JSON object
router.post('/claude-bulk', authMiddleware, (req: Request, res: Response): void => {
  // Accept text/plain or application/json with { data: "..." }
  let rawData: string;

  if (typeof req.body === 'string') {
    rawData = req.body;
  } else if (req.body?.data) {
    rawData = req.body.data;
  } else {
    res.status(400).json({ error: 'Send JSONL text in body or { data: "..." }' });
    return;
  }

  const lines = rawData.split('\n').filter(Boolean);
  const result = syncClaudeFromUpload(lines);
  res.json(result);
});

export default router;
