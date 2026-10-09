import 'dart:convert';

import 'package:broski/models/pi_subagent_invocation.dart';
import 'package:broski/providers/pi_subagent_invocation_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/markdown_styles.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/adaptive_markdown_body.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Shows a detail sheet for a Pi tool subagent invocation (oracle, finder,
/// Task, librarian, code_review, look_at, or any user-configured extension
/// tool that spawns a child agent).
///
/// Unlike OpenCode/Codex/Pi-handoff subagents, Pi tool subagents have no
/// session file — the entire conversation lives inside the parent's JSONL
/// as a toolCall + toolResult pair. This sheet loads the full untruncated
/// data via `pi_get_subagent_invocation` and renders prompt + all result
/// blocks with markdown.
///
/// Also shows a "View Full Screen" button that opens a dedicated read-only
/// page for a larger, scrollable view of the same content.
Future<void> showPiSubagentDetailSheet(
  BuildContext context, {
  required String parentSessionPath,
  required String toolCallId,
  required String toolName,
  String? initialPromptPreview,
}) async {
  await DetailSheet.show(
    context: context,
    title: toolName,
    initialSize: 0.7,
    maxSize: 0.95,
    child: _PiSubagentDetailBody(
      parentSessionPath: parentSessionPath,
      toolCallId: toolCallId,
      toolName: toolName,
      initialPromptPreview: initialPromptPreview,
    ),
  );
}

class _PiSubagentDetailBody extends ConsumerWidget {
  const _PiSubagentDetailBody({
    required this.parentSessionPath,
    required this.toolCallId,
    required this.toolName,
    this.initialPromptPreview,
  });

  final String parentSessionPath;
  final String toolCallId;
  final String toolName;
  final String? initialPromptPreview;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final asyncInvocation = ref.watch(
      piSubagentInvocationProvider(
        PiSubagentInvocationKey(
          parentSessionPath: parentSessionPath,
          toolCallId: toolCallId,
        ),
      ),
    );

    return asyncInvocation.when(
      loading: () => Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: theme.info,
              ),
            ),
            const SizedBox(width: Spacing.md),
            Text(
              'Loading $toolName…',
              style: TextStyle(color: theme.textMuted),
            ),
          ],
        ),
      ),
      error: (err, _) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(AppIcons.error, size: 18, color: theme.error),
                const SizedBox(width: 8),
                Text(
                  'Failed to load subagent',
                  style: TextStyle(
                    color: theme.error,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('$err', style: TextStyle(color: theme.textMuted)),
          ],
        ),
      ),
      data: (inv) {
        if (inv == null) {
          // Fall back to the initial preview — the bridge couldn't find the
          // toolCallId in the parent JSONL.
          return _FallbackBody(
            toolName: toolName,
            promptPreview: initialPromptPreview ?? '',
          );
        }
        return _InvocationBody(
          invocation: inv,
          parentSessionPath: parentSessionPath,
        );
      },
    );
  }
}

class _InvocationBody extends StatelessWidget {
  const _InvocationBody({
    required this.invocation,
    required this.parentSessionPath,
  });

  final PiSubagentInvocation invocation;
  final String parentSessionPath;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _MetadataRow(invocation: invocation),
        const SizedBox(height: Spacing.md),
        if (invocation.parentAssistantThinking != null &&
            invocation.parentAssistantThinking!.trim().isNotEmpty)
          DetailSection(
            label: 'Parent reasoning',
            child: AdaptiveMarkdownBody(
              data: invocation.parentAssistantThinking!,
              selectable: true,
              styleSheet: MarkdownStyles.compact(theme),
            ),
          ),
        DetailSection(
          label: 'Prompt',
          child: SelectableText(
            invocation.promptPreview,
            style: TextStyle(color: theme.text, fontSize: 13, height: 1.45),
          ),
        ),
        if (_hasNonPromptArgs(invocation.fullArguments))
          DetailSection(
            label: 'Arguments',
            child: _ArgumentsBlock(args: invocation.fullArguments),
          ),
        DetailSection(
          label: invocation.isError ? 'Result (error)' : 'Result',
          child: _ContentBlocksView(blocks: invocation.contentBlocks),
        ),
        Padding(
          padding: const EdgeInsets.only(top: Spacing.md),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () {
                // Capture the root navigator BEFORE popping — once the sheet
                // is popped, `context` no longer belongs to a mounted widget
                // and calling Navigator.of(context) on it throws.
                // Also pass the already-loaded invocation directly so the
                // full-screen view doesn't re-fetch the same data from the
                // bridge (Riverpod may dispose the family entry between the
                // pop and the push).
                final rootNavigator = Navigator.of(
                  context,
                  rootNavigator: true,
                );
                Navigator.pop(context);
                rootNavigator.push(
                  MaterialPageRoute(
                    builder: (_) => PiSubagentFullScreen(
                      parentSessionPath: parentSessionPath,
                      toolCallId: invocation.toolCallId,
                      toolName: invocation.toolName,
                      preloadedInvocation: invocation,
                    ),
                  ),
                );
              },
              icon: Icon(AppIcons.openExternal, size: 16, color: theme.info),
              label: Text(
                'Open full screen',
                style: TextStyle(
                  color: theme.info,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: theme.info.withValues(alpha: 0.4)),
                shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ),
      ],
    );
  }

  static bool _hasNonPromptArgs(Map<String, dynamic> args) {
    for (final entry in args.entries) {
      if (!kPiSubagentPromptFields.contains(entry.key) && entry.value != null) {
        return true;
      }
    }
    return false;
  }
}

class _MetadataRow extends StatelessWidget {
  const _MetadataRow({required this.invocation});

  final PiSubagentInvocation invocation;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final duration = invocation.durationMs;
    return Wrap(
      spacing: 10,
      runSpacing: 6,
      children: [
        _MetaChip(
          icon: AppIcons.agent,
          label: invocation.toolName,
          color: theme.info,
        ),
        if (duration != null)
          _MetaChip(
            icon: AppIcons.pending,
            label: _formatDuration(duration),
            color: theme.textMuted,
          ),
        if (invocation.isError)
          _MetaChip(icon: AppIcons.error, label: 'error', color: theme.error),
      ],
    );
  }

  String _formatDuration(int ms) {
    if (ms < 1000) return '${ms}ms';
    final s = (ms / 1000).toStringAsFixed(ms < 10000 ? 2 : 1);
    return '${s}s';
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brSm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ArgumentsBlock extends StatelessWidget {
  const _ArgumentsBlock({required this.args});

  final Map<String, dynamic> args;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final entries = args.entries
        .where(
          (e) => !kPiSubagentPromptFields.contains(e.key) && e.value != null,
        )
        .toList();
    if (entries.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.backgroundElement.withValues(alpha: 0.5),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in entries) ...[
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: SelectableText.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${entry.key}: ',
                      style: TextStyle(
                        color: theme.textMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'monospace',
                      ),
                    ),
                    TextSpan(
                      text: _formatValue(entry.value),
                      style: TextStyle(
                        color: theme.text,
                        fontSize: 12,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatValue(dynamic value) {
    if (value is String) return value;
    try {
      return const JsonEncoder.withIndent('  ').convert(value);
    } catch (_) {
      return '$value';
    }
  }
}

class _ContentBlocksView extends StatelessWidget {
  const _ContentBlocksView({required this.blocks});

  final List<PiSubagentContentBlock> blocks;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    if (blocks.isEmpty) {
      return Text(
        '(no result)',
        style: TextStyle(color: theme.textMuted, fontStyle: FontStyle.italic),
      );
    }
    final children = <Widget>[];
    for (var i = 0; i < blocks.length; i++) {
      if (i > 0) children.add(const SizedBox(height: Spacing.sm));
      children.add(_buildBlock(context, blocks[i], theme));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: children,
    );
  }

  Widget _buildBlock(
    BuildContext context,
    PiSubagentContentBlock block,
    OpenCodeTheme theme,
  ) {
    if (block.type == 'text' && block.text != null) {
      return AdaptiveMarkdownBody(
        data: block.text!,
        selectable: true,
        styleSheet: MarkdownStyles.compact(theme),
        onTapLink: (_, href, __) {
          if (href != null) {
            launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
          }
        },
      );
    }
    // Fallback: render unknown block types as JSON for transparency.
    String encoded;
    try {
      encoded = const JsonEncoder.withIndent('  ').convert(block.data);
    } catch (_) {
      encoded = '${block.data}';
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.backgroundElement.withValues(alpha: 0.35),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: SelectableText(
        '[${block.type}]\n$encoded',
        style: TextStyle(
          color: theme.text,
          fontSize: 11,
          fontFamily: 'monospace',
          height: 1.4,
        ),
      ),
    );
  }
}

class _FallbackBody extends StatelessWidget {
  const _FallbackBody({required this.toolName, required this.promptPreview});

  final String toolName;
  final String promptPreview;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.all(Spacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Could not load $toolName invocation',
            style: TextStyle(
              color: theme.textMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          if (promptPreview.isNotEmpty)
            SelectableText(
              promptPreview,
              style: TextStyle(color: theme.text, fontSize: 13),
            ),
        ],
      ),
    );
  }
}

/// Full-screen read-only view of a Pi subagent invocation. Opens the same
/// data the detail sheet shows, but in a dedicated scrollable page with
/// more room for long results and code blocks.
///
/// Accepts an optional [preloadedInvocation] so the sheet → full-screen
/// transition doesn't have to re-fetch from the bridge when it already has
/// the data in hand.
class PiSubagentFullScreen extends ConsumerWidget {
  const PiSubagentFullScreen({
    super.key,
    required this.parentSessionPath,
    required this.toolCallId,
    required this.toolName,
    this.preloadedInvocation,
  });

  final String parentSessionPath;
  final String toolCallId;
  final String toolName;
  final PiSubagentInvocation? preloadedInvocation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);

    Widget scaffold(Widget body) => Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.backgroundPanel,
        elevation: 0,
        title: Text(
          toolName,
          style: TextStyle(color: theme.text, fontWeight: FontWeight.w600),
        ),
        iconTheme: IconThemeData(color: theme.text),
      ),
      body: SafeArea(child: body),
    );

    // Fast path: the caller handed us the loaded invocation. Render
    // immediately — no bridge round-trip, no flash of loading spinner.
    final pre = preloadedInvocation;
    if (pre != null) {
      return scaffold(
        SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: _InvocationBody(
            invocation: pre,
            parentSessionPath: parentSessionPath,
          ),
        ),
      );
    }

    // Slow path: no preloaded data (e.g. full-screen opened via a deep
    // link). Fetch via the provider.
    final asyncInvocation = ref.watch(
      piSubagentInvocationProvider(
        PiSubagentInvocationKey(
          parentSessionPath: parentSessionPath,
          toolCallId: toolCallId,
        ),
      ),
    );
    return scaffold(
      asyncInvocation.when(
        loading: () =>
            Center(child: CircularProgressIndicator(color: theme.info)),
        error: (err, _) => Center(
          child: Text(
            'Failed to load: $err',
            style: TextStyle(color: theme.error),
          ),
        ),
        data: (inv) {
          if (inv == null) {
            return Center(
              child: Text(
                'Invocation not found in parent session',
                style: TextStyle(color: theme.textMuted),
              ),
            );
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: _InvocationBody(
              invocation: inv,
              parentSessionPath: parentSessionPath,
            ),
          );
        },
      ),
    );
  }
}
