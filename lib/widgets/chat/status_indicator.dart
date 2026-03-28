import 'package:broski/models/session.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

// Feature 13: Animated status indicator for session state
class StatusIndicator extends StatefulWidget {
  const StatusIndicator({
    super.key,
    required this.isConnected,
    required this.sessionStatus,
  });
  final bool isConnected;
  final SessionStatus sessionStatus;
  @override
  State<StatusIndicator> createState() => _StatusIndicatorState();
}

class _StatusIndicatorState extends State<StatusIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    );
    _updateAnimation();
  }

  @override
  void didUpdateWidget(StatusIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    _updateAnimation();
  }

  void _updateAnimation() {
    if (widget.sessionStatus.isBusy || widget.sessionStatus.isRetry) {
      _controller.repeat();
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final status = widget.sessionStatus;
    // Connection color
    Color baseColor;
    if (!widget.isConnected) {
      baseColor = theme.error; // Red - disconnected
    } else if (status.isBusy) {
      baseColor = theme.info; // Blue - busy/working
    } else if (status.isRetry) {
      baseColor = theme.warning; // Yellow - retry
    } else {
      baseColor = theme.success; // Green - idle/connected
    }
    // Pulsing animation for busy/retry states
    if (status.isBusy || status.isRetry) {
      return AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          final opacity =
              0.4 + (0.6 * (0.5 + 0.5 * (_controller.value * 2 - 1).abs()));
          return Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: baseColor.withValues(alpha: opacity),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: baseColor.withValues(alpha: 0.3),
                  blurRadius: 4,
                  spreadRadius: 1,
                ),
              ],
            ),
          );
        },
      );
    }
    // Static indicator for idle/disconnected
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: baseColor, shape: BoxShape.circle),
    );
  }
}
