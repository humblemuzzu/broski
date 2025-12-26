import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';

class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(flex: 2),
              _buildLogo(ocTheme),
              const SizedBox(height: 32),
              Text(
                'Broski',
                style: Theme.of(context).textTheme.displaySmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: ocTheme.text,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Code from your phone.\nYour Mac does the work.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: ocTheme.textMuted,
                  height: 1.5,
                ),
              ),
              const Spacer(flex: 3),
              _buildFeatureRow(
                ocTheme,
                Icons.phone_iphone,
                'Phone',
                'Control your AI coding agent',
              ),
              const SizedBox(height: 16),
              _buildFeatureRow(
                ocTheme,
                Icons.laptop_mac,
                'Mac',
                'Runs OpenCode with full power',
              ),
              const SizedBox(height: 16),
              _buildFeatureRow(
                ocTheme,
                Icons.public,
                'Anywhere',
                'Same WiFi or across the world',
              ),
              const Spacer(flex: 2),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: () {
                    ref.read(onboardingProvider.notifier).setHasMacSetup(false);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: ocTheme.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text(
                    'Get Started',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () {
                  ref.read(onboardingProvider.notifier).setHasMacSetup(true);
                },
                child: Text(
                  'I already have broski-bridge running',
                  style: TextStyle(color: ocTheme.textMuted),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLogo(OpenCodeTheme ocTheme) {
    return Container(
      width: 100,
      height: 100,
      decoration: BoxDecoration(
        color: ocTheme.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: ocTheme.primary.withValues(alpha: 0.3),
          width: 2,
        ),
      ),
      child: Icon(Icons.code_rounded, size: 48, color: ocTheme.primary),
    );
  }

  Widget _buildFeatureRow(
    OpenCodeTheme ocTheme,
    IconData icon,
    String title,
    String subtitle,
  ) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: ocTheme.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: ocTheme.primary, size: 24),
          ),
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
        ],
      ),
    );
  }
}
