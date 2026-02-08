import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/app_auth_provider.dart';
import '../providers/app_subscription_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;
import '../theme/opencode_theme.dart';

class PaywallScreen extends ConsumerWidget {
  const PaywallScreen({super.key, this.showCloseButton = true});

  /// Whether to show the X close button (for Apple compliance).
  /// Set to false only during initial onboarding before any content is shown.
  final bool showCloseButton;

  void _handleDismiss(BuildContext context, WidgetRef ref) {
    HapticFeedback.lightImpact();

    final onboarding = ref.read(onboardingProvider);
    final sub = ref.read(appSubscriptionProvider);

    // Mark paywall as dismissed this session
    ref.read(paywallDismissedThisSessionProvider.notifier).state = true;

    // If we're in onboarding flow, complete it (user chose to skip payment)
    if (!onboarding.hasCompletedOnboarding) {
      ref.read(onboardingProvider.notifier).completeOnboarding();
    }

    // If user is NOT entitled, put them in offline mode so they land in MainShell
    // with the upgrade banner instead of going to the scanner
    if (!sub.entitled) {
      Future.microtask(
        () => ref.read(connectionProvider.notifier).enterUnpaidPreviewMode(),
      );
    }

    // If this was pushed as a modal, pop it
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(appAuthProvider);
    final sub = ref.watch(appSubscriptionProvider);
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: SafeArea(
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Column(
                children: [
                  // Main card with background image
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFF111111),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.06),
                          width: 1,
                        ),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Stack(
                        children: [
                          // Background image - the black box building
                          Positioned.fill(
                            child: Image.asset(
                              'docs/assets/black boxxx.png',
                              fit: BoxFit.cover,
                              alignment: const Alignment(0.3, -0.2),
                            ),
                          ),
                          // Subtle gradient overlay for text readability
                          Positioned.fill(
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [
                                    const Color(
                                      0xFF111111,
                                    ).withValues(alpha: 0.85),
                                    const Color(
                                      0xFF111111,
                                    ).withValues(alpha: 0.3),
                                    const Color(
                                      0xFF111111,
                                    ).withValues(alpha: 0.6),
                                  ],
                                  stops: const [0.0, 0.45, 1.0],
                                ),
                              ),
                            ),
                          ),
                          // Content on top of the image
                          Padding(
                            padding: const EdgeInsets.fromLTRB(28, 40, 28, 40),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // BROSKI PRO heading
                                const Text(
                                  'BROSKI',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 52,
                                    fontWeight: FontWeight.w900,
                                    height: 1.0,
                                    letterSpacing: -1,
                                  ),
                                ),
                                ShaderMask(
                                  shaderCallback: (bounds) =>
                                      const LinearGradient(
                                        colors: [
                                          Color(0xFFB0B0B0),
                                          Color(0xFF707070),
                                        ],
                                        begin: Alignment.topCenter,
                                        end: Alignment.bottomCenter,
                                      ).createShader(bounds),
                                  child: const Text(
                                    'PRO',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 52,
                                      fontWeight: FontWeight.w900,
                                      height: 1.0,
                                      letterSpacing: -1,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 12),
                                // Subtitle
                                Text(
                                  'Ship from anywhere, 24/7.',
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.45),
                                    fontSize: 16,
                                    fontWeight: FontWeight.w400,
                                    letterSpacing: 0.2,
                                  ),
                                ),
                                const SizedBox(height: 40),
                                // Feature list
                                _FeatureItem(
                                  icon: Icons.all_inclusive_rounded,
                                  label: 'Unlimited Sessions',
                                ),
                                const SizedBox(height: 24),
                                _FeatureItem(
                                  icon: Icons.developer_board_rounded,
                                  label: 'Multi-Provider Support',
                                ),
                                const SizedBox(height: 24),
                                _FeatureItem(
                                  icon: Icons.bolt_rounded,
                                  label: 'Real-Time Sync',
                                ),
                                const SizedBox(height: 24),
                                _FeatureItem(
                                  icon: Icons.terminal_rounded,
                                  label: 'Full Terminal Access',
                                ),
                                const SizedBox(height: 24),
                                _FeatureItem(
                                  icon: Icons.mic_rounded,
                                  label: 'Voice-to-Code Input',
                                ),
                                const SizedBox(height: 24),
                                _FeatureItem(
                                  icon: Icons.notifications_active_rounded,
                                  label: 'Push Notifications & Alerts',
                                ),
                                const SizedBox(height: 24),
                                _FeatureItem(
                                  icon: Icons.verified_user_outlined,
                                  label: 'Advanced Local Security',
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  // Bottom pricing section
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // PRO LICENSE label + pricing row
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'MONTHLY',
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.45),
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 1.5,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.baseline,
                                  textBaseline: TextBaseline.alphabetic,
                                  children: [
                                    Text(
                                      sub.monthlyPriceText ?? '\$20',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 42,
                                        fontWeight: FontWeight.w800,
                                        height: 1.0,
                                        letterSpacing: -1,
                                      ),
                                    ),
                                    Text(
                                      '/mo',
                                      style: TextStyle(
                                        color: Colors.white.withValues(
                                          alpha: 0.4,
                                        ),
                                        fontSize: 18,
                                        fontWeight: FontWeight.w400,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const Spacer(),
                            // Cancel Anytime badge
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 8,
                              ),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.15),
                                  width: 1,
                                ),
                              ),
                              child: Text(
                                'Cancel Anytime',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.5),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 20),
                        // Error message
                        if (sub.error != null) ...[
                          Text(
                            sub.error!,
                            style: TextStyle(color: theme.error, fontSize: 13),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 8),
                        ],
                        // Subscribe button
                        GestureDetector(
                          onTap: sub.isLoading
                              ? null
                              : () => ref
                                    .read(appSubscriptionProvider.notifier)
                                    .purchaseMonthly(),
                          child: Container(
                            width: double.infinity,
                            height: 58,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(32),
                            ),
                            child: Center(
                              child: sub.isLoading
                                  ? const SizedBox(
                                      width: 24,
                                      height: 24,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.5,
                                        color: Color(0xFF111111),
                                      ),
                                    )
                                  : Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        const Text(
                                          "I'm In",
                                          style: TextStyle(
                                            color: Color(0xFF111111),
                                            fontSize: 17,
                                            fontWeight: FontWeight.w700,
                                            letterSpacing: 0.3,
                                          ),
                                        ),
                                        const SizedBox(width: 10),
                                        Icon(
                                          Icons.arrow_forward_rounded,
                                          color: const Color(0xFF111111),
                                          size: 20,
                                        ),
                                      ],
                                    ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        // Restore + disclaimer row
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              'Payment charged to your Apple ID. ',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.35),
                                fontSize: 12,
                              ),
                            ),
                            GestureDetector(
                              onTap: () => launchUrl(
                                Uri.parse('https://broskiapp.com/legal/terms'),
                                mode: LaunchMode.externalApplication,
                              ),
                              child: Text(
                                'Terms',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.45),
                                  fontSize: 12,
                                  decoration: TextDecoration.underline,
                                  decorationColor: Colors.white.withValues(
                                    alpha: 0.3,
                                  ),
                                ),
                              ),
                            ),
                            Text(
                              ' & ',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.35),
                                fontSize: 12,
                              ),
                            ),
                            GestureDetector(
                              onTap: () => launchUrl(
                                Uri.parse(
                                  'https://broskiapp.com/legal/privacy',
                                ),
                                mode: LaunchMode.externalApplication,
                              ),
                              child: Text(
                                'Privacy',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.45),
                                  fontSize: 12,
                                  decoration: TextDecoration.underline,
                                  decorationColor: Colors.white.withValues(
                                    alpha: 0.3,
                                  ),
                                ),
                              ),
                            ),
                            Text(
                              ' apply.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.35),
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                        // Sign out + restore purchases links
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            GestureDetector(
                              onTap: sub.isLoading
                                  ? null
                                  : () => ref
                                        .read(appSubscriptionProvider.notifier)
                                        .restorePurchases(),
                              child: Text(
                                'Restore Purchases',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.5),
                                  fontSize: 12,
                                  decoration: TextDecoration.underline,
                                  decorationColor: Colors.white.withValues(
                                    alpha: 0.3,
                                  ),
                                ),
                              ),
                            ),
                            Text(
                              '  |  ',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.2),
                                fontSize: 12,
                              ),
                            ),
                            GestureDetector(
                              onTap: auth.isLoading
                                  ? null
                                  : () => ref
                                        .read(appAuthProvider.notifier)
                                        .signOut(),
                              child: Text(
                                'Sign Out',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.5),
                                  fontSize: 12,
                                  decoration: TextDecoration.underline,
                                  decorationColor: Colors.white.withValues(
                                    alpha: 0.3,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        // DEV BYPASS: skip paywall button
                        if (kDevBypassOnboarding) ...[
                          const SizedBox(height: 8),
                          Center(
                            child: GestureDetector(
                              onTap: () {
                                HapticFeedback.lightImpact();
                                ref
                                    .read(onboardingProvider.notifier)
                                    .skipForward();
                              },
                              child: Text(
                                'Skip (dev) \u2192',
                                style: TextStyle(
                                  color: Colors.red.withValues(alpha: 0.6),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // Close button (X) - Apple compliance
            if (showCloseButton)
              Positioned(
                top: 8,
                right: 8,
                child: GestureDetector(
                  onTap: () => _handleDismiss(context, ref),
                  behavior: HitTestBehavior.opaque,
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.close_rounded,
                      color: Colors.white.withValues(alpha: 0.8),
                      size: 22,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FeatureItem extends StatelessWidget {
  const _FeatureItem({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: Colors.white.withValues(alpha: 0.7), size: 24),
        const SizedBox(width: 16),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.85),
            fontSize: 17,
            fontWeight: FontWeight.w500,
            letterSpacing: 0.2,
          ),
        ),
      ],
    );
  }
}
