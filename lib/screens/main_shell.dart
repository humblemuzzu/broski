import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'browse_screen.dart';
import 'projects_screen.dart';
import 'sessions_screen.dart';
import 'settings_screen.dart';
import '../models/nav_bar_style.dart';
import '../providers/appearance_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/nav_bar_style_provider.dart';
import '../providers/sessions_provider.dart';
import '../providers/service_providers.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/app_background.dart';
import '../widgets/glassmorphic_nav_bar.dart';

class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _index = 0;

  /// Get the screen ID for the current tab index
  String _getScreenId(int index) {
    switch (index) {
      case 0:
        return AppScreen.projects;
      case 1:
        return AppScreen.browse;
      case 2:
        return AppScreen.sessions;
      case 3:
        return AppScreen.settings;
      default:
        return AppScreen.projects;
    }
  }

  @override
  void initState() {
    super.initState();
    // Main tabs don't need per-session traffic; keep it global-only for bandwidth.
    // Defer until after first frame so ref is fully available.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(bridgeServiceProvider)
          .setView(projectPath: 'global', agent: 'opencode');
    });
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final navBarStyle = ref.watch(navBarStyleProvider);
    final theme = Theme.of(context);

    // Listen for connection changes and set global view when connected
    ref.listen(connectionProvider, (previous, next) {
      final wasConnected = previous?.status == ConnectionStatus.connected;
      final isConnected = next.status == ConnectionStatus.connected;
      if (!wasConnected && isConnected) {
        ref
            .read(bridgeServiceProvider)
            .setView(projectPath: 'global', agent: 'opencode');
      }
    });

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      extendBody: true,
      body: Stack(
        children: [
          // Custom background image/shade layer - pass current screen ID
          AppBackground(screenId: _getScreenId(_index)),
          IndexedStack(
            index: _index,
            children: const [
              ProjectsScreen(),
              BrowseScreen(),
              SessionsScreen(),
              SettingsScreen(),
            ],
          ),
          // Offline mode banner at top
          if (connection.isOfflineMode)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: _OfflineBanner(
                onExit: () =>
                    ref.read(connectionProvider.notifier).exitOfflineMode(),
              ),
            ),
          // Navigation bar - switches between styles
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _buildNavBar(navBarStyle, connection),
          ),
        ],
      ),
    );
  }

  Widget _buildNavBar(NavBarStyle style, BridgeConnectionState connection) {
    final onTap = (int value) {
      setState(() => _index = value);
      if (!connection.isOfflineMode) {
        ref
            .read(bridgeServiceProvider)
            .setView(projectPath: 'global', agent: 'opencode');
      }
      if (value == 2) {
        ref.read(sessionsRefreshTickProvider.notifier).state++;
      }
    };

    switch (style) {
      case NavBarStyle.classic:
        return _ModernBottomNav(currentIndex: _index, onTap: onTap);
      case NavBarStyle.glassmorphic:
        return GlasmorphicNavBar(currentIndex: _index, onTap: onTap);
    }
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner({required this.onExit});

  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    // Subtle, minimal offline indicator - not intrusive
    return SafeArea(
      bottom: false,
      child: GestureDetector(
        onTap: onExit,
        child: Container(
          margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel.withValues(alpha: 0.9),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: ocTheme.textMuted.withValues(alpha: 0.2)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off_rounded, color: ocTheme.textMuted, size: 14),
              const SizedBox(width: 6),
              Text(
                'Offline',
                style: TextStyle(
                  color: ocTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.refresh_rounded, color: ocTheme.textMuted, size: 14),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModernBottomNav extends StatelessWidget {
  const _ModernBottomNav({required this.currentIndex, required this.onTap});

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: ocTheme.borderSubtle.withValues(alpha: 0.15),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.4),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _NavItem(
            icon: Icons.grid_view_rounded,
            label: 'Projects',
            isSelected: currentIndex == 0,
            onTap: () => onTap(0),
          ),
          _NavItem(
            icon: Icons.folder_rounded,
            label: 'Browse',
            isSelected: currentIndex == 1,
            onTap: () => onTap(1),
          ),
          _NavItem(
            icon: Icons.history_rounded,
            label: 'Sessions',
            isSelected: currentIndex == 2,
            onTap: () => onTap(2),
          ),
          _NavItem(
            icon: Icons.tune_rounded,
            label: 'Settings',
            isSelected: currentIndex == 3,
            onTap: () => onTap(3),
          ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                color: isSelected ? ocTheme.primary : ocTheme.textMuted,
                size: 22,
              ),
              const SizedBox(height: 3),
              Text(
                label,
                style: TextStyle(
                  color: isSelected ? ocTheme.text : ocTheme.textMuted,
                  fontSize: 11,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
