import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';

class NetworkCheckScreen extends ConsumerWidget {
  const NetworkCheckScreen({super.key});

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
                'How are you connecting?',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: ocTheme.text,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'This helps us connect you faster.',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 16),
              ),
              const SizedBox(height: 32),
              _buildOptionCard(
                context,
                ocTheme,
                icon: Icons.wifi,
                title: 'Same WiFi as my Mac',
                subtitle: 'Fastest and easiest - no setup needed',
                recommended: true,
                onTap: () {
                  ref
                      .read(onboardingProvider.notifier)
                      .setConnectionMode(ConnectionMode.sameWifi);
                },
              ),
              const SizedBox(height: 16),
              _buildOptionCard(
                context,
                ocTheme,
                icon: Icons.public,
                title: 'Different network / Remote',
                subtitle: 'Coffee shop, office, traveling',
                recommended: false,
                onTap: () {
                  ref
                      .read(onboardingProvider.notifier)
                      .setConnectionMode(ConnectionMode.remote);
                },
              ),
              const Spacer(),
              Center(
                child: TextButton.icon(
                  onPressed: () {
                    ref.read(onboardingProvider.notifier).goToScanner();
                  },
                  icon: Icon(
                    Icons.skip_next,
                    size: 18,
                    color: ocTheme.textMuted,
                  ),
                  label: Text(
                    'Skip - I know what I\'m doing',
                    style: TextStyle(color: ocTheme.textMuted),
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOptionCard(
    BuildContext context,
    OpenCodeTheme ocTheme, {
    required IconData icon,
    required String title,
    required String subtitle,
    required bool recommended,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: recommended ? ocTheme.primary : ocTheme.borderSubtle,
            width: recommended ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: ocTheme.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: ocTheme.primary, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: TextStyle(
                            color: ocTheme.text,
                            fontWeight: FontWeight.w600,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      if (recommended)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.success.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'Recommended',
                            style: TextStyle(
                              color: ocTheme.success,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
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
}
