import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_subscription_provider.dart';
import '../screens/paywall_screen.dart';

/// Overlay widget that shows "Upgrade to Pro" for unpaid users.
/// Wraps content and shows a lock overlay when user is not entitled.
///
/// Usage:
/// ```dart
/// UpgradeOverlay(
///   child: YourScreenContent(),
/// )
/// ```
class UpgradeOverlay extends ConsumerWidget {
  const UpgradeOverlay({
    super.key,
    required this.child,
    this.message = 'Subscribe to Pro to unlock this feature',
    this.showChild = false,
  });

  /// The child widget to show underneath (blurred/dimmed when locked)
  final Widget child;

  /// Custom message to show on the overlay
  final String message;

  /// If true, shows child behind the overlay (dimmed). If false, replaces entirely.
  final bool showChild;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sub = ref.watch(appSubscriptionProvider);

    // If entitled, just show the child
    if (sub.entitled) {
      return child;
    }

    // Not entitled - show locked overlay
    return Stack(
      children: [
        // Optionally show the child behind (dimmed)
        if (showChild)
          Opacity(
            opacity: 0.15,
            child: IgnorePointer(child: child),
          ),

        // Lock overlay
        _LockOverlay(
          message: message,
          priceText: sub.monthlyPriceText ?? '\$20',
          isLoading: sub.isLoading,
        ),
      ],
    );
  }
}

class _LockOverlay extends StatelessWidget {
  const _LockOverlay({
    required this.message,
    required this.priceText,
    required this.isLoading,
  });

  final String message;
  final String priceText;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0A0A0A),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Lock icon with glow effect
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white.withValues(alpha: 0.05),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.1),
                      width: 1,
                    ),
                  ),
                  child: Icon(
                    Icons.lock_outline_rounded,
                    size: 36,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
                const SizedBox(height: 28),

                // Title
                const Text(
                  'Upgrade to Pro',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 12),

                // Message
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.5),
                    fontSize: 15,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 32),

                // Subscribe button
                _SubscribeButton(
                  priceText: priceText,
                  isLoading: isLoading,
                ),
                const SizedBox(height: 16),

                // Restore purchases link
                const _RestorePurchasesLink(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubscribeButton extends ConsumerWidget {
  const _SubscribeButton({
    required this.priceText,
    required this.isLoading,
  });

  final String priceText;
  final bool isLoading;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GestureDetector(
      onTap: isLoading
          ? null
          : () {
              HapticFeedback.mediumImpact();
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const PaywallScreen(),
                  fullscreenDialog: true,
                ),
              );
            },
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(maxWidth: 300),
        height: 56,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(28),
          boxShadow: [
            BoxShadow(
              color: Colors.white.withValues(alpha: 0.1),
              blurRadius: 20,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Center(
          child: isLoading
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
                    Text(
                      'Subscribe - $priceText/mo',
                      style: const TextStyle(
                        color: Color(0xFF111111),
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Icon(
                      Icons.arrow_forward_rounded,
                      color: Color(0xFF111111),
                      size: 18,
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _RestorePurchasesLink extends ConsumerWidget {
  const _RestorePurchasesLink();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sub = ref.watch(appSubscriptionProvider);

    return GestureDetector(
      onTap: sub.isLoading
          ? null
          : () {
              HapticFeedback.lightImpact();
              ref.read(appSubscriptionProvider.notifier).restorePurchases();
            },
      child: Text(
        'Restore Purchases',
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.4),
          fontSize: 14,
          decoration: TextDecoration.underline,
          decorationColor: Colors.white.withValues(alpha: 0.2),
        ),
      ),
    );
  }
}

/// A simpler inline banner for settings screen
class SubscribeBanner extends ConsumerWidget {
  const SubscribeBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sub = ref.watch(appSubscriptionProvider);

    // Don't show if already entitled
    if (sub.entitled) {
      return const SizedBox.shrink();
    }

    return GestureDetector(
      onTap: () {
        HapticFeedback.mediumImpact();
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => const PaywallScreen(),
            fullscreenDialog: true,
          ),
        );
      },
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              const Color(0xFF1A1A1A),
              const Color(0xFF0F0F0F),
            ],
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.08),
            width: 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                Icons.workspace_premium_rounded,
                color: Colors.amber.withValues(alpha: 0.8),
                size: 24,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Upgrade to Pro',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Unlock all features • ${sub.monthlyPriceText ?? '\$20'}/mo',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: Colors.white.withValues(alpha: 0.3),
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}
