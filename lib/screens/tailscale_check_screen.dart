import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';

class TailscaleCheckScreen extends ConsumerWidget {
  const TailscaleCheckScreen({super.key});

  static const _tailscaleIosUrl =
      'https://apps.apple.com/app/tailscale/id1470499037';
  static const _tailscaleAndroidUrl =
      'https://play.google.com/store/apps/details?id=com.tailscale.ipn';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: ocTheme.text),
          onPressed: () => ref.read(onboardingProvider.notifier).goBack(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Remote Access',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: ocTheme.text,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Tailscale connects your devices securely.',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 16),
              ),
              const SizedBox(height: 32),
              _buildInfoCard(context, ocTheme),
              const SizedBox(height: 24),
              _buildOptionCard(
                context,
                ocTheme,
                icon: Icons.check_circle,
                iconColor: ocTheme.success,
                title: 'I have Tailscale installed',
                subtitle: 'Continue to scan QR code',
                onTap: () {
                  ref.read(onboardingProvider.notifier).goToScanner();
                },
              ),
              const SizedBox(height: 16),
              _buildOptionCard(
                context,
                ocTheme,
                icon: Icons.download,
                iconColor: ocTheme.primary,
                title: 'Install Tailscale',
                subtitle: 'Free, takes 2 minutes',
                onTap: () => _showInstallOptions(context, ocTheme),
              ),
              const SizedBox(height: 16),
              _buildOptionCard(
                context,
                ocTheme,
                icon: Icons.wifi,
                iconColor: ocTheme.textMuted,
                title: 'Use WiFi instead',
                subtitle: 'Connect to same network as Mac',
                onTap: () {
                  ref
                      .read(onboardingProvider.notifier)
                      .setConnectionMode(ConnectionMode.sameWifi);
                },
              ),
              const Spacer(),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoCard(BuildContext context, OpenCodeTheme ocTheme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ocTheme.info.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ocTheme.info.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, color: ocTheme.info, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'What is Tailscale?',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'A free, secure VPN that connects your devices. Made by ex-Google engineers, used by millions.',
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOptionCard(
    BuildContext context,
    OpenCodeTheme ocTheme, {
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          children: [
            Icon(icon, color: iconColor, size: 28),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontWeight: FontWeight.w600,
                      fontSize: 16,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: ocTheme.textMuted),
          ],
        ),
      ),
    );
  }

  void _showInstallOptions(BuildContext context, OpenCodeTheme ocTheme) {
    showModalBottomSheet(
      context: context,
      backgroundColor: ocTheme.backgroundPanel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Install Tailscale',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Use the same account on your phone and Mac.',
                  style: TextStyle(color: ocTheme.textMuted),
                ),
                const SizedBox(height: 24),
                _buildInstallButton(
                  context,
                  ocTheme,
                  icon: Icons.phone_iphone,
                  title: 'iPhone / iPad',
                  url: _tailscaleIosUrl,
                ),
                const SizedBox(height: 12),
                _buildInstallButton(
                  context,
                  ocTheme,
                  icon: Icons.android,
                  title: 'Android',
                  url: _tailscaleAndroidUrl,
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ocTheme.warning.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.warning_amber,
                        color: ocTheme.warning,
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Log in with the SAME account you used on your Mac!',
                          style: TextStyle(
                            color: ocTheme.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildInstallButton(
    BuildContext context,
    OpenCodeTheme ocTheme, {
    required IconData icon,
    required String title,
    required String url,
  }) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: () async {
          final uri = Uri.parse(url);
          if (await canLaunchUrl(uri)) {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
          }
        },
        icon: Icon(icon),
        label: Text(title),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}
