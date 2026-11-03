import 'package:broski/agent/agent_providers.dart'
    show runCompletionWatcherProvider;
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/nav_bar_style.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/appearance_provider.dart';
import 'package:broski/providers/connection/connection_banner_rules.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/nav_bar_style_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/screens/browse_screen.dart';
import 'package:broski/screens/projects_screen.dart';
import 'package:broski/screens/sessions_screen.dart';
import 'package:broski/screens/settings_screen.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/app_background.dart';
import 'package:broski/widgets/glassmorphic_nav_bar.dart';
import 'package:broski/widgets/link/link_reconnecting_banner.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});
  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  static const _defaultSelection = LegacySelection(AgentType.claudeCode);

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
      ref.read(runCompletionWatcherProvider);
      setState(() => _index = 2);
      ref
          .read(bridgeServiceProvider)
          .setView(
            projectPath: 'global',
            agent: ref.read(agentTypeProvider).wireValue,
          );
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
        final a = ref.read(agentTypeProvider);
        ref
            .read(bridgeServiceProvider)
            .setView(projectPath: 'global', agent: a.wireValue);
      }
    });
    // Keep bridge view agent aligned with selected backend.
    ref.listen<SelectedBackend>(selectedBackendProvider, (previous, next) {
      if (previous == next) return;
      if (next != _defaultSelection && (_index == 0 || _index == 1)) {
        setState(() => _index = 2);
      }
      ref
          .read(bridgeServiceProvider)
          .setView(
            projectPath: 'global',
            agent: ref.read(agentTypeProvider).wireValue,
          );
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
            children: [
              // TickerMode pauses all AnimationController tickers in the
              // subtree when the tab is not visible. Widgets stay built
              // (instant switching), but pulsing dots, shimmers, and other
              // repeating animations stop burning CPU/GPU offscreen.
              TickerMode(enabled: _index == 0, child: const ProjectsScreen()),
              TickerMode(enabled: _index == 1, child: const BrowseScreen()),
              TickerMode(enabled: _index == 2, child: const SessionsScreen()),
              TickerMode(enabled: _index == 3, child: const SettingsScreen()),
            ],
          ),
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
          // Protocol mismatch banner (soft warning; never blocks usage)
          if (!connection.isOfflineMode &&
              connection.hasProtocolMismatch &&
              !connection.protocolBannerDismissed)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: _ProtocolBanner(
                bridgeVersion: connection.bridgeProtocolVersion ?? 'unknown',
                appVersion: connection.appProtocolVersion,
                onDismiss: () => ref
                    .read(connectionProvider.notifier)
                    .dismissProtocolBanner(),
              ),
            ),
          // Reconnecting banner - shows during auto-reconnect attempts
          if (showReconnectingBanner(connection))
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: LinkReconnectingBanner(
                onCancel: () =>
                    ref.read(connectionProvider.notifier).clearConnection(),
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
    void onTap(int value) {
      setState(() => _index = value);
      if (!connection.isOfflineMode) {
        final a = ref.read(agentTypeProvider);
        ref
            .read(bridgeServiceProvider)
            .setView(projectPath: 'global', agent: a.wireValue);
      }
      if (value == 2) {
        ref.read(sessionsRefreshTickProvider.notifier).state++;
      }
    }

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
            borderRadius: Radii.brXl,
            border: Border.all(color: ocTheme.textMuted.withValues(alpha: 0.2)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(AppIcons.cloudOff, color: ocTheme.textMuted, size: 14),
              const SizedBox(width: 6),
              Text(
                'Offline',
                style: TextStyle(
                  color: ocTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: Spacing.sm),
              Icon(AppIcons.refresh, color: ocTheme.textMuted, size: 14),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProtocolBanner extends StatelessWidget {
  const _ProtocolBanner({
    required this.bridgeVersion,
    required this.appVersion,
    required this.onDismiss,
  });
  final String bridgeVersion;
  final String appVersion;
  final VoidCallback onDismiss;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return SafeArea(
      bottom: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: ocTheme.warning.withValues(alpha: 0.14),
          borderRadius: Radii.brLg,
          border: Border.all(color: ocTheme.warning.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            Icon(AppIcons.warning, color: ocTheme.warning, size: 16),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                'Bridge protocol $bridgeVersion (app $appVersion). Some features may be unavailable until you update.',
                style: TextStyle(
                  color: ocTheme.text,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  height: 1.2,
                ),
              ),
            ),
            IconButton(
              onPressed: onDismiss,
              icon: Icon(AppIcons.close, color: ocTheme.textMuted, size: 18),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              splashRadius: 16,
            ),
          ],
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
    final tabletMargin = Responsive.navBarHorizontalMargin(context);
    return Container(
      margin: EdgeInsets.fromLTRB(16 + tabletMargin, 0, 16 + tabletMargin, 16),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel.withValues(alpha: 0.95),
        borderRadius: Radii.brXl,
        border: Border.all(
          color: ocTheme.borderSubtle.withValues(alpha: 0.15),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: ocTheme.bgDeep.withValues(alpha: 0.5),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _NavItem(
            icon: AppIcons.gridView,
            label: 'Projects',
            isSelected: currentIndex == 0,
            onTap: () => onTap(0),
          ),
          _NavItem(
            icon: AppIcons.folder,
            label: 'Browse',
            isSelected: currentIndex == 1,
            onTap: () => onTap(1),
          ),
          _NavItem(
            icon: AppIcons.history,
            label: 'Sessions',
            isSelected: currentIndex == 2,
            onTap: () => onTap(2),
          ),
          _NavItem(
            icon: AppIcons.tune,
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
          padding: Insets.chipV,
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
