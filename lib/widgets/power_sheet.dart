import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/permission_rule.dart';
import '../models/project.dart';
import '../providers/claude_code_provider.dart';
import '../providers/codex_settings_provider.dart';
import '../providers/permission_rules_provider.dart';
import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';
import 'permission_rules_sheet.dart';
import 'project_tools_sheet.dart';

/// Unified Power Sheet for all AI backends (OpenCode, Claude Code, Codex).
/// Opens from the left menu button in ChatGPT style or agent selector in CLI style.
class PowerSheet extends ConsumerStatefulWidget {
  const PowerSheet({
    required this.backend,
    required this.project,
    super.key,
    // Attach actions
    this.onAttachFile,
    this.onTakePhoto,
    // Model selection
    this.currentModel,
    this.onModelTap,
    // Thinking level / variants
    this.currentVariant,
    this.availableVariants = const [],
    this.onVariantChanged,
    // OpenCode specific
    this.agents = const [],
    this.currentAgent,
    this.onAgentChanged,
    // Claude Code specific
    this.ccPermissionMode,
    this.onCCPermissionModeChanged,
    // Codex specific
    this.codexCollabMode,
    this.onCodexCollabModeChanged,
  });

  final AgentType backend;
  final ProjectSummary project;

  // Attach actions
  final VoidCallback? onAttachFile;
  final VoidCallback? onTakePhoto;

  // Model selection
  final String? currentModel;
  final VoidCallback? onModelTap;

  // Thinking level / variants
  final String? currentVariant;
  final List<String> availableVariants;
  final void Function(String?)? onVariantChanged;

  // OpenCode specific
  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?)? onAgentChanged;

  // Claude Code specific
  final ClaudeCodePermissionMode? ccPermissionMode;
  final void Function(ClaudeCodePermissionMode)? onCCPermissionModeChanged;

  // Codex specific
  final CodexCollaborationMode? codexCollabMode;
  final void Function(CodexCollaborationMode)? onCodexCollabModeChanged;

  @override
  ConsumerState<PowerSheet> createState() => _PowerSheetState();
}

class _PowerSheetState extends ConsumerState<PowerSheet> {
  void _openProjectTools() {
    Navigator.pop(context);
    Future.delayed(const Duration(milliseconds: 150), () {
      if (!mounted) return;
      showProjectToolsSheet(
        context: context,
        backend: widget.backend,
        project: widget.project,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final rulesState = ref.watch(permissionRulesProvider);

    // Filter agents to only show native agents (build and plan)
    final nativeAgents = widget.agents
        .where((a) => a.name == 'build' || a.name == 'plan')
        .toList();

    return DetailSheet(
      title: 'Power Menu',
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ===== ATTACH SECTION =====
            _SectionHeader(title: 'Attach', theme: theme),
            const SizedBox(height: 12),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: _QuickActionCard(
                      icon: Icons.attach_file_rounded,
                      label: 'Attach File',
                      theme: theme,
                      onTap: () {
                        Navigator.pop(context);
                        widget.onAttachFile?.call();
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _QuickActionCard(
                      icon: Icons.camera_alt_outlined,
                      label: 'Take Photo',
                      theme: theme,
                      onTap: () {
                        Navigator.pop(context);
                        widget.onTakePhoto?.call();
                      },
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // ===== MODEL SECTION =====
            if (widget.onModelTap != null) ...[
              _SectionHeader(title: 'Model', theme: theme),
              const SizedBox(height: 12),
              _ModelCard(
                model: widget.currentModel,
                theme: theme,
                onTap: () {
                  Navigator.pop(context);
                  widget.onModelTap?.call();
                },
              ),
              const SizedBox(height: 28),
            ],

            // ===== THINKING LEVEL SECTION =====
            if (widget.availableVariants.isNotEmpty) ...[
              _SectionHeader(title: _getThinkingLevelTitle(), theme: theme),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _VariantChip(
                    label: 'Default',
                    isSelected: widget.currentVariant == null,
                    theme: theme,
                    onTap: () {
                      widget.onVariantChanged?.call(null);
                      Navigator.pop(context);
                    },
                  ),
                  ...widget.availableVariants.map(
                    (v) => _VariantChip(
                      label: _formatVariantLabel(v),
                      isSelected: widget.currentVariant == v,
                      theme: theme,
                      onTap: () {
                        widget.onVariantChanged?.call(v);
                        Navigator.pop(context);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),
            ],

            // ===== OPENCODE: AGENT SECTION =====
            // Only show native agents (build/plan) - custom agents are @-tagged
            if (widget.backend == AgentType.opencode &&
                nativeAgents.isNotEmpty) ...[
              _SectionHeader(title: 'Agent', theme: theme),
              const SizedBox(height: 12),
              _buildOpenCodeAgents(theme, nativeAgents),
              const SizedBox(height: 28),
            ],

            // ===== CLAUDE CODE: PERMISSION MODE SECTION =====
            if (widget.backend == AgentType.claudeCode) ...[
              _SectionHeader(title: 'Permission Mode', theme: theme),
              const SizedBox(height: 12),
              _buildClaudeCodePermissionModes(theme),
              const SizedBox(height: 28),
            ],

            // ===== CODEX: COLLABORATION MODE SECTION =====
            if (widget.backend == AgentType.codex) ...[
              _SectionHeader(title: 'Collaboration Mode', theme: theme),
              const SizedBox(height: 12),
              _buildCodexCollabModes(theme),
              const SizedBox(height: 28),
            ],

            // ===== PERMISSIONS SECTION (all backends) =====
            _SectionHeader(
              title: 'Permissions',
              theme: theme,
              trailing: GestureDetector(
                onTap: () {
                  final rootContext = Navigator.of(
                    context,
                    rootNavigator: true,
                  ).context;
                  Navigator.pop(context);
                  showPermissionRulesSheet(
                    context: rootContext,
                    backend: widget.backend,
                    initialRules: widget.backend == AgentType.opencode
                        ? rulesState.effectiveRuleset
                        : null,
                    onApply: widget.backend == AgentType.opencode
                        ? (rules) {
                            ref
                                .read(permissionRulesProvider.notifier)
                                .setCustomRules(rules);
                          }
                        : null,
                  );
                },
                child: Text(
                  'Custom',
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.primary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (widget.backend == AgentType.opencode) ...[
              _buildOpenCodePermissionPresets(theme, rulesState),
              const SizedBox(height: 28),
            ] else ...[
              _PermissionSummaryCard(backend: widget.backend, theme: theme),
              const SizedBox(height: 28),
            ],

            // ===== PROJECT TOOLS BUTTON =====
            _ProjectToolsButton(
              theme: theme,
              backend: widget.backend,
              onTap: _openProjectTools,
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  String _getThinkingLevelTitle() {
    switch (widget.backend) {
      case AgentType.claudeCode:
        return 'Thinking Budget';
      case AgentType.codex:
        return 'Reasoning Effort';
      case AgentType.opencode:
        return 'Thinking Level';
    }
  }

  String _formatVariantLabel(String v) {
    if (v.isEmpty) return 'Default';

    // Claude Code thinking levels (token budgets)
    if (widget.backend == AgentType.claudeCode) {
      switch (v.toLowerCase()) {
        case 'low':
          return 'Low (4K)';
        case 'medium':
          return 'Medium (16K)';
        case 'high':
          return 'High (64K)';
        case 'max':
          return 'Max';
        default:
          return v[0].toUpperCase() + v.substring(1);
      }
    }

    // Codex reasoning effort levels
    if (widget.backend == AgentType.codex) {
      switch (v.toLowerCase()) {
        case 'none':
          return 'None';
        case 'minimal':
          return 'Minimal';
        case 'low':
          return 'Low';
        case 'medium':
          return 'Medium';
        case 'high':
          return 'High';
        case 'xhigh':
          return 'Extra High';
        default:
          return v[0].toUpperCase() + v.substring(1);
      }
    }

    // OpenCode: Just capitalize
    return v[0].toUpperCase() + v.substring(1);
  }

  Widget _buildOpenCodeAgents(OpenCodeTheme theme, List<Agent> agents) {
    // Only show native agents (build/plan) passed to this method
    // Custom agents are accessed via @-mention in the chat input
    if (agents.isEmpty) return const SizedBox.shrink();

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: agents.map((agent) {
          final isSelected = agent.name == widget.currentAgent;
          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: agent == agents.last ? 0 : 10),
              child: _AgentCard(
                name: agent.displayName,
                description: agent.name == 'build' ? 'Development' : 'Analysis',
                isSelected: isSelected,
                theme: theme,
                onTap: () {
                  widget.onAgentChanged?.call(agent.name);
                  Navigator.pop(context);
                },
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildClaudeCodePermissionModes(OpenCodeTheme theme) {
    return Column(
      children: ClaudeCodePermissionMode.values.map((mode) {
        final isSelected = widget.ccPermissionMode == mode;
        return _PermissionModeCard(
          title: mode.displayName,
          description: _getPermissionModeDescription(mode),
          isSelected: isSelected,
          theme: theme,
          onTap: () {
            widget.onCCPermissionModeChanged?.call(mode);
            Navigator.pop(context);
          },
        );
      }).toList(),
    );
  }

  String _getPermissionModeDescription(ClaudeCodePermissionMode mode) {
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return 'Ask before making changes';
      case ClaudeCodePermissionMode.acceptEdits:
        return 'Auto-accept file edits';
      case ClaudeCodePermissionMode.plan:
        return 'Research and plan only';
      case ClaudeCodePermissionMode.bypassPermissions:
        return 'Skip all permission prompts';
    }
  }

  Widget _buildCodexCollabModes(OpenCodeTheme theme) {
    final modes = CodexCollaborationMode.values;
    return SizedBox(
      height: 56,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: modes.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final mode = modes[index];
          final isSelected = widget.codexCollabMode == mode;
          return SizedBox(
            width: 120,
            child: _CollabModeCard(
              mode: mode,
              isSelected: isSelected,
              theme: theme,
              onTap: () {
                widget.onCodexCollabModeChanged?.call(mode);
                Navigator.pop(context);
              },
            ),
          );
        },
      ),
    );
  }

  Widget _buildOpenCodePermissionPresets(
    OpenCodeTheme theme,
    PermissionRulesState rulesState,
  ) {
    // Show first 3 presets (excluding custom)
    final presets = PermissionPreset.values
        .where((p) => p != PermissionPreset.custom)
        .take(3)
        .toList();

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: presets.map((preset) {
          final isSelected = rulesState.preset == preset;
          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: preset == presets.last ? 0 : 8),
              child: _PresetCard(
                name: preset.shortName,
                isSelected: isSelected,
                theme: theme,
                onTap: () {
                  ref.read(permissionRulesProvider.notifier).setPreset(preset);
                  Navigator.pop(context);
                },
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ============================================================================
// HELPER WIDGETS
// ============================================================================

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.theme,
    this.trailing,
  });

  final String title;
  final OpenCodeTheme theme;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: theme.textMuted.withValues(alpha: 0.7),
          ),
        ),
        if (trailing != null) ...[const Spacer(), trailing!],
      ],
    );
  }
}

class _QuickActionCard extends StatelessWidget {
  const _QuickActionCard({
    required this.icon,
    required this.label,
    required this.theme,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Column(
          children: [
            Icon(icon, color: theme.text, size: 22),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: theme.text,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModelCard extends StatelessWidget {
  const _ModelCard({
    required this.model,
    required this.theme,
    required this.onTap,
  });

  final String? model;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  String _formatModel(String? m) {
    if (m == null || m.isEmpty) return 'Select Model';
    // Shorten common model names
    if (m.contains('claude')) {
      if (m.contains('sonnet')) return 'Claude Sonnet';
      if (m.contains('opus')) return 'Claude Opus';
      if (m.contains('haiku')) return 'Claude Haiku';
    }
    if (m.contains('gpt-4')) return 'GPT-4';
    if (m.contains('gpt-5')) return 'GPT-5';
    if (m.contains('o1')) return 'o1';
    if (m.contains('o3')) return 'o3';
    if (m.length > 25) return '${m.substring(0, 22)}...';
    return m;
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _formatModel(model),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: theme.text,
                ),
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: theme.textMuted),
          ],
        ),
      ),
    );
  }
}

class _VariantChip extends StatelessWidget {
  const _VariantChip({
    required this.label,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.08)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
            color: isSelected ? theme.primary : theme.text,
          ),
        ),
      ),
    );
  }
}

class _AgentCard extends StatelessWidget {
  const _AgentCard({
    required this.name,
    required this.description,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final String name;
  final String description;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 14),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.08)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              name,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: isSelected ? theme.primary : theme.text,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              description,
              style: TextStyle(fontSize: 11, color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _PermissionModeCard extends StatelessWidget {
  const _PermissionModeCard({
    required this.title,
    required this.description,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final String title;
  final String description;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: isSelected
                ? theme.primary.withValues(alpha: 0.08)
                : theme.backgroundPanel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? theme.primary : theme.borderSubtle,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? theme.primary : theme.text,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      style: TextStyle(fontSize: 12, color: theme.textMuted),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(Icons.check_rounded, size: 18, color: theme.primary),
            ],
          ),
        ),
      ),
    );
  }
}

class _CollabModeCard extends StatelessWidget {
  const _CollabModeCard({
    required this.mode,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final CodexCollaborationMode mode;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.08)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              mode.displayName,
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                color: isSelected ? theme.primary : theme.text,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _PresetCard extends StatelessWidget {
  const _PresetCard({
    required this.name,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final String name;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.1)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Center(
          child: Text(
            name,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
              color: isSelected ? theme.primary : theme.text,
            ),
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}

class _ProjectToolsButton extends StatelessWidget {
  const _ProjectToolsButton({
    required this.theme,
    required this.backend,
    required this.onTap,
  });

  final OpenCodeTheme theme;
  final AgentType backend;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Project Tools',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: theme.text,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _getToolsDescription(),
                    style: TextStyle(fontSize: 12, color: theme.textMuted),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: theme.textMuted),
          ],
        ),
      ),
    );
  }

  String _getToolsDescription() {
    switch (backend) {
      case AgentType.opencode:
        return 'Skills, Commands, MCP, Plugins';
      case AgentType.claudeCode:
        return 'Skills, Hooks, MCP, Plugins';
      case AgentType.codex:
        return 'Skills, Agents, MCP';
    }
  }
}

/// A brief summary card shown in the Power Menu for Claude Code / Codex
/// permissions. Tapping "Custom" opens the full sheet; this just shows
/// the current active mode at a glance.
class _PermissionSummaryCard extends ConsumerWidget {
  const _PermissionSummaryCard({required this.backend, required this.theme});

  final AgentType backend;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String label;
    final String value;
    final IconData icon;

    if (backend == AgentType.claudeCode) {
      final config = ref.watch(ccConfigProvider).valueOrNull;
      final mode =
          config?.permissionMode ?? ClaudeCodePermissionMode.defaultMode;
      label = 'Mode';
      value = mode.displayName;
      icon = Icons.shield_outlined;
    } else {
      // Codex
      final settings = ref.watch(codexSettingsProvider);
      label = 'Approval';
      value = _formatCodexPolicy(settings.approvalPolicy);
      icon = Icons.verified_user_outlined;
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(icon, color: theme.textMuted, size: 18),
          const SizedBox(width: 10),
          Text(
            '$label: ',
            style: TextStyle(
              fontSize: 13,
              color: theme.textMuted,
              fontWeight: FontWeight.w500,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              color: theme.text,
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          Icon(Icons.chevron_right_rounded, size: 18, color: theme.textMuted),
        ],
      ),
    );
  }

  String _formatCodexPolicy(CodexApprovalPolicy policy) {
    switch (policy) {
      case CodexApprovalPolicy.unlessTrusted:
        return 'Unless Trusted';
      case CodexApprovalPolicy.onFailure:
        return 'On Failure';
      case CodexApprovalPolicy.onRequest:
        return 'On Request';
      case CodexApprovalPolicy.never:
        return 'Never';
    }
  }
}
