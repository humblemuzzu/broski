import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Status types for the unified status indicator.
enum StatusType {
  /// Connected/online state (green)
  connected,

  /// Disconnected/offline state (red)
  disconnected,

  /// Success state (green)
  success,

  /// Error/failure state (red)
  error,

  /// Warning state (orange/amber)
  warning,

  /// Info/neutral state (blue)
  info,

  /// Running/busy state (blue, animated)
  running,

  /// Pending/waiting state (muted, may animate)
  pending,

  /// Retry state (yellow/amber, animated)
  retry,
}

/// A unified status indicator widget that replaces all the scattered
/// status dot implementations across the app.
///
/// This widget uses OpenCodeTheme colors and provides consistent styling
/// for all status indicators throughout the app.
///
/// Features:
/// - Consistent sizing and colors from theme
/// - Optional glow effect for emphasis
/// - Optional pulse animation for active states
/// - Semantic status types
class StatusIndicator extends StatelessWidget {
  const StatusIndicator({
    super.key,
    required this.status,
    this.size = 8,
    this.showGlow = false,
    this.showPulse = false,
  });

  /// The status to display
  final StatusType status;

  /// Size of the indicator dot
  final double size;

  /// Whether to show a glow effect around the indicator
  final bool showGlow;

  /// Whether to show a pulse animation (for running/pending states)
  final bool showPulse;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = _getColor(theme);

    // Use pulse animation for running/pending/retry states
    final shouldPulse =
        showPulse &&
        (status == StatusType.running ||
            status == StatusType.pending ||
            status == StatusType.retry);

    if (shouldPulse) {
      return _PulsingIndicator(color: color, size: size, showGlow: showGlow);
    }

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: showGlow
            ? [
                BoxShadow(
                  color: color.withValues(alpha: 0.4),
                  blurRadius: size,
                  spreadRadius: size * 0.25,
                ),
              ]
            : null,
      ),
    );
  }

  Color _getColor(OpenCodeTheme theme) {
    switch (status) {
      case StatusType.connected:
      case StatusType.success:
        return theme.success;
      case StatusType.disconnected:
      case StatusType.error:
        return theme.error;
      case StatusType.warning:
        return theme.warning;
      case StatusType.info:
      case StatusType.running:
        return theme.info;
      case StatusType.pending:
        return theme.textMuted;
      case StatusType.retry:
        return theme.warning;
    }
  }
}

/// Internal widget for pulsing animation
class _PulsingIndicator extends StatefulWidget {
  const _PulsingIndicator({
    required this.color,
    required this.size,
    required this.showGlow,
  });

  final Color color;
  final double size;
  final bool showGlow;

  @override
  State<_PulsingIndicator> createState() => _PulsingIndicatorState();
}

class _PulsingIndicatorState extends State<_PulsingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        // Smooth pulse: opacity goes from 0.4 to 1.0 and back
        final value = _controller.value;
        final opacity = 0.4 + (0.6 * (0.5 + 0.5 * (value * 2 - 1).abs()));

        return Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: widget.color.withValues(alpha: opacity),
            shape: BoxShape.circle,
            boxShadow: widget.showGlow
                ? [
                    BoxShadow(
                      color: widget.color.withValues(alpha: 0.3 * opacity),
                      blurRadius: widget.size,
                      spreadRadius: widget.size * 0.25,
                    ),
                  ]
                : null,
          ),
        );
      },
    );
  }
}

/// A labeled status indicator with text
class LabeledStatusIndicator extends StatelessWidget {
  const LabeledStatusIndicator({
    super.key,
    required this.status,
    required this.label,
    this.size = 8,
    this.showGlow = false,
    this.showPulse = false,
    this.spacing = 8,
    this.style,
  });

  final StatusType status;
  final String label;
  final double size;
  final bool showGlow;
  final bool showPulse;
  final double spacing;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        StatusIndicator(
          status: status,
          size: size,
          showGlow: showGlow,
          showPulse: showPulse,
        ),
        SizedBox(width: spacing),
        Text(label, style: style ?? AppTypography.bodySmall(color: theme.text)),
      ],
    );
  }
}

/// A status chip with icon and label
class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.status,
    required this.label,
    this.icon,
  });

  final StatusType status;
  final String label;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = _getColor(theme);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: Radii.brSm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Color _getColor(OpenCodeTheme theme) {
    switch (status) {
      case StatusType.connected:
      case StatusType.success:
        return theme.success;
      case StatusType.disconnected:
      case StatusType.error:
        return theme.error;
      case StatusType.warning:
      case StatusType.retry:
        return theme.warning;
      case StatusType.info:
      case StatusType.running:
        return theme.info;
      case StatusType.pending:
        return theme.textMuted;
    }
  }
}
