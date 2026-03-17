import { useState, useLayoutEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Hydrate from already-applied attribute (set by inline script in index.html)
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('data-theme') as Theme) ?? 'dark';
    }
    return 'dark';
  });

  useLayoutEffect(() => {
    // Sync state with DOM on mount (in case inline script already set it)
    const current = document.documentElement.getAttribute('data-theme') as Theme | null;
    setTheme(current ?? 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      if (next === 'dark') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('theme');
      } else {
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
