import { useState } from 'react';
import TopBar from './components/TopBar';
import JobList from './components/JobList';
import ProfileModal from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header className="sticky top-0 z-10" style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
        {/* accent line */}
        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, #3b82f640, transparent)' }} />
        <div className="max-w-5xl mx-auto px-5 py-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect width="20" height="20" rx="4" fill="#2563eb"/>
              <path d="M6 5v10l10-5L6 5Z" fill="white"/>
            </svg>
            <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>VibeCoder</span>
            <span className="text-xs tracking-widest uppercase font-medium" style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}>Encoder</span>
          </div>
          <div className="flex-1" />
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>v1.0</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-5">
        <TopBar
          onEditProfiles={() => setProfileModalOpen(true)}
          onOpenSettings={() => setSettingsModalOpen(true)}
        />
        <div className="mt-3">
          <JobList />
        </div>
      </main>

      <ProfileModal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
      <SettingsModal open={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
    </div>
  );
}
