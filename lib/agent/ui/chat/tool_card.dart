import 'dart:convert';

import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/chat/attachment_view.dart';
import 'package:broski/agent/ui/chat/entry_views.dart';
import 'package:broski/agent/ui/chat/file_change_view.dart';
import 'package:broski/agent/ui/chat/timeline_entry.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One tool call: its state at a glance, and when opened its input, output,
/// file changes, result and the subagent work nested in it.
class ToolCard extends StatefulWidget {
  const ToolCard({super.key, required this.session, required this.entry});

  final SessionRef session;
  final ToolEntry entry;

  @override
  State<ToolCard> createState() => _ToolCardState();
}

class _ToolCardState extends State<ToolCard> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final entry = widget.entry;
    return Container(
      margin: Insets.bottomSm,
      decoration: BoxDecoration(
        border: Border.all(color: theme.borderSubtle),
        borderRadius: Radii.brMd,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            child: _ToolHeader(entry: entry, open: _open),
          ),
          if (_open) _ToolDetails(session: widget.session, entry: entry),
          if (entry.nested.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(Spacing.lg, 0, Spacing.sm, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final nested in entry.nested)
                    _nestedView(widget.session, nested),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A subagent's work inside the call that runs it: its own calls and blocks.
Widget _nestedView(SessionRef session, TimelineEntry nested) =>
    switch (nested) {
      ToolEntry() => ToolCard(session: session, entry: nested),
      BlockEntry() => BlockView(entry: nested),
      UserEntry() ||
      PendingPromptEntry() ||
      MarkerEntry() ||
      ActivityEntry() ||
      DroppedEntry() => const SizedBox.shrink(),
    };

class _ToolHeader extends StatelessWidget {
  const _ToolHeader({required this.entry, required this.open});

  final ToolEntry entry;
  final bool open;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final progress = entry.running?.progress;
    return Padding(
      padding: Insets.cardSm,
      child: Row(
        children: [
          _ToolState(entry: entry),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              [entry.title ?? _name(entry), ?progress].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.label(color: theme.text),
            ),
          ),
          Icon(open ? AppIcons.chevronUp : AppIcons.chevronDown, size: 16),
        ],
      ),
    );
  }
}

String _name(ToolEntry entry) => entry.name.isEmpty ? 'Tool' : entry.name;

class _ToolState extends StatelessWidget {
  const _ToolState({required this.entry});

  final ToolEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final result = entry.result;
    if (result == null) {
      return const SizedBox.square(
        dimension: 12,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          semanticsLabel: 'The tool is running',
        ),
      );
    }
    final (icon, color) = switch (result.outcome) {
      ToolOutcome.completed => (AppIcons.checkCircle, theme.success),
      ToolOutcome.failed => (AppIcons.error, theme.error),
      ToolOutcome.denied => (AppIcons.block, theme.warning),
      ToolOutcome.aborted => (AppIcons.cancel, theme.textMuted),
    };
    return Icon(icon, size: 14, color: color);
  }
}

class _ToolDetails extends StatelessWidget {
  const _ToolDetails({required this.session, required this.entry});

  final SessionRef session;
  final ToolEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final running = entry.running;
    final result = entry.result?.result;
    final changes = result?.fileChanges ?? running?.fileChanges ?? const [];
    final mono = AppTypography.codeSmall(color: theme.text);
    return Padding(
      padding: Insets.cardSm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.input case final input?)
            SelectableText(
              const JsonEncoder.withIndent('  ').convert(input.toJson()),
              style: mono,
            ),
          if (running != null && running.output.isNotEmpty)
            SelectableText(running.output, style: mono),
          for (final change in changes) FileChangeView(change: change),
          if (result != null)
            for (final content in result.content)
              switch (content) {
                TextContent(:final text) => SelectableText(text, style: mono),
                final AttachmentRef attachment => AttachmentView(
                  session: session,
                  attachment: attachment,
                ),
              },
          if (result?.error case final error?)
            Text(error, style: AppTypography.bodySmall(color: theme.error)),
          if (result?.exitCode case final code?)
            Text('Exit code $code', style: AppTypography.caption()),
          if (entry.childSession case final child?)
            TextButton.icon(
              icon: const Icon(AppIcons.agent, size: 16),
              label: const Text('Open the subagent session'),
              onPressed: () => openSession(context, child),
            ),
        ],
      ),
    );
  }
}
