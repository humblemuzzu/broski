import 'package:broski/providers/chat/chat_run_state.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shown above the input bar for as long as the agent is working, with the one control that always
/// ends the run: Stop.
class RunningStopBar extends ConsumerWidget {
  const RunningStopBar({super.key, required this.onStop});

  final VoidCallback onStop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final running = ref.watch(chatSessionProvider.select(chatIsRunning));
    if (!running) return const SizedBox.shrink();
    return RunningStopBarView(
      barKey: const ValueKey('running-stop-bar'),
      stopKey: const ValueKey('running-stop-button'),
      onStop: onStop,
    );
  }
}

/// The working bar itself: a spinner, what is going on, and Stop.
class RunningStopBarView extends StatelessWidget {
  const RunningStopBarView({
    super.key,
    required this.onStop,
    this.label = 'Working',
    this.barKey,
    this.stopKey,
    this.spinnerLabel,
  });

  final VoidCallback onStop;
  final String label;
  final Key? barKey;
  final Key? stopKey;

  /// What a screen reader says the spinner shows.
  final String? spinnerLabel;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      key: barKey,
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      decoration: BoxDecoration(
        color: theme.primary.withValues(alpha: 0.08),
        border: Border(
          top: BorderSide(color: theme.primary.withValues(alpha: 0.2)),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: theme.primary,
              semanticsLabel: spinnerLabel,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: AppTypography.label(color: theme.primary),
            ),
          ),
          TextButton.icon(
            key: stopKey,
            onPressed: onStop,
            icon: Icon(AppIcons.stop, size: 14, color: theme.error),
            label: Text('Stop', style: AppTypography.label(color: theme.error)),
          ),
        ],
      ),
    );
  }
}
