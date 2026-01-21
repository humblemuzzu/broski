import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/permission_rule.dart';
import '../models/project.dart';
import '../providers/permission_rules_provider.dart';
import '../theme/opencode_theme.dart';
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
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) =>
            ProjectToolsSheet(backend: widget.backend, project: widget.project),
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

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.75,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: theme.background,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header with close button
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 12, 0),
                child: Row(
                  children: [
                    // Handle bar
                    Expanded(
                      child: Center(
                        child: Container(
                          width: 36,
                          height: 4,
                          decoration: BoxDecoration(
                            color: theme.borderSubtle,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                    ),
                    // Close button
                    GestureDetector(
                      onTap: () => Navigator.pop(context),
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        child: Icon(
                          Icons.close_rounded,
                          color: theme.textMuted,
                          size: 22,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // Scrollable content
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // ===== ATTACH SECTION =====
                      _SectionHeader(
                        icon: Icons.add_circle_outline_rounded,
                        title: 'Attach',
                        theme: theme,
                      ),
                      const SizedBox(height: 14),
                      Row(
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
                      const SizedBox(height: 24),

                      // ===== MODEL SECTION =====
                      if (widget.onModelTap != null) ...[
                        _SectionHeader(
                          icon: Icons.auto_awesome_rounded,
                          title: 'Model',
                          theme: theme,
                        ),
                        const SizedBox(height: 14),
                        _ModelCard(
                          model: widget.currentModel,
                          theme: theme,
                          onTap: () {
                            Navigator.pop(context);
                            widget.onModelTap?.call();
                          },
                        ),
                        const SizedBox(height: 24),
                      ],

                      // ===== THINKING LEVEL SECTION =====
                      if (widget.availableVariants.isNotEmpty) ...[
                        _SectionHeader(
                          icon: Icons.psychology_outlined,
                          title: _getThinkingLevelTitle(),
                          theme: theme,
                        ),
                        const SizedBox(height: 14),
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
                              },
                            ),
                            ...widget.availableVariants.map(
                              (v) => _VariantChip(
                                label: _formatVariantLabel(v),
                                isSelected: widget.currentVariant == v,
                                theme: theme,
                                onTap: () {
                                  widget.onVariantChanged?.call(v);
                                },
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                      ],

                      // ===== OPENCODE: AGENT SECTION =====
                      // Only show native agents (build/plan) - custom agents are @-tagged
                      if (widget.backend == AgentType.opencode &&
                          nativeAgents.isNotEmpty) ...[
                        _SectionHeader(
                          icon: Icons.smart_toy_outlined,
                          title: 'Agent',
                          theme: theme,
                        ),
                        const SizedBox(height: 14),
                        _buildOpenCodeAgents(theme, nativeAgents),
                        const SizedBox(height: 24),
                      ],

                      // ===== CLAUDE CODE: PERMISSION MODE SECTION =====
                      if (widget.backend == AgentType.claudeCode) ...[
                        _SectionHeader(
                          icon: Icons.shield_outlined,
                          title: 'Permission Mode',
                          theme: theme,
                        ),
                        const SizedBox(height: 14),
                        _buildClaudeCodePermissionModes(theme),
                        const SizedBox(height: 24),
                      ],

                      // ===== CODEX: COLLABORATION MODE SECTION =====
                      if (widget.backend == AgentType.codex) ...[
                        _SectionHeader(
                          icon: Icons.groups_outlined,
                          title: 'Collaboration Mode',
                          theme: theme,
                        ),
                        const SizedBox(height: 14),
                        _buildCodexCollabModes(theme),
                        const SizedBox(height: 24),
                      ],

                      // ===== OPENCODE: PERMISSION PRESETS SECTION =====
                      if (widget.backend == AgentType.opencode) ...[
                        _SectionHeader(
                          icon: Icons.shield_outlined,
                          title: 'Permissions',
                          theme: theme,
                          trailing: GestureDetector(
                            onTap: () {
                              Navigator.pop(context);
                              // TODO: Navigate to custom rules screen
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
                        const SizedBox(height: 14),
                        _buildOpenCodePermissionPresets(theme, rulesState),
                        const SizedBox(height: 24),
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
              ),
            ],
          ),
        ),
      ),
    );
  }

  // TODO: Remove after QA - method not currently used, kept for potential future use
  /// Truncate description to a short version for UI display
  String _truncateDescription(String desc) {
    // For very short descriptions, return as-is
    if (desc.length <= 35) return desc;
    // Truncate at word boundary if possible
    final truncated = desc.substring(0, 35);
    final lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 20) {
      return '${truncated.substring(0, lastSpace)}...';
    }
    return '$truncated...';
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

    return Row(
      children: agents.map((agent) {
        final isSelected = agent.name == widget.currentAgent;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: agent == agents.last ? 0 : 10),
            child: _AgentCard(
              name: agent.displayName,
              description: agent.name == 'build'
                  ? 'Full access for development'
                  : 'Read-only for analysis',
              color: agent.displayColor,
              isSelected: isSelected,
              theme: theme,
              onTap: () {
                widget.onAgentChanged?.call(agent.name);
              },
            ),
          ),
        );
      }).toList(),
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
    return Row(
      children: CodexCollaborationMode.values.map((mode) {
        final isSelected = widget.codexCollabMode == mode;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(
              right: mode == CodexCollaborationMode.values.last ? 0 : 8,
            ),
            child: _CollabModeCard(
              mode: mode,
              isSelected: isSelected,
              theme: theme,
              onTap: () {
                widget.onCodexCollabModeChanged?.call(mode);
              },
            ),
          ),
        );
      }).toList(),
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

    return Row(
      children: presets.map((preset) {
        final isSelected = rulesState.preset == preset;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: preset == presets.last ? 0 : 8),
            child: _PresetCard(
              name: preset.displayName.split(' ').first,
              description: preset.description,
              isSelected: isSelected,
              theme: theme,
              onTap: () {
                ref.read(permissionRulesProvider.notifier).setPreset(preset);
              },
            ),
          ),
        );
      }).toList(),
    );
  }
}

// ============================================================================
// HELPER WIDGETS
// ============================================================================

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.icon,
    required this.title,
    required this.theme,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final OpenCodeTheme theme;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: theme.textMuted, size: 18),
        const SizedBox(width: 8),
        Text(
          title,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: theme.textMuted,
            letterSpacing: 0.5,
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
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: theme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                Icons.auto_awesome_rounded,
                size: 18,
                color: theme.primary,
              ),
            ),
            const SizedBox(width: 12),
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
              ? theme.primary.withValues(alpha: 0.15)
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
    required this.color,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final String name;
  final String description;
  final Color color;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected
              ? color.withValues(alpha: 0.12)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? color : theme.borderSubtle,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    name,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: theme.text,
                    ),
                  ),
                ),
                if (isSelected)
                  Icon(Icons.check_rounded, size: 16, color: color),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              description,
              style: TextStyle(fontSize: 11, color: theme.textMuted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

// TODO: Remove after QA - class not currently used, kept for potential future use
class _SecondaryAgentsList extends StatelessWidget {
  const _SecondaryAgentsList({
    required this.agents,
    required this.currentAgent,
    required this.theme,
    required this.onAgentChanged,
  });

  final List<Agent> agents;
  final String? currentAgent;
  final OpenCodeTheme theme;
  final void Function(String) onAgentChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        children: agents.asMap().entries.map((entry) {
          final index = entry.key;
          final agent = entry.value;
          final isSelected = agent.name == currentAgent;
          final isLast = index == agents.length - 1;
          return Column(
            children: [
              InkWell(
                onTap: () => onAgentChanged(agent.name),
                borderRadius: BorderRadius.vertical(
                  top: index == 0 ? const Radius.circular(12) : Radius.zero,
                  bottom: isLast ? const Radius.circular(12) : Radius.zero,
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: agent.displayColor,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              agent.displayName,
                              style: TextStyle(
                                color: theme.text,
                                fontSize: 14,
                                fontWeight: isSelected
                                    ? FontWeight.w600
                                    : FontWeight.w500,
                              ),
                            ),
                            Text(
                              agent.shortDescription.length > 35
                                  ? '${agent.shortDescription.substring(0, 32)}...'
                                  : agent.shortDescription,
                              style: TextStyle(
                                color: theme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      if (isSelected)
                        Icon(
                          Icons.check_rounded,
                          color: theme.primary,
                          size: 18,
                        ),
                    ],
                  ),
                ),
              ),
              if (!isLast)
                Divider(height: 1, indent: 34, color: theme.borderSubtle),
            ],
          );
        }).toList(),
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
                ? theme.primary.withValues(alpha: 0.1)
                : theme.backgroundPanel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? theme.primary : theme.borderSubtle,
              width: isSelected ? 2 : 1,
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
                        color: theme.text,
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
                Icon(Icons.check_circle, size: 20, color: theme.primary),
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

  Color _getModeColor() {
    switch (mode) {
      case CodexCollaborationMode.plan:
        return Colors.amber;
      case CodexCollaborationMode.pairProgramming:
        return theme.primary;
      case CodexCollaborationMode.execute:
        return Colors.green;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _getModeColor();
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected
              ? color.withValues(alpha: 0.12)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? color : theme.borderSubtle,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(
              _getModeIcon(),
              size: 22,
              color: isSelected ? color : theme.textMuted,
            ),
            const SizedBox(height: 6),
            Text(
              mode.displayName,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                color: isSelected ? color : theme.text,
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _getModeIcon() {
    switch (mode) {
      case CodexCollaborationMode.plan:
        return Icons.edit_note_rounded;
      case CodexCollaborationMode.pairProgramming:
        return Icons.people_rounded;
      case CodexCollaborationMode.execute:
        return Icons.rocket_launch_rounded;
    }
  }
}

class _PresetCard extends StatelessWidget {
  const _PresetCard({
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
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.1)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Text(
              name,
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                color: isSelected ? theme.primary : theme.text,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              description,
              style: TextStyle(fontSize: 10, color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
          ],
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
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.accent.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.accent.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: theme.accent.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                Icons.grid_view_rounded,
                size: 20,
                color: theme.accent,
              ),
            ),
            const SizedBox(width: 14),
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
                  Text(
                    _getToolsDescription(),
                    style: TextStyle(fontSize: 12, color: theme.textMuted),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: theme.accent),
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
