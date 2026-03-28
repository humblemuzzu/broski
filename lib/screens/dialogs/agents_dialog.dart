import 'package:broski/models/agent.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';

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
        const SizedBox(height: Spacing.sm),
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
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
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
                showInfo(context, 'Selected ${agent.name} agent');
              },
            );
          }),
        const SizedBox(height: Spacing.sm),
      ],
    ),
  );
}
