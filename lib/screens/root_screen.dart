import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import 'connect_screen.dart';
import 'connection_lost_screen.dart';
import 'main_shell.dart';
import 'network_check_screen.dart';
import 'onboarding_screen.dart';
import 'scan_screen.dart';
import 'setup_guide_screen.dart';
import 'tailscale_check_screen.dart';

class RootScreen extends ConsumerWidget {
  const RootScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionState = ref.watch(connectionProvider);
    final onboardingState = ref.watch(onboardingProvider);

    if (onboardingState.isLoading) {
      return const _LoadingScreen();
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
      return _OnboardingFlow(state: onboardingState);
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
  const _OnboardingFlow({required this.state});

  final OnboardingState state;

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
        return const ScanScreen(key: ValueKey('scan'));
    }
  }
}
