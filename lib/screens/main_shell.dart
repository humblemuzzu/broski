
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'browse_screen.dart';
import 'paywall_screen.dart';
import 'projects_screen.dart';
import 'sessions_screen.dart';
import 'settings_screen.dart';
import '../models/agent_type.dart';
import '../models/nav_bar_style.dart';
import '../providers/agent_type_provider.dart';
import '../providers/appearance_provider.dart';
import '../providers/app_subscription_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/nav_bar_style_provider.dart';
import '../providers/sessions_provider.dart';
import '../providers/service_providers.dart';
import '../services/websocket_service.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../widgets/app_background.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import '../widgets/glassmorphic_nav_bar.dart';
import 'package:broski/theme/app_icons.dart';
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
      final agent = ref.read(agentTypeProvider);
      if (agent != AgentType.opencode) {
        setState(() => _index = 2);
      }
      ref
          .read(bridgeServiceProvider)
          .setView(projectPath: 'global', agent: agent.wireValue);
    });
  }
  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final navBarStyle = ref.watch(navBarStyleProvider);
    final sub = ref.watch(appSubscriptionProvider);
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
    ref.listen<AgentType>(agentTypeProvider, (previous, next) {
      if (previous == next) return;
      if (next != AgentType.opencode && (_index == 0 || _index == 1)) {
        setState(() => _index = 2);
      }
      ref
          .read(bridgeServiceProvider)
          .setView(projectPath: 'global', agent: next.wireValue);
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
          // Unpaid UX:
          // - Tabs 0-2: center CTA (competitor-style empty state)
          // - Settings tab: subtle top banner
          if (!sub.entitled && _index != 3)
            Positioned.fill(
              child: SafeArea(
                child: AdaptiveContainer(
                  width: ContentWidth.narrow,
                  child: const Align(
                    alignment: Alignment.center,
                    child: _UnpaidCenterCta(),
                  ),
                ),
              ),
            ),
          if (!sub.entitled && _index == 3)
            const Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: _UpgradeBanner(),
            ),
          // Offline mode banner at top (only show if entitled - unpaid users see upgrade banner instead)
          if (connection.isOfflineMode && sub.entitled)
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
          if (sub.entitled &&
              connection.isReconnecting &&
              !connection.isOfflineMode)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: _ReconnectingBanner(
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
class _UpgradeBanner extends ConsumerWidget {
  const _UpgradeBanner();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      bottom: false,
      child: GestureDetector(
        onTap: () {
          HapticFeedback.mediumImpact();
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => const PaywallScreen(showCloseButton: true),
              fullscreenDialog: true,
            ),
          );
        },
          child: Builder(builder: (context) {
            final ocTheme = OpenCodeTheme.of(context);
            return Container(
              margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: ocTheme.backgroundPanel,
                borderRadius: Radii.brXl,
                border: Border.all(
                  color: ocTheme.warning.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    AppIcons.subscription,
                    color: ocTheme.warning,
                    size: 16,
                  ),
                  SizedBox(width: Spacing.sm),
                  Text(
                    'Upgrade',
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  SizedBox(width: Spacing.xs),
                  Icon(
                    AppIcons.chevronRight,
                    color: ocTheme.textMuted,
                    size: 18,
                  ),
                ],
              ),
            );
          }),
      ),
    );
  }
}
class _UnpaidCenterCta extends ConsumerWidget {
  const _UnpaidCenterCta();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(height: Spacing.lg),
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: ocTheme.backgroundPanel.withValues(alpha: 0.65),
              borderRadius: Radii.brXl,
              border: Border.all(color: ocTheme.borderSubtle),
            ),
            child: Icon(
              AppIcons.lock,
              color: ocTheme.textMuted,
              size: 28,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'Not connected yet',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 20,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Upgrade to connect your Mac and access projects, sessions, and chat.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: ocTheme.textMuted,
              fontSize: 13,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                HapticFeedback.mediumImpact();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const PaywallScreen(showCloseButton: true),
                    fullscreenDialog: true,
                  ),
                );
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: ocTheme.selectedListItemText,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: Radii.brLg,
                ),
              ),
              child: const Text(
                'Upgrade to connect',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
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
              SizedBox(width: Spacing.sm),
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
            SizedBox(width: Spacing.sm),
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
              icon: Icon(
                AppIcons.close,
                color: ocTheme.textMuted,
                size: 18,
              ),
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
class _ReconnectingBanner extends StatelessWidget {
  const _ReconnectingBanner({required this.onCancel});
  final VoidCallback onCancel;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return SafeArea(
      bottom: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: ocTheme.primary.withValues(alpha: 0.12),
          borderRadius: Radii.brLg,
          border: Border.all(color: ocTheme.primary.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: ocTheme.primary,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Reconnecting...',
                style: TextStyle(
                  color: ocTheme.text,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            GestureDetector(
              onTap: onCancel,
              child: Text(
                'Cancel',
                style: TextStyle(
                  color: ocTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
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
