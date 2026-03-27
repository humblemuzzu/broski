import 'package:flutter/material.dart';

import '../../models/agent.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the agents selection sheet. Extracted from chat_screen.dart.
///
/// [agents] is the list of available agents.
/// [selectedAgent] is the currently selected agent name (nullable).
/// [onAgentSelected] is called when the user picks a new agent.
void showAgentsDialog(
  BuildContext context, {
  required List<Agent> agents,
  required String? selectedAgent,
  required ValueChanged<String> onAgentSelected,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Available Agents',
    initialSize: 0.4,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(height: Spacing.sm),
        if (agents.isEmpty)
          Padding(
            padding: Insets.card,
            child: Text(
              'No agents available',
              style: TextStyle(color: theme.textMuted),
            ),
          )
        else
          ...List.generate(agents.length, (index) {
            final agent = agents[index];
            final isSelected = selectedAgent == agent.name;
            return ListTile(
              leading: CircleAvatar(
                backgroundColor: isSelected ? theme.primary : theme.bgDeep,
                child: Icon(
                  AppIcons.agent,
                  color: isSelected
                      ? theme.selectedListItemText
                      : theme.textMuted,
                  size: 20,
                ),
              ),
              title: Text(
                agent.name,
                style: TextStyle(
                  color: theme.text,
                  fontWeight:
                      isSelected ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
              subtitle: agent.description != null
                  ? Text(
                      agent.description!,
                      style: AppTypography.label(color: theme.textMuted),
                    )
                  : null,
              trailing: isSelected
                  ? Icon(AppIcons.checkCircle, color: theme.primary)
                  : null,
              onTap: () {
                onAgentSelected(agent.name);
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Selected ${agent.name} agent')),
                );
              },
            );
          }),
        SizedBox(height: Spacing.sm),
      ],
    ),
  );
}
