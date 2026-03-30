import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/schema.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username });
  res.json({ token, username: user.username });
});

router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  res.json({ user: req.user });
});

router.post('/change-password', authMiddleware, (req: Request, res: Response): void => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: 'Old and new password required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as UserRow;

  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    res.status(401).json({ error: 'Invalid old password' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password changed' });
});

export default router;
