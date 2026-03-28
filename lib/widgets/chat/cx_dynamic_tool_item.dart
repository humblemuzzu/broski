import 'package:broski/models/codex/codex_dynamic_tool.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Displays a dynamic tool call item in the Codex chat.
/// Plugin/skill-defined tools invoked by the LLM.
class CxDynamicToolItem extends StatelessWidget {
  const CxDynamicToolItem({super.key, required this.toolCall});

  final CodexDynamicToolCall toolCall;

  @override
  Widget build(BuildContext context) {
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
          // Header row
          Row(
            children: [
              const Text('🔧', style: TextStyle(fontSize: 14)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  toolCall.tool,
                  style: AppTypography.labelLarge(color: theme.text),
                ),
              ),
              Text(toolCall.status.icon, style: const TextStyle(fontSize: 12)),
            ],
          ),
          // Arguments
          if (toolCall.arguments != null) ...[
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: theme.backgroundElement,
                borderRadius: Radii.brXs,
              ),
              child: Text(
                _formatArguments(toolCall.arguments),
                style: AppTypography.code(color: theme.textMuted),
                maxLines: 5,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
          // Output
          if (toolCall.contentItems.isNotEmpty) ...[
            const SizedBox(height: 6),
            ...toolCall.contentItems.map((item) {
              if (item.type == 'text' && item.text != null) {
                return Text(
                  item.text!,
                  style: AppTypography.bodySmall(color: theme.text),
                  maxLines: 10,
                  overflow: TextOverflow.ellipsis,
                );
              }
              if (item.type == 'image' && item.url != null) {
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: ClipRRect(
                    borderRadius: Radii.brSm,
                    child: Image.network(
                      item.url!,
                      height: 120,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Text(
                        'Image: ${item.url}',
                        style: AppTypography.label(color: theme.textMuted),
                      ),
                    ),
                  ),
                );
              }
              return const SizedBox.shrink();
            }),
          ],
          // Status
          if (toolCall.status != CodexDynamicToolCallStatus.inProgress) ...[
            const SizedBox(height: 4),
            Text(
              '${toolCall.status == CodexDynamicToolCallStatus.completed ? 'Completed' : 'Failed'}${toolCall.success ? '' : ' (unsuccessful)'}',
              style: AppTypography.label(
                color: toolCall.status == CodexDynamicToolCallStatus.failed
                    ? theme.error
                    : theme.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatArguments(dynamic args) {
    if (args is String) return args;
    if (args is Map) {
      return args.entries.map((e) => '${e.key}: ${e.value}').join('\n');
    }
    return args.toString();
  }
}
