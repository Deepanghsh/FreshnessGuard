import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  Mail,
  Shield,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Save,
  Globe,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { useToast } from '../components/Layout';

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user, updateProfile, logout } = useAuth();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [defaultModel, setDefaultModel] = useState(user?.preferences?.defaultModel || 'gemini-1.5-flash');
  const [defaultMode, setDefaultMode] = useState<any>(user?.preferences?.defaultMode || 'inline');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    try {
      setSaving(true);
      await updateProfile({
        displayName: displayName.trim(),
        preferences: {
          defaultModel,
          defaultMode,
        },
      });
      showToast('Profile and preferences saved successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExportData = async () => {
    try {
      setExporting(true);
      const data = await api.exportUserData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `freshnessguard_workspace_${user?.displayName.replace(/\s+/g, '_')}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Workspace verification data exported successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to export data', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== 'DELETE') return;

    try {
      setDeleting(true);
      await api.deleteAccount();
      await logout();
      navigate('/login');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete account', 'error');
      setDeleting(false);
    }
  };

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: 900, margin: '0 auto' }} className="animate-fade-in">
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Workspace &amp; Account Settings
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--muted)' }}>
            Manage your personal profile, verification defaults, data portability, and security bounds.
          </p>
        </div>

        <button
          onClick={logout}
          className="btn btn-secondary"
          style={{ fontSize: '0.8125rem', gap: 6 }}
        >
          <LogOut size={13} /> Sign Out
        </button>
      </div>

      {/* Profile & Preferences Form */}
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
          <UserIcon size={18} color="var(--accent)" />
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Personal Profile</h2>
        </div>

        <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '1rem', width: '100%', boxSizing: 'border-box' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--card-subtle)',
                  color: 'var(--text)',
                  fontSize: '0.875rem',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                Account Email
              </label>
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--card-subtle)',
                  color: 'var(--muted)',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{user.email}</span>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: user.authProvider === 'google' ? 'rgba(66, 133, 244, 0.15)' : 'var(--accent-dim)',
                    color: user.authProvider === 'google' ? '#4285F4' : 'var(--accent)',
                  }}
                >
                  {user.authProvider}
                </span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9375rem', fontWeight: 700 }}>Verification Defaults</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '1rem', width: '100%', boxSizing: 'border-box' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                  Default AI Model
                </label>
                <select
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--card-subtle)',
                    color: 'var(--text)',
                    fontSize: '0.875rem',
                    outline: 'none',
                  }}
                >
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash (Google)</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (Google)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Google)</option>
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (Google)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                  Default Verification Mode
                </label>
                <select
                  value={defaultMode}
                  onChange={(e) => setDefaultMode(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--card-subtle)',
                    color: 'var(--text)',
                    fontSize: '0.875rem',
                    outline: 'none',
                  }}
                >
                  <option value="inline">Inline (Block until Tavily corroborates)</option>
                  <option value="async">Async (Background SSE stream)</option>
                  <option value="basic">Basic (Fast heuristic without live web)</option>
                  <option value="bypass">Bypass (Raw gateway passthrough)</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="submit" disabled={saving} className="btn btn-primary" style={{ gap: 6, fontSize: '0.875rem' }}>
              <Save size={14} />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Data Portability */}
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Download size={18} color="var(--accent)" />
              <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Data Portability &amp; Export</h2>
            </div>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)' }}>
              Export your entire personal verification history, claim investigations, and Tavily citations in JSON format.
            </p>
          </div>

          <button
            onClick={handleExportData}
            disabled={exporting}
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', gap: 6 }}
          >
            <Download size={13} />
            {exporting ? 'Exporting…' : 'Download JSON Bundle'}
          </button>
        </div>
      </div>

      {/* Danger Zone: Account Deletion */}
      <div
        className="panel"
        style={{
          border: '1px solid var(--stale-border)',
          background: 'var(--stale-dim)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Trash2 size={18} color="var(--stale)" />
              <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--stale)' }}>
                Danger Zone: Delete Workspace
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', maxWidth: 560 }}>
              Permanently delete your account and all private verification runs. Shared system gateway metrics and public demo records will remain unaffected.
            </p>
          </div>

          <button
            onClick={() => setShowDeleteModal(true)}
            className="btn"
            style={{
              background: 'var(--stale)',
              color: '#FFFFFF',
              border: 'none',
              fontSize: '0.8125rem',
              gap: 6,
            }}
          >
            <Trash2 size={13} /> Delete Account
          </button>
        </div>

        {/* Confirmation Modal */}
        {showDeleteModal && (
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--stale-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--stale)' }}>
              Are you sure? This action cannot be undone. Type <strong>DELETE</strong> below to confirm:
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE"
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontSize: '0.875rem',
                  outline: 'none',
                  minWidth: 200,
                }}
              />
              <button
                onClick={handleDeleteAccount}
                disabled={confirmText !== 'DELETE' || deleting}
                className="btn"
                style={{
                  background: 'var(--stale)',
                  color: '#FFFFFF',
                  opacity: confirmText === 'DELETE' ? 1 : 0.5,
                  fontSize: '0.8125rem',
                }}
              >
                {deleting ? 'Deleting…' : 'Permanently Delete Workspace'}
              </button>
              <button
                onClick={() => { setShowDeleteModal(false); setConfirmText(''); }}
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
