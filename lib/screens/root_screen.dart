import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import 'connect_screen.dart';
import 'connection_lost_screen.dart';
import 'main_shell.dart';
import 'network_check_screen.dart';
import 'scan_screen.dart';
import 'setup_guide_screen.dart';
import 'tailscale_check_screen.dart';
import 'welcome_screen.dart';

class RootScreen extends ConsumerWidget {
  const RootScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionState = ref.watch(connectionProvider);
    final onboardingState = ref.watch(onboardingProvider);

    if (onboardingState.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
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
      return _buildOnboardingFlow(onboardingState);
    }

    return const ScanScreen();
  }

  Widget _buildOnboardingFlow(OnboardingState state) {
    switch (state.currentStep) {
      case OnboardingStep.welcome:
        return const WelcomeScreen();
      case OnboardingStep.macSetup:
        return const SetupGuideScreen();
      case OnboardingStep.networkCheck:
        return const NetworkCheckScreen();
      case OnboardingStep.tailscaleCheck:
        return const TailscaleCheckScreen();
      case OnboardingStep.scanner:
      case OnboardingStep.complete:
        return const ScanScreen();
    }
  }
}
