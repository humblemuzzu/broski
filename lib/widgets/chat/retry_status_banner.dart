import 'dart:async';
import 'package:flutter/material.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/models/session.dart';

// Task 1: Retry status countdown banner
class RetryStatusBanner extends StatefulWidget {
  const RetryStatusBanner({super.key, required this.status});
  final SessionStatus status;
  @override
  State<RetryStatusBanner> createState() => _RetryStatusBannerState();
}

class _RetryStatusBannerState extends State<RetryStatusBanner> {
  Timer? _countdownTimer;
  int _remainingSeconds = 0;
  @override
  void initState() {
    super.initState();
    _startCountdown();
  }

  @override
  void didUpdateWidget(RetryStatusBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.status.next != oldWidget.status.next) {
      _startCountdown();
    }
  }

  void _startCountdown() {
    _countdownTimer?.cancel();
    final nextTimestamp = widget.status.next;
    if (nextTimestamp == null || nextTimestamp == 0) {
      _remainingSeconds = 0;
      return;
    }
    _updateRemaining();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      _updateRemaining();
    });
  }

  void _updateRemaining() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final next = widget.status.next ?? 0;
    // next could be seconds or milliseconds — handle both
    final nextMs = next > 1e12 ? next : next * 1000;
    final remaining = ((nextMs - now) / 1000).ceil();
    setState(() {
      _remainingSeconds = remaining > 0 ? remaining : 0;
    });
    if (remaining <= 0) {
      _countdownTimer?.cancel();
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final attempt = widget.status.attempt ?? 0;
    final message = widget.status.message ?? 'Retrying...';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.15),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.refresh, color: theme.warning, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Retry #$attempt: $message'
              '${_remainingSeconds > 0 ? '. Next attempt in ${_remainingSeconds}s' : ''}',
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
