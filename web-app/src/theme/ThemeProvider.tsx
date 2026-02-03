import * as React from 'react';
import { useThemeStore } from '@/stores/theme-store';

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * ThemeProvider initializes the theme system on mount.
 * Wrap your app with this component to enable theming.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const initTheme = useThemeStore((s) => s.initTheme);

  // Initialize theme on mount
  React.useEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}