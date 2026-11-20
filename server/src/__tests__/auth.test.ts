import request from 'supertest';
import express from 'express';
import cors from 'cors';
import authRouter from '../routes/auth';
import apiRouter from '../routes/api';
import { createSessionToken, createUser } from '../services/auth';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

describe('Authentication & Personal Workspace API', () => {
  const testEmail = `tester_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  let authToken = '';
  let userId = '';

  it('registers a new user successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: testPassword,
        displayName: 'Test Operator',
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.displayName).toBe('Test Operator');
    expect(res.body.token).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();

    authToken = res.body.token;
    userId = res.body.user._id;
  });

  it('rejects duplicate email registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'AnotherPassword999!',
        displayName: 'Imposter',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects invalid email or short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'not-an-email',
        password: 'short',
        displayName: 'Bad Input',
      });

    expect(res.status).toBe(400);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(testEmail);
    authToken = res.body.token;
  });

  it('rejects login with incorrect password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: testEmail,
        password: 'WrongPassword!',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it('fetches current user workspace profile via /api/auth/me', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testEmail);
  });

  it('updates user profile preferences', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        displayName: 'Lead Investigator',
        preferences: { theme: 'light', defaultMode: 'async' },
      });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Lead Investigator');
    expect(res.body.user.preferences.theme).toBe('light');
  });

  it('performs password reset workflow', async () => {
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: testEmail });

    expect(forgotRes.status).toBe(200);
    const resetToken = forgotRes.body.resetToken;
    expect(resetToken).toBeDefined();

    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: resetToken,
        password: 'NewStrongPassword2026!',
      });

    expect(resetRes.status).toBe(200);

    // Verify login with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: testEmail,
        password: 'NewStrongPassword2026!',
      });
    expect(loginRes.status).toBe(200);
  });

  it('enforces multi-user data isolation between User A and User B', async () => {
    // 1. User A verifies a claim
    const checkA = await request(app)
      .post('/api/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        text: 'Python 3.12 was released in October 2023.',
        mode: 'basic',
      });
    expect([200, 201]).toContain(checkA.status);
    const responseIdA = checkA.body._id || checkA.body.requestId;

    // 2. Register User B
    const userBRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `user_b_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'User B',
      });
    expect(userBRes.status).toBe(201);
    const tokenB = userBRes.body.token;

    // 3. User B cannot access User A's private response by ID if stored in DB
    if (checkA.body._id) {
      const accessRes = await request(app)
        .get(`/api/responses/${checkA.body._id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      // Must be 404/not found to User B
      expect(accessRes.status).toBe(404);
    }

    // 4. User A exports their personal workspace data
    const exportRes = await request(app)
      .get('/api/auth/export')
      .set('Authorization', `Bearer ${authToken}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.user).toBeDefined();
    expect(exportRes.body.verifications).toBeDefined();
  });

  it('logs out and clears session cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
