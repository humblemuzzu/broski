import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Compact single-line chip that summarizes multiple tool calls.
/// Rendered inline in the chat message list.
class CompactToolSummaryChip extends ConsumerWidget {
  final String summary;

  const CompactToolSummaryChip({super.key, required this.summary});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context).extension<OpenCodeTheme>()!;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.borderSubtle.withValues(alpha: 0.4),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.summarize_outlined, size: 14, color: theme.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              summary,
              style: TextStyle(
                fontSize: 12,
                color: theme.textMuted,
                height: 1.3,
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
