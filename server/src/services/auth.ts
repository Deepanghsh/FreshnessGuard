import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import axios from 'axios';
import path from 'path';
import dotenv from 'dotenv';
import { User, IUser } from '../models/User';
import { Response as ResponseModel } from '../models/Response';

// Ensure environment variables are loaded
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

export function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'freshnessguard_super_secret_session_key_2026';
}

export function reloadEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
  dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
}

export function getGoogleClientId(): string {
  reloadEnv();
  return (process.env.GOOGLE_CLIENT_ID || '').trim();
}

export function getGoogleClientSecret(): string {
  reloadEnv();
  return (process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

export function getGoogleCallbackUrl(): string {
  return process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback';
}

export interface SessionPayload {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  iat: number;
  exp: number;
}

// ─── In-memory user store for degraded mode ──────────────────────────────────
const inMemoryUsers = new Map<string, IUser>();

function toSafeUser(user: any): Partial<IUser> {
  return {
    _id: user._id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider,
    role: user.role,
    preferences: user.preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Password Hashing & Verification ──────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── Signed Session Tokens (HMAC-SHA256) ───────────────────────────────────────
export function createSessionToken(user: { _id: any; email: string; displayName: string; role: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    userId: String(user._id),
    email: user.email,
    displayName: user.displayName,
    role: user.role || 'user',
    iat: now,
    exp: now + 7 * 24 * 3600, // 7 days
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

// ─── State Generation for OAuth CSRF Protection ──────────────────────────────
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── User Repository Operations ──────────────────────────────────────────────
export async function findUserById(id: string): Promise<IUser | null> {
  if (mongoose.connection.readyState === 1) {
    return User.findById(id).lean();
  }
  return inMemoryUsers.get(id) || null;
}

export async function findUserByEmail(email: string): Promise<IUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  if (mongoose.connection.readyState === 1) {
    return User.findOne({ email: cleanEmail }).lean();
  }
  for (const user of inMemoryUsers.values()) {
    if (user.email.toLowerCase() === cleanEmail) return user;
  }
  return null;
}

export async function createUser(data: {
  email: string;
  password?: string;
  displayName: string;
  googleId?: string;
  avatarUrl?: string;
  authProvider?: 'local' | 'google';
}): Promise<IUser> {
  const cleanEmail = data.email.trim().toLowerCase();
  let passwordHash: string | undefined;
  if (data.password) {
    passwordHash = await hashPassword(data.password);
  }

  const defaultPreferences = {
    theme: 'dark' as const,
    defaultModel: 'gemini-1.5-flash',
    defaultMode: 'inline' as const,
  };

  if (mongoose.connection.readyState === 1) {
    const doc = await User.create({
      email: cleanEmail,
      passwordHash,
      displayName: data.displayName.trim(),
      avatarUrl: data.avatarUrl,
      googleId: data.googleId,
      authProvider: data.authProvider || 'local',
      role: 'user',
      preferences: defaultPreferences,
    });
    return doc.toObject();
  }

  // Degraded mode in-memory persistence
  const id = new mongoose.Types.ObjectId();
  const now = new Date();
  const user: IUser = {
    _id: id,
    email: cleanEmail,
    passwordHash,
    displayName: data.displayName.trim(),
    avatarUrl: data.avatarUrl,
    googleId: data.googleId,
    authProvider: data.authProvider || 'local',
    role: 'user',
    preferences: defaultPreferences,
    createdAt: now,
    updatedAt: now,
  };
  inMemoryUsers.set(id.toString(), user);
  return user;
}

export async function updateUserProfile(
  userId: string,
  updates: { displayName?: string; avatarUrl?: string; preferences?: Partial<IUser['preferences']> }
): Promise<IUser | null> {
  if (mongoose.connection.readyState === 1) {
    const updateQuery: any = {};
    if (updates.displayName) updateQuery.displayName = updates.displayName.trim();
    if (updates.avatarUrl !== undefined) updateQuery.avatarUrl = updates.avatarUrl;
    if (updates.preferences) {
      for (const [k, v] of Object.entries(updates.preferences)) {
        updateQuery[`preferences.${k}`] = v;
      }
    }
    return User.findByIdAndUpdate(userId, { $set: updateQuery }, { new: true }).lean();
  }

  const existing = inMemoryUsers.get(userId);
  if (!existing) return null;
  if (updates.displayName) existing.displayName = updates.displayName.trim();
  if (updates.avatarUrl !== undefined) existing.avatarUrl = updates.avatarUrl;
  if (updates.preferences) {
    existing.preferences = { ...existing.preferences, ...updates.preferences };
  }
  existing.updatedAt = new Date();
  inMemoryUsers.set(userId, existing);
  return existing;
}

// ─── Google OAuth Flow ────────────────────────────────────────────────────────
export function getGoogleOAuthUrl(state: string): string {
  const clientId = getGoogleClientId();
  const callbackUrl = getGoogleCallbackUrl();

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured in environment');
  }
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: callbackUrl,
    client_id: clientId,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: ['openid', 'email', 'profile'].join(' '),
    state,
  };
  const qs = new URLSearchParams(options);
  return `${rootUrl}?${qs.toString()}`;
}

export async function handleGoogleCallback(code: string): Promise<IUser> {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const callbackUrl = getGoogleCallbackUrl();

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are not fully configured in environment');
  }

  // 1. Exchange authorization code for tokens
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const tokenRes = await axios.post(
    tokenUrl,
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  );

  const { access_token } = tokenRes.data;
  if (!access_token) {
    throw new Error('Failed to retrieve access token from Google');
  }

  // 2. Fetch verified Google user info
  const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
    timeout: 10000,
  });

  const { sub: googleId, email, name, picture, email_verified } = userInfoRes.data;
  if (!email || !email_verified) {
    throw new Error('Google identity must have a verified email address');
  }

  // 3. Find existing user by Google ID or verified Email
  let user = await (async () => {
    if (mongoose.connection.readyState === 1) {
      let u = await User.findOne({ googleId }).lean();
      if (!u) {
        u = await User.findOne({ email: email.toLowerCase() }).lean();
      }
      return u;
    }
    for (const u of inMemoryUsers.values()) {
      if (u.googleId === googleId || u.email.toLowerCase() === email.toLowerCase()) {
        return u;
      }
    }
    return null;
  })();

  if (user) {
    // If account exists, update googleId and avatar if not yet linked
    if (!user.googleId || !user.avatarUrl) {
      if (mongoose.connection.readyState === 1) {
        user = await User.findByIdAndUpdate(
          user._id,
          { $set: { googleId, avatarUrl: user.avatarUrl || picture } },
          { new: true }
        ).lean();
      } else {
        user.googleId = googleId;
        user.avatarUrl = user.avatarUrl || picture;
        inMemoryUsers.set(user._id.toString(), user);
      }
    }
    return user!;
  }

  // 4. Create new user via Google
  return createUser({
    email,
    displayName: name || email.split('@')[0],
    googleId,
    avatarUrl: picture,
    authProvider: 'google',
  });
}

// ─── Password Reset Helpers ──────────────────────────────────────────────────
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 3600 * 1000); // 1 hour

  if (mongoose.connection.readyState === 1) {
    await User.findByIdAndUpdate(user._id, {
      $set: { passwordResetToken: tokenHash, passwordResetExpires: expires },
    });
  } else {
    user.passwordResetToken = tokenHash;
    user.passwordResetExpires = expires;
    inMemoryUsers.set(user._id.toString(), user);
  }

  return rawToken;
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();

  let user: IUser | null = null;
  if (mongoose.connection.readyState === 1) {
    user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: now },
    }).lean();
  } else {
    for (const u of inMemoryUsers.values()) {
      if (u.passwordResetToken === tokenHash && u.passwordResetExpires && u.passwordResetExpires > now) {
        user = u;
        break;
      }
    }
  }

  if (!user) return false;

  const passwordHash = await hashPassword(newPassword);

  if (mongoose.connection.readyState === 1) {
    await User.findByIdAndUpdate(user._id, {
      $set: { passwordHash },
      $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
    });
  } else {
    user.passwordHash = passwordHash;
    delete user.passwordResetToken;
    delete user.passwordResetExpires;
    inMemoryUsers.set(user._id.toString(), user);
  }

  return true;
}

// ─── Account Data Export & Deletion ──────────────────────────────────────────
export async function exportUserData(userId: string): Promise<any> {
  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  let history: any[] = [];
  if (mongoose.connection.readyState === 1) {
    history = await ResponseModel.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ checkedAt: -1 })
      .lean();
  }

  return {
    exportedAt: new Date().toISOString(),
    user: toSafeUser(user),
    totalVerifications: history.length,
    verifications: history,
  };
}

export async function deleteUserAccount(userId: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user) return false;

  if (mongoose.connection.readyState === 1) {
    // Delete only records owned by this user
    await ResponseModel.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
    await User.findByIdAndDelete(userId);
  } else {
    inMemoryUsers.delete(userId);
  }

  return true;
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(getGoogleClientId() && getGoogleClientSecret());
}

export async function getOrCreateDemoUser(): Promise<IUser> {
  const demoEmail = 'demo@freshnessguard.io';
  let demo = await findUserByEmail(demoEmail);
  if (!demo) {
    demo = await createUser({
      email: demoEmail,
      password: 'DemoPassword2026!',
      displayName: 'Lead Investigator (Demo)',
      authProvider: 'local',
    });
  }
  return demo;
}

export { toSafeUser };
