import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/onboarding_widgets.dart';

class TailscaleCheckScreen extends ConsumerWidget {
  const TailscaleCheckScreen({super.key});

  static const _tailscaleIosUrl =
      'https://apps.apple.com/app/tailscale/id1470499037';
  static const _tailscaleAndroidUrl =
      'https://play.google.com/store/apps/details?id=com.tailscale.ipn';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);

    return OnboardingScaffold(
      currentStep: 2,
      totalSteps: 3,
      onBack: () => ref.read(onboardingProvider.notifier).goBack(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          Text(
            'Remote Access',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: theme.text,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Tailscale securely connects your devices anywhere.',
            style: TextStyle(color: theme.textMuted, fontSize: 16),
          ),
          const SizedBox(height: 24),
          OnboardingInfoCard(
            icon: Icons.shield_outlined,
            title: 'What is Tailscale?',
            content:
                'A free, secure VPN that connects your devices. Made by ex-Google engineers, trusted by millions. No port forwarding needed.',
          ),
          const SizedBox(height: 24),
          OnboardingOptionCard(
            icon: Icons.check_circle_outline_rounded,
            title: 'I have Tailscale installed',
            subtitle: 'Continue to scan QR code',
            iconColor: theme.success,
            onTap: () {
              ref.read(onboardingProvider.notifier).goToScanner();
            },
          ),
          const SizedBox(height: 12),
          OnboardingOptionCard(
            icon: Icons.download_rounded,
            title: 'Install Tailscale',
            subtitle: 'Free, takes 2 minutes',
            iconColor: theme.primary,
            onTap: () => _showInstallOptions(context, theme),
          ),
          const SizedBox(height: 12),
          OnboardingOptionCard(
            icon: Icons.wifi_rounded,
            title: 'Use WiFi instead',
            subtitle: 'Connect on the same network',
            iconColor: theme.textMuted,
            onTap: () {
              ref
                  .read(onboardingProvider.notifier)
                  .setConnectionMode(ConnectionMode.sameWifi);
            },
          ),
          const Spacer(),
        ],
      ),
    );
  }

  void _showInstallOptions(BuildContext context, OpenCodeTheme theme) {
    DetailSheet.show(
      context: context,
      title: 'Install Tailscale',
      initialSize: 0.5,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Install on both your phone and Mac, then sign in with the same account.',
              style: TextStyle(color: theme.textMuted),
            ),
            const SizedBox(height: 24),
            _InstallButton(
              theme: theme,
              icon: Icons.phone_iphone_rounded,
              title: 'iPhone / iPad',
              url: _tailscaleIosUrl,
            ),
            const SizedBox(height: 12),
            _InstallButton(
              theme: theme,
              icon: Icons.android_rounded,
              title: 'Android',
              url: _tailscaleAndroidUrl,
            ),
            const SizedBox(height: 24),
            OnboardingInfoCard(
              icon: Icons.warning_amber_rounded,
              title: 'Important',
              content:
                  'Sign in to Tailscale with the SAME account on both devices. This is what connects them securely.',
              color: theme.warning,
            ),
          ],
        ),
      ),
    );
  }
}

class _InstallButton extends StatelessWidget {
  const _InstallButton({
    required this.theme,
    required this.icon,
    required this.title,
    required this.url,
  });

  final OpenCodeTheme theme;
  final IconData icon;
  final String title;
  final String url;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final uri = Uri.parse(url);
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      },
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Icon(icon, color: theme.text, size: 24),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: theme.text,
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            Icon(Icons.open_in_new_rounded, color: theme.textMuted, size: 20),
          ],
        ),
      ),
    );
  }
}
