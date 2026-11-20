import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [demoToken, setDemoToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    try {
      setLoading(true);
      setError(null);
      const res = await api.forgotPassword(email);
      setSuccessMessage(res.message);
      if (res.resetToken) {
        setDemoToken(res.resetToken);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to process password reset request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        padding: '2rem 1rem',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '2.5rem',
          boxSizing: 'border-box',
          background: 'var(--panel)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.65)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '12px',
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <Mail size={26} color="var(--accent)" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.5rem', color: 'var(--text)' }}>
            Reset your password
          </h1>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Enter your email and we'll send you instructions to reset your password.
          </p>
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--stale-dim)',
              border: '1px solid var(--stale-border)',
              color: 'var(--stale)',
              fontSize: '0.8125rem',
              marginBottom: '1.5rem',
            }}
          >
            <AlertCircle size={16} />
            <div>{error}</div>
          </div>
        )}

        {successMessage ? (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--current-dim)',
                border: '1px solid var(--current-border)',
                color: 'var(--current)',
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '1.5rem',
              }}
            >
              <CheckCircle2 size={18} />
              {successMessage}
            </div>

            {demoToken && (
              <div
                style={{
                  background: 'var(--card-subtle)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '12px',
                  marginBottom: '1.5rem',
                  fontSize: '0.8125rem',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
                  Demo / Local Development Link:
                </div>
                <Link
                  to={`/reset-password?token=${demoToken}`}
                  style={{ color: 'var(--text)', wordBreak: 'break-all', textDecoration: 'underline' }}
                >
                  Click here to complete password reset
                </Link>
              </div>
            )}

            <Link to="/login" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
              <ArrowLeft size={14} /> Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}
              >
                Registered email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@enterprise.com"
                required
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--card-subtle)',
                  color: 'var(--text)',
                  fontSize: '0.875rem',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.875rem',
                fontWeight: 700,
                marginTop: '0.5rem',
              }}
            >
              {loading ? 'Sending Instructions…' : 'Send Reset Instructions'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <Link
                to="/login"
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.8125rem',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ArrowLeft size={13} /> Back to login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
