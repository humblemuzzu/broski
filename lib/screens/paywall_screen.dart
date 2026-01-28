import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/app_auth_provider.dart';
import '../providers/app_subscription_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class PaywallScreen extends ConsumerWidget {
  const PaywallScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(appAuthProvider);
    final sub = ref.watch(appSubscriptionProvider);
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text(
                    'Broski Pro',
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: auth.isLoading
                        ? null
                        : () => ref.read(appAuthProvider.notifier).signOut(),
                    child: const Text('Sign out'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                'Unlock full access for \$20/month.',
                style: TextStyle(color: theme.textMuted, height: 1.4),
              ),
              const SizedBox(height: 18),
              _FeatureRow(
                icon: Icons.chat_bubble_rounded,
                title: 'Real-time chat',
                subtitle: 'Control your coding agents from anywhere.',
              ),
              const SizedBox(height: 10),
              _FeatureRow(
                icon: Icons.terminal_rounded,
                title: 'Approve commands',
                subtitle: 'Review and approve tools on your phone.',
              ),
              const SizedBox(height: 10),
              _FeatureRow(
                icon: Icons.difference_rounded,
                title: 'See file changes',
                subtitle: 'Track edits and diffs live.',
              ),
              const Spacer(),
              if (sub.error != null)
                Text(
                  sub.error!,
                  style: TextStyle(color: theme.error),
                  textAlign: TextAlign.center,
                ),
              const SizedBox(height: 8),
              OnboardingButton(
                label: sub.monthlyPriceText != null
                    ? 'Subscribe • ${sub.monthlyPriceText}/month'
                    : 'Subscribe • \$20/month',
                isLoading: sub.isLoading,
                onPressed: () =>
                    ref.read(appSubscriptionProvider.notifier).purchaseMonthly(),
              ),
              const SizedBox(height: 12),
              OnboardingButton(
                label: 'Restore purchases',
                variant: OnboardingButtonVariant.ghost,
                isLoading: sub.isLoading,
                onPressed: () =>
                    ref.read(appSubscriptionProvider.notifier).restorePurchases(),
              ),
              const SizedBox(height: 10),
              if (sub.managementUrl != null)
                TextButton(
                  onPressed: () async {
                    final url = Uri.tryParse(sub.managementUrl!);
                    if (url != null) {
                      await launchUrl(
                        url,
                        mode: LaunchMode.externalApplication,
                      );
                    }
                  },
                  child: const Text('Manage subscription'),
                ),
              const SizedBox(height: 6),
              Text(
                'Payment is handled by Apple/Google via RevenueCat. Cancel anytime.',
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Icon(icon, color: theme.primary, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: theme.text,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

