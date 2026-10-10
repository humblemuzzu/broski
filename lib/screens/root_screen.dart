import 'package:broski/providers/chat/runtime_shadow_provider.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/onboarding_provider.dart';
import 'package:broski/providers/pi/pi_backend_event_listener.dart';
import 'package:broski/screens/bridge_setup_screen.dart';
import 'package:broski/screens/connection_lost_screen.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:broski/screens/onboarding_screen.dart';
import 'package:broski/screens/scan_screen.dart';
import 'package:broski/screens/system_linked_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class RootScreen extends ConsumerWidget {
  const RootScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(runtimeShadowBootstrapProvider);
    ref.watch(piBackendEventListenerProvider);
    ref.watch(linkConnectionBootstrapProvider);
    final connectionState = ref.watch(connectionProvider);
    final onboardingState = ref.watch(onboardingProvider);
    if (onboardingState.isLoading) {
      return const _LoadingScreen();
    }
    // Onboarding in progress — the flow handles welcome, bridge setup, and scanner
    if (!onboardingState.hasCompletedOnboarding) {
      return _OnboardingFlow(state: onboardingState);
    }
    // DEV BYPASS: auto-enter offline mode so we land in MainShell (debug only)
    if (kDebugMode &&
        kDevBypassOnboarding &&
        connectionState.devBypassAutoOfflineEnabled &&
        !connectionState.isOfflineMode &&
        !connectionState.isConnected &&
        !connectionState.isConnecting) {
      Future.microtask(
        () => ref.read(connectionProvider.notifier).enterOfflineMode(),
      );
    }
    if (connectionState.isOfflineMode) {
      return const MainShell();
    }
    if (connectionState.isConnected) {
      return const MainShell();
    }
    // A paired Link machine is the connection; everything below is the legacy
    // WebSocket path, which must not run while one is selected.
    if (ref.watch(
      machinesProvider.select((machines) => machines.selectedId != null),
    )) {
      return const MainShell();
    }
    // Initial connect (fresh scan) -> show connecting screen.
    if (connectionState.isConnecting && !connectionState.isReconnecting) {
      return const _ConnectingScreen();
    }
    // Auto-retry in progress: keep showing MainShell with banner.
    if ((connectionState.isReconnecting || connectionState.isConnecting) &&
        connectionState.connection != null) {
      return const MainShell();
    }
    // We have a saved connection, but we're not currently trying to reconnect.
    // Kick off a reconnect attempt automatically; show ConnectionLostScreen only
    // when we have a real error (after attempts/timeouts).
    if (connectionState.connection != null) {
      if (connectionState.error != null) {
        return const ConnectionLostScreen();
      }
      Future.microtask(
        () => ref
            .read(connectionProvider.notifier)
            .kickOffAutoReconnectIfNeeded(),
      );
      return const MainShell();
    }
    return const ScanScreen();
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: theme.background,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 32,
              height: 32,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: theme.primary,
              ),
            ),
            const SizedBox(height: Spacing.lg),
            Text(
              'Loading...',
              style: AppTypography.labelLarge(color: theme.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}

/// Minimal connecting screen for post-onboarding reconnections.
class _ConnectingScreen extends ConsumerWidget {
  const _ConnectingScreen();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(connectionProvider);
    final ocTheme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: ocTheme.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: Responsive.isTablet(context)
                ? const EdgeInsets.all(60)
                : Insets.xxxl,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  width: 48,
                  height: 48,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: ocTheme.primary,
                  ),
                ),
                const SizedBox(height: Spacing.xxl),
                Text(
                  'Connecting...',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: ocTheme.text,
                  ),
                ),
                if (state.connection != null) ...[
                  const SizedBox(height: Spacing.sm),
                  Text(
                    '${state.connection!.localIP ?? ''}:${state.connection!.port}',
                    style: AppTypography.codeLarge(color: ocTheme.textMuted),
                  ),
                ],
                if (state.error != null) ...[
                  const SizedBox(height: Spacing.xl),
                  Container(
                    padding: Insets.card,
                    decoration: BoxDecoration(
                      color: ocTheme.error.withValues(alpha: 0.1),
                      borderRadius: Radii.brMd,
                      border: Border.all(
                        color: ocTheme.error.withValues(alpha: 0.2),
                      ),
                    ),
                    child: Text(
                      state.error!,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: ocTheme.error, fontSize: 13),
                    ),
                  ),
                ],
                const SizedBox(height: Spacing.xxxl),
                GestureDetector(
                  onTap: () =>
                      ref.read(connectionProvider.notifier).clearConnection(),
                  child: Text(
                    'Scan Different QR',
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 14,
                      decoration: TextDecoration.underline,
                      decorationColor: ocTheme.textMuted.withValues(alpha: 0.5),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Animated onboarding flow with smooth transitions.
class _OnboardingFlow extends ConsumerWidget {
  const _OnboardingFlow({required this.state});
  final OnboardingState state;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Widget content = AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) {
        final slideIn = Tween<Offset>(
          begin: const Offset(0.15, 0),
          end: Offset.zero,
        ).animate(animation);
        final fadeIn = CurvedAnimation(
          parent: animation,
          curve: const Interval(0.0, 0.8, curve: Curves.easeOut),
        );
        return FadeTransition(
          opacity: fadeIn,
          child: SlideTransition(position: slideIn, child: child),
        );
      },
      child: _buildCurrentScreen(state),
    );
    // DEV BYPASS: wrap with edge-swipe detection + skip button overlay (debug only)
    if (kDebugMode && kDevBypassOnboarding) {
      content = _DevSwipeWrapper(child: content);
    }
    return content;
  }

  Widget _buildCurrentScreen(OnboardingState state) {
    switch (state.currentStep) {
      case OnboardingStep.welcome:
        return const OnboardingScreen(key: ValueKey('onboarding'));
      case OnboardingStep.bridgeSetup:
        return const BridgeSetupScreen(key: ValueKey('bridgeSetup'));
      case OnboardingStep.scanner:
      case OnboardingStep.complete:
        return const _OnboardingScanWrapper(key: ValueKey('scan'));
    }
  }
}

/// DEV ONLY: Edge-swipe gesture wrapper + floating skip button.
/// Swipe from right edge = advance, swipe from left edge = go back.
/// Also shows a floating "Skip All >>" button at top-right.
class _DevSwipeWrapper extends ConsumerStatefulWidget {
  const _DevSwipeWrapper({required this.child});
  final Widget child;
  @override
  ConsumerState<_DevSwipeWrapper> createState() => _DevSwipeWrapperState();
}

class _DevSwipeWrapperState extends ConsumerState<_DevSwipeWrapper> {
  double _dragStartX = 0;
  bool _isDragging = false;
  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final edgeThreshold = screenWidth * 0.15; // 15% from each edge
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onHorizontalDragStart: (details) {
        _dragStartX = details.globalPosition.dx;
        _isDragging = true;
      },
      onHorizontalDragEnd: (details) {
        if (!_isDragging) return;
        _isDragging = false;
        final velocity = details.primaryVelocity ?? 0;
        final startedFromLeftEdge = _dragStartX < edgeThreshold;
        final startedFromRightEdge = _dragStartX > screenWidth - edgeThreshold;
        // Swipe right from left edge -> go back
        if (startedFromLeftEdge && velocity > 300) {
          HapticFeedback.lightImpact();
          ref.read(onboardingProvider.notifier).goBack();
        }
        // Swipe left from right edge -> skip forward
        else if (startedFromRightEdge && velocity < -300) {
          HapticFeedback.lightImpact();
          ref.read(onboardingProvider.notifier).skipForward();
        }
      },
      child: Stack(
        children: [
          widget.child,
          // Floating "Skip All" button at top-right
          Positioned(
            top: MediaQuery.of(context).padding.top + 12,
            right: 16,
            child: GestureDetector(
              onTap: () {
                HapticFeedback.mediumImpact();
                ref.read(onboardingProvider.notifier).completeOnboarding();
              },
              child: Builder(
                builder: (context) {
                  final ocTheme = OpenCodeTheme.of(context);
                  return Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: ocTheme.error.withValues(alpha: 0.15),
                      borderRadius: Radii.brXl,
                      border: Border.all(
                        color: ocTheme.error.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'DEV SKIP',
                          style: TextStyle(
                            color: ocTheme.error,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(width: Spacing.xs),
                        Icon(AppIcons.skip, color: ocTheme.error, size: 16),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
          // Edge swipe hint indicators (subtle arrows)
          Positioned(
            left: 4,
            top: 0,
            bottom: 0,
            child: Center(
              child: Builder(
                builder: (context) {
                  final ocTheme = OpenCodeTheme.of(context);
                  return Icon(
                    AppIcons.chevronLeft,
                    color: ocTheme.textMuted.withValues(alpha: 0.15),
                    size: 28,
                  );
                },
              ),
            ),
          ),
          Positioned(
            right: 4,
            top: 0,
            bottom: 0,
            child: Center(
              child: Builder(
                builder: (context) {
                  final ocTheme = OpenCodeTheme.of(context);
                  return Icon(
                    AppIcons.chevronRight,
                    color: ocTheme.textMuted.withValues(alpha: 0.15),
                    size: 28,
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Wraps [ScanScreen] during onboarding to detect when connection succeeds
/// and show the SystemLinkedScreen before transitioning to MainShell.
class _OnboardingScanWrapper extends ConsumerWidget {
  const _OnboardingScanWrapper({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionState = ref.watch(connectionProvider);

    // Connection succeeded during onboarding — show System Linked screen.
    // This is the only case where we fully replace the scanner.
    if (connectionState.isConnected) {
      return const SystemLinkedScreen();
    }

    // Use a Stack so the ScanScreen (and its camera) stays mounted at all
    // times. Connecting/error states are overlaid on top. This prevents the
    // MobileScannerController from being disposed and recreated on every
    // connection-state change, which was causing the "frozen scanner" bug.
    return Stack(
      children: [
        // Scanner always alive underneath
        const ScanScreen(),

        // Semi-transparent connecting overlay (doesn't destroy the camera)
        if (connectionState.isConnecting) const _ConnectingOverlay(),
      ],
    );
  }
}

/// Semi-transparent overlay shown on top of the scanner while connecting.
/// Unlike [_ConnectingScreen], this does NOT replace the scanner widget tree,
/// so the camera stays alive and the user sees the connection progress on top
/// of the live camera feed.
class _ConnectingOverlay extends ConsumerWidget {
  const _ConnectingOverlay();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(connectionProvider);
    return Container(
      color: Colors.black.withValues(alpha: 0.85),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(
                  width: 48,
                  height: 48,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: Color(0xFF2ECB71),
                  ),
                ),
                const SizedBox(height: 28),
                const Text(
                  'Connecting to Bridge...',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                if (state.connection != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${state.connection!.localIP ?? state.connection!.tailscaleIP ?? ''}:${state.connection!.port}',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.white.withValues(alpha: 0.5),
                      fontFamily: 'GeistMono',
                    ),
                  ),
                ],
                if (state.error != null) ...[
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.red.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: Colors.red.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Text(
                      state.error!,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.red.withValues(alpha: 0.9),
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
