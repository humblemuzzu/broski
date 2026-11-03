import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/notice_card.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/screens/agent/panels/toggle_row.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart' show SectionHeader;
import 'package:flutter/material.dart';

/// The tools a session has, a switch for each, listed by the group the
/// result names for them.
class SessionToolsView extends StatelessWidget {
  const SessionToolsView({
    super.key,
    required this.result,
    required this.actions,
  });

  final SessionToolsResult result;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) {
    final active = result.tools.where((tool) => tool.active).length;
    final groups = <String, List<SessionTool>>{};
    for (final tool in result.tools) {
      groups.putIfAbsent(tool.group ?? 'Other', () => []).add(tool);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Summary(active: active, total: result.tools.length),
        for (final MapEntry(key: group, value: tools) in groups.entries)
          _Group(
            group: group,
            tools: tools,
            actions: actions,
            onSet: _setActive,
          ),
        if (result.omitted case final omitted?) _OmittedNote(count: omitted),
      ],
    );
  }

  void _setActive(SessionTool tool, bool active) => actions.call(
    (target) => opCall(
      target.session,
      SessionToolsOp(
        sessionId: target.session.sessionId,
        change: ToolChange(name: tool.name, active: active),
      ),
    ),
  );
}

class _Summary extends StatelessWidget {
  const _Summary({required this.active, required this.total});

  final int active;
  final int total;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomMd,
      child: Row(
        children: [
          Icon(AppIcons.tools, size: 14, color: theme.textMuted),
          const SizedBox(width: Spacing.sm),
          Text(
            '$active of $total tools on',
            style: AppTypography.label(color: theme.textMuted),
          ),
        ],
      ),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({
    required this.group,
    required this.tools,
    required this.actions,
    required this.onSet,
  });

  final String group;
  final List<SessionTool> tools;
  final ResultActions actions;
  final void Function(SessionTool tool, bool active) onSet;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: Insets.bottomSm,
          child: SectionHeader(title: group, theme: theme),
        ),
        for (final tool in tools)
          Padding(
            padding: Insets.bottomMd,
            child: ToggleRow(
              key: ValueKey('tool:${tool.name}'),
              title: tool.name,
              monoTitle: true,
              description: tool.description,
              value: tool.active,
              onChanged: actions.busy ? null : (on) => onSet(tool, on),
            ),
          ),
      ],
    );
  }
}

class _OmittedNote extends StatelessWidget {
  const _OmittedNote({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => NoticeCard(
    key: const ValueKey('tools-omitted'),
    icon: AppIcons.warning,
    color: OpenCodeTheme.of(context).warning,
    text: '$count more tools are not listed.',
  );
}
