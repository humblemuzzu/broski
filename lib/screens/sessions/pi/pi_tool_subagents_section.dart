import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/providers/pi_tool_subagents_provider.dart';
import 'package:broski/screens/sheets/pi_subagent_detail_sheet.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

export 'package:broski/providers/pi_tool_subagents_provider.dart'
    show piToolSubagentsProvider, PiToolSubagentsKey;

/// Renders the list of Pi tool subagent invocations under a parent session
/// card. Each row is tappable: opens a read-only detail sheet backed by
/// `pi_get_subagent_invocation` which re-reads the parent JSONL to return
/// the full untruncated tool call + result.
class PiToolSubagentsSection extends ConsumerWidget {
  const PiToolSubagentsSection({
    super.key,
    required this.sessionId,
    required this.cwd,
  });

  final String sessionId;
  final String cwd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final toolsAsync = ref.watch(
      piToolSubagentsProvider(
        PiToolSubagentsKey(sessionId: sessionId, cwd: cwd),
      ),
    );

    return toolsAsync.when(
      loading: () => Padding(
        padding: const EdgeInsets.only(left: 24, bottom: 8),
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: ocTheme.textMuted,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              'Loading subagents…',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
          ],
        ),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (tools) {
        if (tools.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: tools.map((tool) {
            return _PiToolSubagentCard(tool: tool);
          }).toList(),
        );
      },
    );
  }
}

class _PiToolSubagentCard extends StatelessWidget {
  const _PiToolSubagentCard({required this.tool});

  final RuntimeSessionSummary tool;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final typeLabel = tool.subagentType ?? 'subagent';
    final backendData = tool.backendData ?? const {};
    final resultPreview = backendData['resultPreview'] as String?;
    final toolCallId = backendData['toolCallId'] as String? ?? '';
    final parentSessionPath = backendData['parentSessionPath'] as String? ?? '';
    final resultIsError = backendData['resultIsError'] as bool? ?? false;
    final prompt = backendData['prompt'] as String? ?? tool.title;

    final canTap = toolCallId.isNotEmpty && parentSessionPath.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.only(left: 24, bottom: 8),
      child: Material(
        color: ocTheme.backgroundElement.withValues(alpha: 0.4),
        borderRadius: Radii.brSm,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: canTap
              ? () => showPiSubagentDetailSheet(
                  context,
                  parentSessionPath: parentSessionPath,
                  toolCallId: toolCallId,
                  toolName: typeLabel,
                  initialPromptPreview: prompt,
                )
              : null,
          // IntrinsicHeight lets the 2px accent bar stretch to match the
          // full content column height, so multi-line cards still show a
          // continuous colored edge instead of a short stub.
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 2,
                  decoration: BoxDecoration(
                    color: (resultIsError ? ocTheme.error : ocTheme.primary)
                        .withValues(alpha: 0.4),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 5,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: ocTheme.primary.withValues(alpha: 0.12),
                                borderRadius: Radii.brXs,
                              ),
                              child: Text(
                                typeLabel,
                                style: TextStyle(
                                  color: ocTheme.primary,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                tool.title,
                                style: TextStyle(
                                  color: ocTheme.text.withValues(alpha: 0.85),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        if (resultPreview != null &&
                            resultPreview.isNotEmpty) ...[
                          const SizedBox(height: Spacing.xs),
                          Text(
                            resultPreview,
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 11,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
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
