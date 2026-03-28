import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Displays hook execution status inline in the chat.
class CxHookStatusRow extends StatelessWidget {
  const CxHookStatusRow({super.key, required this.hooks});

  /// List of hook run summaries as raw JSON maps.
  final List<Map<String, dynamic>> hooks;

  @override
  Widget build(BuildContext context) {
    if (hooks.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Text('🪝', style: TextStyle(fontSize: 12)),
              const SizedBox(width: 6),
              Text(
                'Hooks',
                style: AppTypography.labelLarge(color: theme.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ...hooks.map((hook) {
            final status = hook['status']?.toString() ?? 'running';
            final handlerType = hook['handlerType']?.toString() ?? '';
            final durationMs = hook['durationMs'] as num?;
            final statusMessage = hook['statusMessage']?.toString();

            final icon = switch (status) {
              'completed' => '✅',
              'failed' => '❌',
              'blocked' => '🚫',
              'stopped' => '⏹️',
              _ => '⏳',
            };

            final durationStr = durationMs != null
                ? '${(durationMs / 1000).toStringAsFixed(1)}s'
                : '';

            return Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                children: [
                  Text(icon, style: const TextStyle(fontSize: 12)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      handlerType.isNotEmpty ? handlerType : 'hook',
                      style: AppTypography.bodySmall(color: theme.text),
                    ),
                  ),
                  if (durationStr.isNotEmpty)
                    Text(
                      durationStr,
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  if (statusMessage != null && status == 'failed') ...[
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        statusMessage,
                        style: AppTypography.label(color: theme.error),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
