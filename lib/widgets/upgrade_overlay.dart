import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_subscription_provider.dart';
import '../screens/paywall_screen.dart';
import '../theme/opencode_theme.dart';

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
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      color: ocTheme.background,
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
                    color: ocTheme.bgHover,
                    border: Border.all(
                      color: ocTheme.borderSubtle,
                      width: 1,
                    ),
                  ),
                  child: Icon(
                    Icons.lock_outline_rounded,
                    size: 36,
                    color: ocTheme.textMuted,
                  ),
                ),
                const SizedBox(height: 28),

                // Title
                Text(
                  'Upgrade to Pro',
                  style: TextStyle(
                    color: ocTheme.text,
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
                    color: ocTheme.textMuted,
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
    final ocTheme = OpenCodeTheme.of(context);

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
          color: ocTheme.primary,
          borderRadius: BorderRadius.circular(28),
          boxShadow: [
            BoxShadow(
              color: ocTheme.primary.withValues(alpha: 0.2),
              blurRadius: 20,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Center(
          child: isLoading
              ? SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: ocTheme.selectedListItemText,
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Subscribe - $priceText/mo',
                      style: TextStyle(
                        color: ocTheme.selectedListItemText,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Icon(
                      Icons.arrow_forward_rounded,
                      color: ocTheme.selectedListItemText,
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

    final ocTheme = OpenCodeTheme.of(context);

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
          color: ocTheme.textMuted,
          fontSize: 14,
          decoration: TextDecoration.underline,
          decorationColor: ocTheme.textMuted.withValues(alpha: 0.5),
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
      child: Builder(builder: (context) {
        final ocTheme = OpenCodeTheme.of(context);
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: ocTheme.borderSubtle,
              width: 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: ocTheme.bgHighlight,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.workspace_premium_rounded,
                  color: ocTheme.warning,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Upgrade to Pro',
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Unlock all features • ${sub.monthlyPriceText ?? '\$20'}/mo',
                      style: TextStyle(
                        color: ocTheme.textMuted,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: ocTheme.textMuted,
                size: 24,
              ),
            ],
          ),
        );
      }),
    );
  }
}
