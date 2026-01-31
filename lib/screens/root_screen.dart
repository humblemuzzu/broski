import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_auth_provider.dart';
import '../providers/app_subscription_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import 'auth_screen.dart';
import 'bridge_setup_screen.dart';
import 'connection_lost_screen.dart';
import 'main_shell.dart';
import 'onboarding_auth_screen.dart';
import 'onboarding_screen.dart';
import 'paywall_screen.dart';
import 'scan_screen.dart';
import 'system_linked_screen.dart';

class RootScreen extends ConsumerWidget {
  const RootScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(appAuthProvider);
    final subState = ref.watch(appSubscriptionProvider);
    final connectionState = ref.watch(connectionProvider);
    final onboardingState = ref.watch(onboardingProvider);

    if (onboardingState.isLoading || authState.isLoading) {
      return const _LoadingScreen();
    }

    // Onboarding in progress — the flow handles auth, paywall, and scanner internally
    if (!onboardingState.hasCompletedOnboarding) {
      return _OnboardingFlow(state: onboardingState);
    }

    // Post-onboarding: normal app routing
    if (!authState.isSignedIn) {
      return const AuthScreen();
    }

    // Ensure RevenueCat is configured and loaded once the user is signed in.
    if (!subState.isConfigured && !subState.isLoading) {
      Future.microtask(
        () => ref.read(appSubscriptionProvider.notifier).configureAndRefresh(),
      );
    }

    if (!subState.entitled) {
      return const PaywallScreen();
    }

    if (connectionState.isOfflineMode) {
      return const MainShell();
    }

    if (connectionState.isConnecting) {
      return const _ConnectingScreen();
    }

    if (connectionState.isConnected) {
      return const MainShell();
    }

    if (connectionState.connection != null) {
      return const ConnectionLostScreen();
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
            const SizedBox(height: 16),
            Text(
              'Loading...',
              style: TextStyle(color: theme.textMuted, fontSize: 14),
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

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  width: 48,
                  height: 48,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Connecting...',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                if (state.connection != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${state.connection!.localIP ?? ''}:${state.connection!.port}',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.white.withValues(alpha: 0.4),
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
                if (state.error != null) ...[
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.red.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: Colors.red.withValues(alpha: 0.2),
                      ),
                    ),
                    child: Text(
                      state.error!,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.red.withValues(alpha: 0.8),
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 32),
                GestureDetector(
                  onTap: () =>
                      ref.read(connectionProvider.notifier).clearConnection(),
                  child: Text(
                    'Scan Different QR',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 14,
                      decoration: TextDecoration.underline,
                      decorationColor: Colors.white.withValues(alpha: 0.3),
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
/// Converted to ConsumerWidget to auto-advance auth/paywall steps.
class _OnboardingFlow extends ConsumerWidget {
  const _OnboardingFlow({required this.state});

  final OnboardingState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(appAuthProvider);
    final subState = ref.watch(appSubscriptionProvider);

    // Auto-advance: if we're on auth step but already signed in, skip forward
    if (state.currentStep == OnboardingStep.auth && authState.isSignedIn) {
      Future.microtask(
        () => ref.read(onboardingProvider.notifier).finishAuth(),
      );
    }

    // Auto-advance: if we're on paywall step but already entitled, skip forward
    if (state.currentStep == OnboardingStep.paywall && subState.entitled) {
      Future.microtask(
        () => ref.read(onboardingProvider.notifier).finishPaywall(),
      );
    }

    return AnimatedSwitcher(
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
  }

  Widget _buildCurrentScreen(OnboardingState state) {
    switch (state.currentStep) {
      case OnboardingStep.welcome:
        return const OnboardingScreen(key: ValueKey('onboarding'));
      case OnboardingStep.auth:
        return const OnboardingAuthScreen(key: ValueKey('auth'));
      case OnboardingStep.paywall:
        return const PaywallScreen(key: ValueKey('paywall'));
      case OnboardingStep.bridgeSetup:
        return const BridgeSetupScreen(key: ValueKey('bridgeSetup'));
      case OnboardingStep.scanner:
      case OnboardingStep.complete:
        return const _OnboardingScanWrapper(key: ValueKey('scan'));
    }
  }
}

/// Wraps [ScanScreen] during onboarding to detect when connection succeeds
/// and show the SystemLinkedScreen before transitioning to MainShell.
class _OnboardingScanWrapper extends ConsumerWidget {
  const _OnboardingScanWrapper({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionState = ref.watch(connectionProvider);

    // Connection succeeded during onboarding — show System Linked screen
    if (connectionState.isConnected) {
      return const SystemLinkedScreen();
    }

    // Still connecting — show minimal connecting indicator overlay
    if (connectionState.isConnecting) {
      return const _ConnectingScreen();
    }

    return const ScanScreen();
  }
}
