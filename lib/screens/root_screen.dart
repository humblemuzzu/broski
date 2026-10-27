import 'package:broski/providers/chat/runtime_shadow_provider.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/connection/link_send_failure_notice.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/onboarding_provider.dart';
import 'package:broski/providers/pi/pi_backend_event_listener.dart';
import 'package:broski/screens/bridge_setup_screen.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:broski/screens/onboarding_screen.dart';
import 'package:broski/screens/scan_screen.dart';
import 'package:broski/screens/system_linked_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
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
    ref.watch(linkSendFailureNoticeProvider);
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
    if (ref.watch(
      machinesProvider.select((machines) => machines.selectedId != null),
    )) {
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
    if (ref.watch(connectionProvider.select((state) => state.isConnected))) {
      return const SystemLinkedScreen();
    }
    return const ScanScreen();
  }
}
