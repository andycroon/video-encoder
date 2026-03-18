import { useState, useEffect } from 'react';
import TopBar from './components/TopBar';
import { useTheme } from './hooks/useTheme';
import JobList from './components/JobList';
import ProfileModal from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';
import useAuthStore from './store/authStore';
import { checkAuthStatus, verifyToken } from './api/auth';
import LoginPage from './components/LoginPage';
import OnboardingWizard from './components/OnboardingWizard';

export default function App() {
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const setupRequired = useAuthStore(s => s.setupRequired);
  const setSetupRequired = useAuthStore(s => s.setSetupRequired);
  const setToken = useAuthStore(s => s.setToken);
  const clearToken = useAuthStore(s => s.clearToken);

  useEffect(() => {
    checkAuthStatus().then(async data => {
      setSetupRequired(data.setup_required);
      if (!data.setup_required) {
        // Users exist — validate any stored token rather than trusting localStorage blindly
        const stored = localStorage.getItem('vce_auth_token');
        if (stored && await verifyToken(stored)) {
          setToken(stored);
        } else {
          clearToken();
        }
      }
    }).catch(() => {
      // Server unreachable — isAuthenticated is already false, so this shows LoginPage
      // where the user will get a network error and know to start the server
      setSetupRequired(false);
    });
  }, [setSetupRequired, setToken, clearToken]);

  // Loading — waiting for auth status check
  if (setupRequired === null) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;
  }

  // First run — no users exist
  if (setupRequired === true) {
    return <OnboardingWizard />;
  }

  // User exists but no valid token
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>

      {/* ── Header ─────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--panel)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 28px', height: 52, display: 'flex', alignItems: 'center', gap: 16 }}>

          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect width="22" height="22" rx="5" fill="#4080ff" />
              <path d="M7.5 6v10l9-5-9-5Z" fill="white" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em', color: 'var(--txt)' }}>VibeCoder</span>
            <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--txt-3)', marginLeft: 2 }}>Encoder</span>
          </div>

          <div style={{ flex: 1 }} />

          <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)' }}>v1.1</span>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────── */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 28px' }}>
        <TopBar
          onEditProfiles={() => setProfileModalOpen(true)}
          onOpenSettings={() => setSettingsModalOpen(true)}
          onToggleTheme={toggleTheme}
          theme={theme}
        />

        <div style={{ marginTop: 20 }}>
          <JobList />
        </div>
      </main>

      <ProfileModal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
      <SettingsModal open={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
    </div>
  );
}
