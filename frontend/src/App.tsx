import { useState } from 'react';
import TopBar from './components/TopBar';
import JobList from './components/JobList';
import ProfileModal from './components/ProfileModal';

export default function App() {
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            {/* Logo mark */}
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <span className="text-xs font-bold text-white">V</span>
            </div>
            <span className="text-sm font-semibold text-neutral-200 tracking-tight">VibeCoder</span>
            <span className="text-xs text-neutral-600 ml-1">Encoder</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <TopBar onEditProfiles={() => setProfileModalOpen(true)} />
        <div className="mt-4">
          <JobList />
        </div>
      </main>

      <ProfileModal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
    </div>
  );
}
