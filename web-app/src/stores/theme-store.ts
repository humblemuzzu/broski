import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ThemeInfo } from '@/theme/types';
import { getTheme, DEFAULT_THEME_ID } from '@/theme/themes';
import { applyTheme } from '@/theme/css-vars';

interface ThemeState {
  /** Current theme ID */
  themeId: string;
  /** Current theme info (derived from themeId) */
  theme: ThemeInfo;
  /** Set the active theme by ID */
  setTheme: (id: string) => void;
  /** Initialize theme on app load */
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: DEFAULT_THEME_ID,
      theme: getTheme(DEFAULT_THEME_ID),

      setTheme: (id: string) => {
        const theme = getTheme(id);
        // Apply CSS variables immediately
        applyTheme(theme.tokens);
        // Update data-theme attribute for any CSS selectors that need it
        document.documentElement.setAttribute('data-theme', id);
        // Update store
        set({ themeId: id, theme });
      },

      initTheme: () => {
        const { themeId } = get();
        const theme = getTheme(themeId);
        // Apply CSS variables
        applyTheme(theme.tokens);
        // Set data-theme attribute
        document.documentElement.setAttribute('data-theme', themeId);
        // Ensure theme object is in sync
        set({ theme });
      },
    }),
    {
      name: 'broski-theme',
      // Only persist the themeId, not the full theme object
      partialize: (state) => ({ themeId: state.themeId }),
      // On rehydrate, apply the theme
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.initTheme();
        }
      },
    }
  )
);