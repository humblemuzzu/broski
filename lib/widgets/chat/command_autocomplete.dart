import 'package:flutter/material.dart';

import '../../models/command.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../command_source_badge.dart';

/// Slash command autocomplete popup with grouping. Extracted from chat_screen.dart.
class CommandAutocomplete extends StatelessWidget {
  const CommandAutocomplete({
    super.key,
    required this.commands,
    required this.onSelect,
  });
  final List<SlashCommand> commands;
  final void Function(SlashCommand) onSelect;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final kBorder = theme.borderSubtle;
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;
    final kAccent = theme.primary;
    final kSuccess = theme.success;
    final kInfo = theme.info;
    if (commands.isEmpty) {
      return const SizedBox.shrink();
    }
    // Group commands by source (command / mcp / skill)
    final groups = CommandGroups.fromCommands(commands);
    return Container(
      constraints: const BoxConstraints(maxHeight: 280),
      decoration: BoxDecoration(
        color: kCard,
        borderRadius: Radii.brLg,
        border: Border.all(color: kBorder),
        boxShadow: [
          BoxShadow(
            color: theme.bgDeep.withValues(alpha: 0.4),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: Radii.brLg,
        child: ListView(
          shrinkWrap: true,
          padding: Insets.chipV,
          children: [
            // Commands section (built-in / source == 'command')
            if (groups.commands.isNotEmpty) ...[
              _buildSectionHeader(
                'Commands',
                AppIcons.terminal,
                kAccent,
                kMuted,
                groups.commands.length,
              ),
              ...groups.commands.map(
                (cmd) => _buildCommandTile(
                  cmd,
                  kOnBackground,
                  kMuted,
                  kAccent,
                  kSuccess,
                  kInfo,
                ),
              ),
            ],
            // Skills section
            if (groups.skillCommands.isNotEmpty) ...[
              if (groups.commands.isNotEmpty) SizedBox(height: Spacing.sm),
              _buildSectionHeader(
                'Skills',
                AppIcons.autoAwesome,
                kInfo,
                kMuted,
                groups.skillCommands.length,
              ),
              ...groups.skillCommands.map(
                (cmd) => _buildCommandTile(
                  cmd,
                  kOnBackground,
                  kMuted,
                  kInfo,
                  kSuccess,
                  kInfo,
                ),
              ),
            ],
            // MCP commands section
            if (groups.mcpCommands.isNotEmpty) ...[
              if (groups.commands.isNotEmpty || groups.skillCommands.isNotEmpty)
                SizedBox(height: Spacing.sm),
              _buildSectionHeader(
                'MCP',
                AppIcons.extension_,
                kSuccess,
                kMuted,
                groups.mcpCommands.length,
              ),
              ...groups.mcpCommands.map(
                (cmd) => _buildCommandTile(
                  cmd,
                  kOnBackground,
                  kMuted,
                  kSuccess,
                  kSuccess,
                  kInfo,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(
    String title,
    IconData icon,
    Color iconColor,
    Color textColor,
    int count,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 14, color: iconColor),
          const SizedBox(width: 6),
          Text(
            title,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: textColor,
              letterSpacing: 0.5,
            ),
          ),
          SizedBox(width: Spacing.xs),
          Text(
            '($count)',
            style: TextStyle(
              fontSize: 11,
              color: textColor.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCommandTile(
    SlashCommand command,
    Color textColor,
    Color mutedColor,
    Color accentColor,
    Color agentColor,
    Color modelColor,
  ) {
    return InkWell(
      onTap: () => onSelect(command),
      child: Container(
        padding: Insets.buttonSm,
        child: Row(
          children: [
            // Command icon
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.15),
                borderRadius: Radii.brSm,
              ),
              child: Icon(
                command.source == CommandSource.mcp
                    ? AppIcons.extension_
                    : command.source == CommandSource.skill
                    ? AppIcons.autoAwesome
                    : AppIcons.terminal,
                size: 16,
                color: accentColor,
              ),
            ),
            SizedBox(width: Spacing.md),
            // Command name and description
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        command.displayName,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: textColor,
                        ),
                      ),
                      // Agent badge
                      if (command.hasAgent) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: agentColor.withValues(alpha: 0.15),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            '@${command.agent}',
                            style: TextStyle(
                              fontSize: 9,
                              color: agentColor,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                      // Model badge
                      if (command.hasModel) ...[
                        SizedBox(width: Spacing.xs),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: modelColor.withValues(alpha: 0.15),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            command.shortModelName ?? '',
                            style: TextStyle(
                              fontSize: 9,
                              color: modelColor,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                      // Source badge (MCP / SKILL)
                      if (command.source != null &&
                          command.source != CommandSource.command) ...[
                        SizedBox(width: Spacing.xs),
                        CommandSourceBadge(source: command.source),
                      ],
                      // Subtask badge
                      if (command.subtask) ...[
                        SizedBox(width: Spacing.xs),
                        Icon(
                          AppIcons.subdirectory,
                          size: 12,
                          color: mutedColor,
                        ),
                      ],
                    ],
                  ),
                  SizedBox(height: Spacing.xxs),
                  Text(
                    command.shortDescription,
                    style: TextStyle(fontSize: 12, color: mutedColor),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
