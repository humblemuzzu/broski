import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
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
    final theme = OpenCodeTheme.of(context);
    final active = result.tools.where((tool) => tool.active).length;
    final groups = <String, List<SessionTool>>{};
    for (final tool in result.tools) {
      groups.putIfAbsent(tool.group ?? 'Other', () => []).add(tool);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: Insets.screenH,
          child: Text(
            '$active of ${result.tools.length} tools on',
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
        ),
        for (final MapEntry(key: group, value: tools) in groups.entries) ...[
          Padding(
            padding: Insets.section,
            child: Text(group, style: AppTypography.labelLarge()),
          ),
          for (final tool in tools)
            SwitchListTile(
              key: ValueKey('tool:${tool.name}'),
              title: Text(tool.name),
              subtitle: Text(
                tool.description,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              value: tool.active,
              onChanged: actions.busy
                  ? null
                  : (on) => actions.call(
                      (sessionId) => opCall(
                        SessionToolsOp(
                          sessionId: sessionId,
                          change: ToolChange(name: tool.name, active: on),
                        ),
                      ),
                    ),
            ),
        ],
        if (result.omitted case final omitted?)
          Padding(
            key: const ValueKey('tools-omitted'),
            padding: Insets.section,
            child: Text(
              '$omitted more tools are not listed.',
              style: AppTypography.bodySmall(color: theme.warning),
            ),
          ),
      ],
    );
  }
}
