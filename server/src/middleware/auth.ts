import { Request, Response, NextFunction } from 'express';
import { verifySessionToken, SessionPayload } from '../services/auth';

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload & { _id: string };
    }
  }
}

export function extractToken(req: Request): string | null {
  // 1. Check Authorization Bearer header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Check Cookie header (fg_session)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc: Record<string, string>, str) => {
      const [key, ...v] = str.trim().split('=');
      if (key) acc[key] = decodeURIComponent(v.join('='));
      return acc;
    }, {});
    if (cookies.fg_session) {
      return cookies.fg_session;
    }
  }

  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    return;
  }

  req.user = { ...payload, _id: payload.userId };
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifySessionToken(token);
    if (payload) {
      req.user = { ...payload, _id: payload.userId };
    }
  }
  next();
}
