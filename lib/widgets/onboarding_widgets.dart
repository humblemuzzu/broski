import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';

/// Step indicator showing current progress in onboarding flow
class OnboardingProgress extends StatelessWidget {
  const OnboardingProgress({
    super.key,
    required this.currentStep,
    required this.totalSteps,
  });
  final int currentStep;
  final int totalSteps;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(totalSteps, (index) {
        final isActive = index == currentStep;
        final isCompleted = index < currentStep;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutCubic,
          margin: const EdgeInsets.symmetric(horizontal: 4),
          width: isActive ? 24 : 8,
          height: 8,
          decoration: BoxDecoration(
            color: isActive || isCompleted ? theme.primary : theme.borderSubtle,
            borderRadius: Radii.brXs,
          ),
        );
      }),
    );
  }
}

/// Consistent scaffold for onboarding screens
class OnboardingScaffold extends StatelessWidget {
  const OnboardingScaffold({
    super.key,
    required this.child,
    this.currentStep,
    this.totalSteps,
    this.onBack,
    this.showProgress = true,
    this.bottomContent,
  });
  final Widget child;
  final int? currentStep;
  final int? totalSteps;
  final VoidCallback? onBack;
  final bool showProgress;
  final Widget? bottomContent;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final showProgressIndicator =
        showProgress && currentStep != null && totalSteps != null;
    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          children: [
            // Top bar with back button and progress
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              child: Row(
                children: [
                  if (onBack != null)
                    IconButton(
                      onPressed: onBack,
                      icon: Icon(AppIcons.back, color: theme.text, size: 20),
                      style: IconButton.styleFrom(
                        backgroundColor: theme.backgroundPanel,
                        padding: Insets.cardSm,
                      ),
                    )
                  else
                    const SizedBox(width: 48),
                  const Spacer(),
                  if (showProgressIndicator)
                    OnboardingProgress(
                      currentStep: currentStep!,
                      totalSteps: totalSteps!,
                    ),
                  const Spacer(),
                  const SizedBox(width: 48),
                ],
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: child,
              ),
            ),
            // Bottom content (buttons)
            if (bottomContent != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                child: bottomContent!,
              ),
          ],
        ),
      ),
    );
  }
}

/// Primary button for onboarding with loading state
class OnboardingButton extends StatefulWidget {
  const OnboardingButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    this.variant = OnboardingButtonVariant.primary,
    this.icon,
  });
  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final OnboardingButtonVariant variant;
  final IconData? icon;
  @override
  State<OnboardingButton> createState() => _OnboardingButtonState();
}

enum OnboardingButtonVariant { primary, secondary, ghost }

class _OnboardingButtonState extends State<OnboardingButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 0.98,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (bgColor, textColor, borderColor) = switch (widget.variant) {
      OnboardingButtonVariant.primary => (
        theme.primary,
        theme.background,
        Colors.transparent,
      ),
      OnboardingButtonVariant.secondary => (
        theme.backgroundPanel,
        theme.text,
        theme.borderSubtle,
      ),
      OnboardingButtonVariant.ghost => (
        Colors.transparent,
        theme.textMuted,
        Colors.transparent,
      ),
    };
    return GestureDetector(
      onTapDown: (_) => _controller.forward(),
      onTapUp: (_) {
        _controller.reverse();
        if (!widget.isLoading && widget.onPressed != null) {
          widget.onPressed!();
        }
      },
      onTapCancel: () => _controller.reverse(),
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) {
          return Transform.scale(scale: _scaleAnimation.value, child: child);
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: double.infinity,
          height: 56,
          decoration: BoxDecoration(
            color: widget.onPressed == null
                ? bgColor.withValues(alpha: 0.5)
                : bgColor,
            borderRadius: Radii.brLg,
            border: Border.all(color: borderColor),
          ),
          child: Center(
            child: widget.isLoading
                ? SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: textColor,
                    ),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (widget.icon != null) ...[
                        Icon(widget.icon, color: textColor, size: 20),
                        const SizedBox(width: 10),
                      ],
                      Text(
                        widget.label,
                        style: TextStyle(
                          color: widget.onPressed == null
                              ? textColor.withValues(alpha: 0.5)
                              : textColor,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// Option card for selecting choices in onboarding
class OnboardingOptionCard extends StatelessWidget {
  const OnboardingOptionCard({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.isRecommended = false,
    this.iconColor,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool isRecommended;
  final Color? iconColor;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final effectiveIconColor = iconColor ?? theme.primary;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: Insets.screenAll,
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brLg,
          border: Border.all(
            color: isRecommended ? theme.primary : theme.borderSubtle,
            width: isRecommended ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: effectiveIconColor.withValues(alpha: 0.12),
                borderRadius: Radii.brLg,
              ),
              child: Icon(icon, color: effectiveIconColor, size: 26),
            ),
            SizedBox(width: Spacing.lg),
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
                            color: theme.text,
                            fontWeight: FontWeight.w600,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      if (isRecommended)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: theme.success.withValues(alpha: 0.12),
                            borderRadius: Radii.brSm,
                          ),
                          child: Text(
                            'Recommended',
                            style: TextStyle(
                              color: theme.success,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  SizedBox(height: Spacing.xs),
                  Text(
                    subtitle,
                    style: AppTypography.labelLarge(color: theme.textMuted),
                  ),
                ],
              ),
            ),
            SizedBox(width: Spacing.sm),
            Icon(AppIcons.chevronRight, color: theme.textMuted, size: 24),
          ],
        ),
      ),
    );
  }
}

/// Feature row for welcome screen highlights
class OnboardingFeatureRow extends StatelessWidget {
  const OnboardingFeatureRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.iconColor,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final Color? iconColor;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final effectiveIconColor = iconColor ?? theme.primary;
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: effectiveIconColor.withValues(alpha: 0.12),
              borderRadius: Radii.brMd,
            ),
            child: Icon(icon, color: effectiveIconColor, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.text,
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                  ),
                ),
                SizedBox(height: Spacing.xxs),
                Text(
                  subtitle,
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Info card for explanatory content
class OnboardingInfoCard extends StatelessWidget {
  const OnboardingInfoCard({
    super.key,
    required this.title,
    required this.content,
    this.icon = AppIcons.info,
    this.color,
  });
  final String title;
  final String content;
  final IconData icon;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final effectiveColor = color ?? theme.info;
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: effectiveColor.withValues(alpha: 0.08),
        borderRadius: Radii.brLg,
        border: Border.all(color: effectiveColor.withValues(alpha: 0.2)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: effectiveColor, size: 20),
          SizedBox(width: Spacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.text,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                SizedBox(height: Spacing.xs),
                Text(
                  content,
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Step indicator for numbered instructions
class OnboardingStepItem extends StatelessWidget {
  const OnboardingStepItem({
    super.key,
    required this.stepNumber,
    required this.title,
    this.subtitle,
    this.content,
  });
  final int stepNumber;
  final String title;
  final String? subtitle;
  final Widget? content;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: theme.primary.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              '$stepNumber',
              style: TextStyle(
                color: theme.primary,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                ),
              ),
              if (subtitle != null) ...[
                SizedBox(height: Spacing.xs),
                Text(
                  subtitle!,
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ],
              if (content != null) ...[SizedBox(height: Spacing.md), content!],
            ],
          ),
        ),
      ],
    );
  }
}

/// Command box for displaying terminal commands
class OnboardingCommandBox extends StatelessWidget {
  const OnboardingCommandBox({
    super.key,
    required this.command,
    required this.onCopy,
  });
  final String command;
  final VoidCallback onCopy;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.border),
      ),
      child: Row(
        children: [
          Icon(AppIcons.terminal, color: theme.textMuted, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(command, style: AppTypography.code(color: theme.text)),
          ),
          GestureDetector(
            onTap: onCopy,
            child: Container(
              padding: Insets.cardXs,
              decoration: BoxDecoration(
                color: theme.primary.withValues(alpha: 0.12),
                borderRadius: Radii.brSm,
              ),
              child: Icon(AppIcons.copy, color: theme.primary, size: 18),
            ),
          ),
        ],
      ),
    );
  }
}
