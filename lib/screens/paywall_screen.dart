import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_auth_provider.dart';
import '../providers/app_subscription_provider.dart';
import '../providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;
import '../theme/opencode_theme.dart';

class PaywallScreen extends ConsumerWidget {
  const PaywallScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(appAuthProvider);
    final sub = ref.watch(appSubscriptionProvider);
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: SafeArea(
        child: Padding(
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
                                const Color(0xFF111111).withValues(alpha: 0.85),
                                const Color(0xFF111111).withValues(alpha: 0.3),
                                const Color(0xFF111111).withValues(alpha: 0.6),
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
                            // Early Access badge
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(24),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.12),
                                  width: 1,
                                ),
                              ),
                              child: Text(
                                'EARLY ACCESS BATCH #42',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.9),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 1.5,
                                ),
                              ),
                            ),
                            const SizedBox(height: 28),
                            // PRO heading
                            const Text(
                              'PRO',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 52,
                                fontWeight: FontWeight.w900,
                                height: 1.0,
                                letterSpacing: -1,
                              ),
                            ),
                            // ACCESS heading
                            ShaderMask(
                              shaderCallback: (bounds) => const LinearGradient(
                                colors: [Color(0xFFB0B0B0), Color(0xFF707070)],
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                              ).createShader(bounds),
                              child: const Text(
                                'ACCESS',
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
                              'The limit does not exist.',
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
                              label: 'Priority 4ms Latency',
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
                              'PRO LICENSE',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.45),
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 1.5,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.baseline,
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
                                    color: Colors.white.withValues(alpha: 0.4),
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
                              color: const Color(
                                0xFF2ECB71,
                              ).withValues(alpha: 0.5),
                              width: 1,
                            ),
                          ),
                          child: const Text(
                            'Cancel Anytime',
                            style: TextStyle(
                              color: Color(0xFF2ECB71),
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
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Text(
                                      'Initialize Subscription',
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
                        GestureDetector(
                          onTap: sub.isLoading
                              ? null
                              : () => ref
                                    .read(appSubscriptionProvider.notifier)
                                    .restorePurchases(),
                          child: Text(
                            'Payment charged to iTunes Account.',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.35),
                              fontSize: 12,
                            ),
                          ),
                        ),
                        Text(
                          ' Terms & Privacy apply.',
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
                            ref.read(onboardingProvider.notifier).skipForward();
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
