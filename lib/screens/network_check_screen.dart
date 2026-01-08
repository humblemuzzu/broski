import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class NetworkCheckScreen extends ConsumerWidget {
  const NetworkCheckScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);

    return OnboardingScaffold(
      currentStep: 1,
      totalSteps: 3,
      onBack: () => ref.read(onboardingProvider.notifier).goBack(),
      bottomContent: OnboardingButton(
        label: 'Skip this step',
        variant: OnboardingButtonVariant.ghost,
        onPressed: () {
          ref.read(onboardingProvider.notifier).goToScanner();
        },
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          Text(
            'How will you connect?',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: theme.text,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Choose the option that matches your setup.',
            style: TextStyle(color: theme.textMuted, fontSize: 16),
          ),
          const SizedBox(height: 32),
          OnboardingOptionCard(
            icon: Icons.wifi_rounded,
            title: 'Same WiFi',
            subtitle: 'Phone and Mac on the same network',
            isRecommended: true,
            iconColor: theme.success,
            onTap: () {
              ref
                  .read(onboardingProvider.notifier)
                  .setConnectionMode(ConnectionMode.sameWifi);
            },
          ),
          const SizedBox(height: 16),
          OnboardingOptionCard(
            icon: Icons.public_rounded,
            title: 'Remote / Different Network',
            subtitle: 'Coffee shop, office, or traveling',
            iconColor: theme.info,
            onTap: () {
              ref
                  .read(onboardingProvider.notifier)
                  .setConnectionMode(ConnectionMode.remote);
            },
          ),
          const SizedBox(height: 32),
          OnboardingInfoCard(
            icon: Icons.lightbulb_outline_rounded,
            title: 'Not sure?',
            content:
                'If your phone and Mac are both at home on your home WiFi, choose "Same WiFi". It\'s faster and requires no extra setup.',
          ),
          const Spacer(),
        ],
      ),
    );
  }
}
