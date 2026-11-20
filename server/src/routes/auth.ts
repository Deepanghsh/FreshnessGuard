import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createUser,
  findUserByEmail,
  findUserById,
  verifyPassword,
  createSessionToken,
  getGoogleOAuthUrl,
  handleGoogleCallback,
  createPasswordResetToken,
  resetPasswordWithToken,
  updateUserProfile,
  exportUserData,
  deleteUserAccount,
  toSafeUser,
  generateOAuthState,
  isGoogleAuthConfigured,
  getOrCreateDemoUser,
} from '../services/auth';
import { requireAuth, optionalAuth } from '../middleware/auth';

const router = Router();

const RegisterSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters').max(100),
});

const LoginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const ForgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
});

const ResetPasswordSchema = z.object({
  token: z.string().trim().min(10, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
});

const ProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  avatarUrl: z.string().trim().url().optional().or(z.literal('')),
  preferences: z.object({
    theme: z.enum(['dark', 'light']).optional(),
    defaultModel: z.string().optional(),
    defaultMode: z.enum(['inline', 'async', 'basic', 'bypass']).optional(),
  }).optional(),
});

function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  // Use Express res.cookie
  res.cookie('fg_session', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('fg_session', '', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    expires: new Date(0),
    path: '/',
  });
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, displayName } = RegisterSchema.parse(req.body);

    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const user = await createUser({
      email,
      password,
      displayName,
      authProvider: 'local',
    });

    const token = createSessionToken(user);
    setSessionCookie(res, token);

    res.status(201).json({
      message: 'Account created successfully',
      user: toSafeUser(user),
      token,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    next(err);
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = createSessionToken(user);
    setSessionCookie(res, token);

    res.json({
      message: 'Logged in successfully',
      user: toSafeUser(user),
      token,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    next(err);
  }
});

// ─── GET /api/auth/providers ──────────────────────────────────────────────────
router.get('/providers', (_req: Request, res: Response) => {
  res.json({
    google: isGoogleAuthConfigured(),
  });
});

// ─── POST /api/auth/demo ──────────────────────────────────────────────────────
router.post('/demo', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const demoUser = await getOrCreateDemoUser();
    const token = createSessionToken(demoUser);
    setSessionCookie(res, token);
    res.json({
      message: 'Signed into Demo Workspace successfully',
      user: toSafeUser(demoUser),
      token,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/google ─────────────────────────────────────────────────────
router.get('/google', (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    if (!isGoogleAuthConfigured()) {
      const msg = encodeURIComponent(
        'Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not configured in server/.env. You can sign in immediately using Email & Password or use the Quick Demo Workspace.'
      );
      res.redirect(`${frontendUrl}/login?error=${msg}`);
      return;
    }

    const state = generateOAuthState();
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('fg_oauth_state', state, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
      path: '/',
    });

    const redirectUrl = getGoogleOAuthUrl(state);
    res.redirect(redirectUrl);
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message);
    res.redirect(`${frontendUrl}/login?error=${msg}`);
  }
});

// ─── GET /api/auth/google/callback ─────────────────────────────────────────────
router.get('/google/callback', async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const { code, state, error } = req.query;

    if (error) {
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(String(error))}`);
      return;
    }

    if (!code || typeof code !== 'string') {
      res.redirect(`${frontendUrl}/login?error=missing_auth_code`);
      return;
    }

    // Validate state cookie for CSRF protection
    const cookies = req.headers.cookie?.split(';').reduce((acc: Record<string, string>, str) => {
      const [k, ...v] = str.trim().split('=');
      if (k) acc[k] = decodeURIComponent(v.join('='));
      return acc;
    }, {}) || {};

    const savedState = cookies.fg_oauth_state;
    if (!savedState || savedState !== state) {
      res.redirect(`${frontendUrl}/login?error=invalid_csrf_state`);
      return;
    }

    const user = await handleGoogleCallback(code);
    const token = createSessionToken(user);
    setSessionCookie(res, token);

    // Clear state cookie
    res.cookie('fg_oauth_state', '', { maxAge: 0, path: '/' });

    res.redirect(`${frontendUrl}/?auth_success=1&token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('[FreshnessGuard Auth] Google OAuth callback error:', (err as Error).message);
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent((err as Error).message)}`);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await findUserById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'User account not found' });
      return;
    }
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = ForgotPasswordSchema.parse(req.body);
    const token = await createPasswordResetToken(email);

    // In production we would dispatch an email. In our system, return the token for testing/demo workflows
    res.json({
      message: 'If an account exists with that email, a password reset link has been prepared.',
      ...(process.env.NODE_ENV !== 'production' && token ? { resetToken: token } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = ResetPasswordSchema.parse(req.body);
    const success = await resetPasswordWithToken(token, password);

    if (!success) {
      res.status(400).json({ error: 'Invalid or expired password reset token' });
      return;
    }

    res.json({ message: 'Password has been successfully updated. You can now log in.' });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ProfileUpdateSchema.parse(req.body);
    const updated = await updateUserProfile(req.user!.userId, parsed);

    if (!updated) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      message: 'Profile updated successfully',
      user: toSafeUser(updated),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    next(err);
  }
});

// ─── GET /api/auth/export ─────────────────────────────────────────────────────
router.get('/export', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const exportBundle = await exportUserData(req.user!.userId);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="freshnessguard_export_${Date.now()}.json"`);
    res.json(exportBundle);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/auth/account ─────────────────────────────────────────────────
router.delete('/account', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const success = await deleteUserAccount(req.user!.userId);
    if (!success) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    clearSessionCookie(res);
    res.json({ message: 'Account and personal workspace data permanently deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
