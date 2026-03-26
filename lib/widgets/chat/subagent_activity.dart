import 'package:flutter/material.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/models/message.dart';

/// Compact indicator shown below the floating header when Claude Code
/// subagents (Task tool calls) are actively running.
class SubagentActivityIndicator extends StatelessWidget {
  const SubagentActivityIndicator({
    super.key,
    required this.messages,
    required this.isStreaming,
  });
  final List<ChatMessage> messages;
  final bool isStreaming;
  @override
  Widget build(BuildContext context) {
    if (!isStreaming) return const SizedBox.shrink();
    // Find running Task tool calls from the most recent assistant message
    final activeSubagentNames = <String>[];
    for (var i = messages.length - 1; i >= 0; i--) {
      final msg = messages[i];
      if (msg.role != MessageRole.assistant) continue;
      for (final tool in msg.toolCalls) {
        final name = tool.name.toLowerCase();
        if ((name == 'task' || name == 'dispatch_agent') &&
            (tool.status == 'running' || tool.status == 'pending')) {
          final subagentType =
              tool.input['subagent_type'] as String? ??
              tool.input['agent'] as String? ??
              tool.input['agentName'] as String? ??
              tool.title ??
              'subagent';
          activeSubagentNames.add(subagentType);
        }
      }
      // Only check the most recent assistant message
      break;
    }
    if (activeSubagentNames.isEmpty) return const SizedBox.shrink();
    final theme = OpenCodeTheme.of(context);
    final label = activeSubagentNames.join(', ');
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: theme.info.withValues(alpha: 0.1),
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.info.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 10,
              height: 10,
              child: CircularProgressIndicator(
                strokeWidth: 1.5,
                color: theme.info,
              ),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                style: AppTypography.caption(color: theme.info),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
