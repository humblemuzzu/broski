import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_auth_provider.dart';
import '../providers/app_subscription_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import 'auth_screen.dart';
import 'connect_screen.dart';
import 'connection_lost_screen.dart';
import 'main_shell.dart';
import 'network_check_screen.dart';
import 'onboarding_screen.dart';
import 'paywall_screen.dart';
import 'scan_screen.dart';
import 'setup_guide_screen.dart';
import 'tailscale_check_screen.dart';

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

    if (!onboardingState.hasCompletedOnboarding) {
      return _OnboardingFlow(
        state: onboardingState,
        isSignedIn: authState.isSignedIn,
        isEntitled: subState.entitled,
      );
    }

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
      return const ConnectScreen();
    }

    if (connectionState.isConnected) {
      if (!onboardingState.hasCompletedOnboarding) {
        Future.microtask(() {
          ref.read(onboardingProvider.notifier).completeOnboarding();
        });
      }
      return const MainShell();
    }

    if (connectionState.connection != null) {
      return const ConnectionLostScreen();
    }

    if (!onboardingState.hasCompletedOnboarding) {
      return _OnboardingFlow(
        state: onboardingState,
        isSignedIn: authState.isSignedIn,
        isEntitled: subState.entitled,
      );
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

/// Animated onboarding flow with smooth transitions
class _OnboardingFlow extends StatelessWidget {
  const _OnboardingFlow({
    required this.state,
    required this.isSignedIn,
    required this.isEntitled,
  });

  final OnboardingState state;
  final bool isSignedIn;
  final bool isEntitled;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) {
        // Determine slide direction based on key comparison
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
    // Use ValueKey to help AnimatedSwitcher detect changes
    switch (state.currentStep) {
      case OnboardingStep.welcome:
        // Premium onboarding flow with splash, intro, and feature demos
        return const OnboardingScreen(key: ValueKey('onboarding'));
      case OnboardingStep.macSetup:
        return const SetupGuideScreen(key: ValueKey('setup'));
      case OnboardingStep.networkCheck:
        return const NetworkCheckScreen(key: ValueKey('network'));
      case OnboardingStep.tailscaleCheck:
        return const TailscaleCheckScreen(key: ValueKey('tailscale'));
      case OnboardingStep.scanner:
      case OnboardingStep.complete:
        if (!isSignedIn) {
          return const AuthScreen(key: ValueKey('auth'));
        }
        if (!isEntitled) {
          return const PaywallScreen(key: ValueKey('paywall'));
        }
        return const _OnboardingScanWrapper(key: ValueKey('scan'));
    }
  }
}

/// Wraps [ScanScreen] during onboarding to detect when connection succeeds
/// and automatically complete onboarding + transition to MainShell.
///
/// Without this, the RootScreen checks `hasCompletedOnboarding` before
/// `isConnected`, so the code path that calls `completeOnboarding()` is
/// unreachable during onboarding — trapping the user on the scan screen.
class _OnboardingScanWrapper extends ConsumerWidget {
  const _OnboardingScanWrapper({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionState = ref.watch(connectionProvider);

    // Connection succeeded during onboarding — complete it and show MainShell
    if (connectionState.isConnected) {
      Future.microtask(() {
        ref.read(onboardingProvider.notifier).completeOnboarding();
      });
      return const MainShell();
    }

    // Still connecting — show progress
    if (connectionState.isConnecting) {
      return const ConnectScreen();
    }

    return const ScanScreen();
  }
}
