import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/claude_code.dart';
import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../screens/claude_code_memory_screen.dart';
import '../../screens/custom_tools_screen.dart';
import '../../screens/plugins_screen.dart';
import '../../screens/subagents_screen.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/claude_code_help.dart';
import 'package:broski/theme/app_icons.dart';

/// Shows the Claude Code tools sheet. Extracted from chat_screen.dart.
///
/// [onShowMemoryScopePicker] is called when the user taps the memory scope
/// picker button (the edit icon next to Memory). Pass the parent screen's
/// `_showMemoryScopePicker` method.
void showCcToolsSheet(
  BuildContext context, {
  required VoidCallback onShowMemoryScopePicker,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Claude Code Tools',
    initialSize: 0.75,
    trailing: Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => showClaudeCodeHelpSheet(
          context,
          topic: ClaudeCodeHelpTopic.toolsOverview,
        ),
        borderRadius: Radii.brXl,
        child: Container(
          padding: Insets.cardXs,
          decoration: BoxDecoration(
            color: theme.textMuted.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Icon(AppIcons.help, color: theme.textMuted, size: 20),
        ),
      ),
    ),
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        final init = chatState.ccInit;
        final configAsync = ref.watch(ccConfigProvider);
        final config =
            configAsync.valueOrNull ??
            ClaudeCodeConfig(
              permissionMode: ClaudeCodePermissionMode.defaultMode,
              allowedTools: init?.tools ?? const [],
              disallowedTools: const [],
              model: init?.model,
            );
        final toolUniverse = <String>{
          ...config.allowedTools,
          ...config.disallowedTools,
          ...?init?.tools,
        }.toList()..sort();
        void updateConfig(ClaudeCodeConfig next) {
          ref.read(ccConfigProvider.notifier).updateConfig(next);
        }

        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Permission mode
                  _buildSettingsRow(
                    theme,
                    'Permission mode',
                    _buildStyledDropdown<ClaudeCodePermissionMode>(
                      theme: theme,
                      value: config.permissionMode,
                      items: ClaudeCodePermissionMode.values
                          .map(
                            (m) => DropdownMenuItem(
                              value: m,
                              child: Text(m.displayName),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value == null) return;
                        updateConfig(config.copyWith(permissionMode: value));
                      },
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  _buildSettingsRow(
                    theme,
                    'Sandbox',
                    Switch.adaptive(
                      value: config.sandbox?.enabled ?? false,
                      onChanged: (enabled) {
                        final sandbox =
                            config.sandbox ?? const ClaudeCodeSandboxSettings();
                        updateConfig(
                          config.copyWith(
                            sandbox: ClaudeCodeSandboxSettings(
                              enabled: enabled,
                              autoAllowBashIfSandboxed:
                                  sandbox.autoAllowBashIfSandboxed,
                              allowUnsandboxedCommands:
                                  sandbox.allowUnsandboxedCommands,
                              network: sandbox.network,
                              ignoreViolations: sandbox.ignoreViolations,
                              enableWeakerNestedSandbox:
                                  sandbox.enableWeakerNestedSandbox,
                              excludedCommands: sandbox.excludedCommands,
                            ),
                          ),
                        );
                      },
                      activeThumbColor: theme.accent,
                    ),
                  ),
                  SizedBox(height: Spacing.lg),
                  // System prompt
                  _buildSettingsRow(
                    theme,
                    'System prompt',
                    _buildStyledDropdown<String>(
                      theme: theme,
                      value: config.systemPrompt?.isEmpty ?? true
                          ? 'none'
                          : config.systemPrompt?.preset != null
                          ? 'preset'
                          : 'custom',
                      items: const [
                        DropdownMenuItem(value: 'none', child: Text('None')),
                        DropdownMenuItem(
                          value: 'preset',
                          child: Text('Claude Code'),
                        ),
                        DropdownMenuItem(
                          value: 'custom',
                          child: Text('Custom...'),
                        ),
                      ],
                      onChanged: (value) async {
                        if (value == null) return;
                        if (value == 'none') {
                          updateConfig(
                            config.copyWith(
                              systemPrompt: const ClaudeCodeSystemPrompt(),
                            ),
                          );
                        } else if (value == 'preset') {
                          updateConfig(
                            config.copyWith(
                              systemPrompt: const ClaudeCodeSystemPrompt(
                                preset: 'claude_code',
                              ),
                            ),
                          );
                        } else if (value == 'custom') {
                          final customText = await _promptSystemPromptText(
                            context,
                          );
                          if (customText != null && customText.isNotEmpty) {
                            updateConfig(
                              config.copyWith(
                                systemPrompt: ClaudeCodeSystemPrompt(
                                  text: customText,
                                ),
                              ),
                            );
                          }
                        }
                      },
                    ),
                  ),
                  SizedBox(height: Spacing.xl),
                  Divider(
                    color: theme.borderSubtle.withValues(alpha: 0.5),
                    height: 1,
                  ),
                  SizedBox(height: Spacing.xl),
                  // Subagent selector
                  _buildSettingsTile(
                    theme: theme,
                    icon: AppIcons.gitBranch,
                    iconColor: theme.info,
                    title: 'Subagents',
                    subtitle: 'Delegate specialized tasks',
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _buildStyledDropdown<String?>(
                          theme: theme,
                          value: config.activeSubagent,
                          hint: 'None',
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('None'),
                            ),
                            ...config.subagents.map(
                              (s) => DropdownMenuItem<String?>(
                                value: s.name,
                                child: Text(s.name),
                              ),
                            ),
                          ],
                          onChanged: (value) {
                            ref
                                .read(ccConfigProvider.notifier)
                                .setActiveSubagent(value);
                          },
                        ),
                        SizedBox(width: Spacing.xs),
                        _buildSettingsIconButton(
                          theme: theme,
                          icon: AppIcons.chevronRight,
                          onTap: () {
                            Navigator.pop(context);
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const SubagentsScreen(),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  _buildSettingsTile(
                    theme: theme,
                    icon: AppIcons.memory,
                    iconColor: theme.accent,
                    title: 'Memory',
                    subtitle: 'Scopes and prompt helpers',
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _buildSettingsIconButton(
                          theme: theme,
                          icon: AppIcons.rateReview,
                          onTap: onShowMemoryScopePicker,
                        ),
                        SizedBox(width: Spacing.xs),
                        _buildSettingsIconButton(
                          theme: theme,
                          icon: AppIcons.chevronRight,
                          onTap: () {
                            Navigator.pop(context);
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const ClaudeCodeMemoryScreen(),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  // Custom Tools section
                  _buildSettingsTile(
                    theme: theme,
                    icon: AppIcons.build,
                    iconColor: theme.warning,
                    title: 'Custom Tools',
                    subtitle: 'mcp__broski-custom-tools__<name>',
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Consumer(
                          builder: (context, ref, _) {
                            final customToolsAsync = ref.watch(
                              ccCustomToolsProvider,
                            );
                            return customToolsAsync.when(
                              data: (tools) {
                                final enabledCount = tools
                                    .where((t) => t.enabled)
                                    .length;
                                return _buildCountBadge(theme, enabledCount);
                              },
                              loading: () => SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  color: theme.textMuted,
                                ),
                              ),
                              error: (_, __) => Icon(
                                AppIcons.error,
                                size: 16,
                                color: theme.error,
                              ),
                            );
                          },
                        ),
                        SizedBox(width: Spacing.sm),
                        _buildSettingsIconButton(
                          theme: theme,
                          icon: AppIcons.chevronRight,
                          onTap: () {
                            Navigator.pop(context);
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const CustomToolsScreen(),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  // Plugins section
                  _buildSettingsTile(
                    theme: theme,
                    icon: AppIcons.extension_,
                    iconColor: theme.success,
                    title: 'Plugins',
                    subtitle: 'Commands, skills, hooks, MCP servers',
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Consumer(
                          builder: (context, ref, _) {
                            final pluginsAsync = ref.watch(ccPluginsProvider);
                            return pluginsAsync.when(
                              data: (plugins) {
                                final enabledCount = plugins
                                    .where(
                                      (p) =>
                                          p.status ==
                                          ClaudeCodePluginStatus.enabled,
                                    )
                                    .length;
                                return _buildCountBadge(theme, enabledCount);
                              },
                              loading: () => SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  color: theme.textMuted,
                                ),
                              ),
                              error: (_, __) => Icon(
                                AppIcons.error,
                                size: 16,
                                color: theme.error,
                              ),
                            );
                          },
                        ),
                        SizedBox(width: Spacing.sm),
                        _buildSettingsIconButton(
                          theme: theme,
                          icon: AppIcons.chevronRight,
                          onTap: () {
                            Navigator.pop(context);
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const PluginsScreen(),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: Spacing.xl),
                  Divider(
                    color: theme.borderSubtle.withValues(alpha: 0.5),
                    height: 1,
                  ),
                  SizedBox(height: Spacing.lg),
                  // Tools list header
                  Row(
                    children: [
                      Icon(
                        AppIcons.construction,
                        size: 16,
                        color: theme.textMuted,
                      ),
                      SizedBox(width: Spacing.sm),
                      Text(
                        'Built-in Tools',
                        style: TextStyle(
                          color: theme.text,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${toolUniverse.length} tools',
                        style: TextStyle(color: theme.textMuted, fontSize: 12),
                      ),
                    ],
                  ),
                  SizedBox(height: Spacing.md),
                  // Tools list
                  ...toolUniverse.map((tool) {
                    final enabled = !config.disallowedTools.contains(tool);
                    return _buildToolToggleRow(
                      theme: theme,
                      tool: tool,
                      enabled: enabled,
                      onChanged: (v) {
                        final allowed = [...config.allowedTools];
                        final disallowed = [...config.disallowedTools];
                        if (v) {
                          disallowed.remove(tool);
                          if (!allowed.contains(tool)) {
                            allowed.add(tool);
                          }
                        } else {
                          allowed.remove(tool);
                          if (!disallowed.contains(tool)) {
                            disallowed.add(tool);
                          }
                        }
                        updateConfig(
                          config.copyWith(
                            allowedTools: allowed,
                            disallowedTools: disallowed,
                          ),
                        );
                      },
                    );
                  }),
                ],
              ),
            ),
          ],
        );
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Helper widgets — extracted from _ChatScreenState
// ---------------------------------------------------------------------------

Widget _buildSettingsRow(OpenCodeTheme theme, String label, Widget child) {
  return Row(
    children: [
      Text(
        label,
        style: TextStyle(
          color: theme.text,
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
      ),
      const Spacer(),
      child,
    ],
  );
}

Widget _buildSettingsTile({
  required OpenCodeTheme theme,
  required IconData icon,
  required Color iconColor,
  required String title,
  required String subtitle,
  required Widget trailing,
}) {
  return Container(
    padding: Insets.cardSm,
    decoration: BoxDecoration(
      color: theme.background.withValues(alpha: 0.5),
      borderRadius: Radii.brMd,
      border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.3)),
    ),
    child: Row(
      children: [
        Container(
          padding: Insets.cardXs,
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.12),
            borderRadius: Radii.brSm,
          ),
          child: Icon(icon, size: 18, color: iconColor),
        ),
        SizedBox(width: Spacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: theme.text,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              SizedBox(height: Spacing.xxs),
              Text(
                subtitle,
                style: AppTypography.caption(color: theme.textMuted),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        trailing,
      ],
    ),
  );
}

Widget _buildStyledDropdown<T>({
  required OpenCodeTheme theme,
  required T? value,
  required List<DropdownMenuItem<T>> items,
  required ValueChanged<T?> onChanged,
  String? hint,
}) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    decoration: BoxDecoration(
      color: theme.background.withValues(alpha: 0.5),
      borderRadius: Radii.brSm,
      border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.3)),
    ),
    child: DropdownButtonHideUnderline(
      child: DropdownButton<T>(
        value: value,
        dropdownColor: theme.backgroundPanel,
        style: AppTypography.bodySmall(color: theme.text),
        hint: hint != null
            ? Text(hint, style: AppTypography.bodySmall(color: theme.textMuted))
            : null,
        icon: Icon(AppIcons.chevronDown, size: 18, color: theme.textMuted),
        items: items,
        onChanged: onChanged,
        isDense: true,
      ),
    ),
  );
}

Widget _buildSettingsIconButton({
  required OpenCodeTheme theme,
  required IconData icon,
  required VoidCallback onTap,
}) {
  return Material(
    color: Colors.transparent,
    child: InkWell(
      onTap: onTap,
      borderRadius: Radii.brSm,
      child: Container(
        padding: const EdgeInsets.all(4),
        child: Icon(icon, size: 20, color: theme.textMuted),
      ),
    ),
  );
}

Widget _buildCountBadge(OpenCodeTheme theme, int count) {
  final isActive = count > 0;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: isActive
          ? theme.accent.withValues(alpha: 0.15)
          : theme.textMuted.withValues(alpha: 0.1),
      borderRadius: Radii.brSm,
    ),
    child: Text(
      '$count enabled',
      style: TextStyle(
        color: isActive ? theme.accent : theme.textMuted,
        fontSize: 11,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

Widget _buildToolToggleRow({
  required OpenCodeTheme theme,
  required String tool,
  required bool enabled,
  required ValueChanged<bool> onChanged,
}) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Row(
      children: [
        Expanded(
          child: Text(
            tool,
            style: TextStyle(
              color: enabled ? theme.text : theme.textMuted,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        Transform.scale(
          scale: 0.8,
          child: Switch.adaptive(
            value: enabled,
            onChanged: onChanged,
            activeThumbColor: theme.accent,
            activeTrackColor: theme.accent.withValues(alpha: 0.3),
            inactiveThumbColor: theme.textMuted.withValues(alpha: 0.6),
            inactiveTrackColor: theme.textMuted.withValues(alpha: 0.2),
          ),
        ),
      ],
    ),
  );
}

Future<String?> _promptSystemPromptText(BuildContext context) async {
  final theme = OpenCodeTheme.of(context);
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: theme.backgroundPanel,
      title: Text('Custom System Prompt', style: TextStyle(color: theme.text)),
      content: SizedBox(
        width: double.maxFinite,
        child: TextField(
          controller: controller,
          maxLines: 5,
          style: AppTypography.labelLarge(color: theme.text),
          decoration: InputDecoration(
            hintText: 'Enter custom instructions for Claude...',
            hintStyle: TextStyle(color: theme.textMuted),
            filled: true,
            fillColor: theme.background,
            border: OutlineInputBorder(
              borderRadius: Radii.brSm,
              borderSide: BorderSide(color: theme.borderSubtle),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: Radii.brSm,
              borderSide: BorderSide(color: theme.borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: Radii.brSm,
              borderSide: BorderSide(color: theme.primary),
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, controller.text.trim()),
          child: Text('Save', style: TextStyle(color: theme.primary)),
        ),
      ],
    ),
  );
}
