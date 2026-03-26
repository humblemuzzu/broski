import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/agent.dart';
import '../../models/agent_type.dart';
import '../../models/claude_code.dart';
import '../../models/codex.dart';
import '../../models/file_attachment.dart';
import '../../models/glow_style.dart';
import '../../models/project.dart';
import '../../providers/selection_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/file_tagging.dart';
import '../../widgets/power_sheet.dart';
import '../../widgets/voice_input_button.dart';
import 'glow_border_painter.dart';

/// CLI-style input bar (OpenCode terminal aesthetic).
/// Extracted from chat_screen.dart.
class CliStyleInputBar extends StatefulWidget {
  const CliStyleInputBar({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.onSend,
    required this.isBusy,
    required this.canSend,
    required this.backend,
    required this.project,
    this.isOfflineMode = false,
    this.currentAgent,
    this.agents = const [],
    this.onAgentChanged,
    this.currentModel,
    this.onModelTap,
    this.attachedFiles = const [],
    this.onRemoveAttachment,
    this.showFileAutocomplete = false,
    this.onFileSelect,
    this.onAttachTap,
    this.onTakePhoto,
    this.attachIcon = AppIcons.add,
    // Claude Code specific props
    this.ccPermissionMode,
    this.ccModel,
    this.onCCModelTap,
    this.onCCPermissionModeChanged,
    // Codex specific props
    this.codexModel,
    this.onCodexModelTap,
    // Codex Collaboration Mode (SDK v0.87.0+)
    this.codexCollabMode,
    this.onCodexCollabModeChanged,
    // Custom accent color (null = use agent/permission mode color)
    this.customAccentColor,
    // Glow style for border accent
    this.glowStyle = GlowStyle.fullBorder,
    // Variant/Thinking Level (all backends)
    this.currentVariant,
    this.availableVariants = const [],
    this.onVariantChanged,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;
  final AgentType backend;
  final ProjectSummary project;
  final bool isOfflineMode;
  final String? currentAgent;
  final List<Agent> agents;
  final void Function(String?)? onAgentChanged;
  final SelectedModel? currentModel;
  final VoidCallback? onModelTap;
  final List<FileAttachment> attachedFiles;
  final void Function(FileAttachment)? onRemoveAttachment;
  final bool showFileAutocomplete;
  final void Function(FileAttachment)? onFileSelect;
  final VoidCallback? onAttachTap;
  final VoidCallback? onTakePhoto;
  final IconData attachIcon;
  // Claude Code specific props
  final ClaudeCodePermissionMode? ccPermissionMode;
  final String? ccModel;
  final VoidCallback? onCCModelTap;
  final void Function(ClaudeCodePermissionMode)? onCCPermissionModeChanged;
  // Codex specific props
  final String? codexModel;
  final VoidCallback? onCodexModelTap;
  // Codex Collaboration Mode (SDK v0.87.0+)
  final CodexCollaborationMode? codexCollabMode;
  final void Function(CodexCollaborationMode)? onCodexCollabModeChanged;
  // Custom accent color (null = use agent/permission mode color)
  final Color? customAccentColor;
  // Glow style for border accent
  final GlowStyle glowStyle;
  // Variant/Thinking Level (all backends)
  final String? currentVariant;
  final List<String> availableVariants;
  final void Function(String?)? onVariantChanged;
  @override
  State<CliStyleInputBar> createState() => _CliStyleInputBarState();
}

class _CliStyleInputBarState extends State<CliStyleInputBar> {
  static const _placeholders = [
    'Fix a TODO in the codebase',
    'What is the tech stack of this project?',
    'Fix broken tests',
    'Explain how authentication works',
    'Find and fix security vulnerabilities',
    'Add unit tests for the user service',
    'Refactor this function to be more readable',
    'Help me debug this issue',
    'Optimize database queries',
    'Add error handling to this function',
  ];

  // PERF: Use a ValueNotifier so the 6-second placeholder rotation only
  // rebuilds the TextField (via ValueListenableBuilder), not the entire
  // input bar with its agent selector, model badge, buttons, etc.
  late final ValueNotifier<int> _placeholderIndex;
  Timer? _placeholderTimer;

  @override
  void initState() {
    super.initState();
    _placeholderIndex = ValueNotifier<int>(
      DateTime.now().millisecond % _placeholders.length,
    );
    _placeholderTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!mounted) return;
      _placeholderIndex.value =
          (_placeholderIndex.value + 1) % _placeholders.length;
    });
  }

  @override
  void dispose() {
    _placeholderTimer?.cancel();
    _placeholderIndex.dispose();
    super.dispose();
  }

  /// Cycle through variants/thinking levels
  void _cycleVariant() {
    if (widget.availableVariants.isEmpty) return;
    final current = widget.currentVariant;
    if (current == null) {
      widget.onVariantChanged?.call(widget.availableVariants.first);
    } else {
      final currentIndex = widget.availableVariants.indexOf(current);
      final nextIndex = (currentIndex + 1) % widget.availableVariants.length;
      widget.onVariantChanged?.call(widget.availableVariants[nextIndex]);
    }
  }

  /// Show the unified PowerSheet for all backends
  void _showPowerSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.55,
        maxChildSize: 0.9,
        minChildSize: 0.3,
        expand: false,
        builder: (context, scrollController) => PowerSheet(
          backend: widget.backend,
          project: widget.project,
          onAttachFile: widget.onAttachTap,
          onTakePhoto: widget.onTakePhoto,
          // Model - depends on backend
          currentModel: widget.backend == AgentType.claudeCode
              ? widget.ccModel
              : widget.backend == AgentType.codex
              ? widget.codexModel
              : widget.currentModel?.modelID,
          onModelTap: widget.backend == AgentType.claudeCode
              ? widget.onCCModelTap
              : widget.backend == AgentType.codex
              ? widget.onCodexModelTap
              : widget.onModelTap,
          // Thinking level / variants
          currentVariant: widget.currentVariant,
          availableVariants: widget.availableVariants,
          onVariantChanged: widget.onVariantChanged,
          // OpenCode agents
          agents: widget.agents,
          currentAgent: widget.currentAgent,
          onAgentChanged: widget.onAgentChanged,
          // Claude Code permission mode
          ccPermissionMode: widget.ccPermissionMode,
          onCCPermissionModeChanged: widget.onCCPermissionModeChanged,
          // Codex collaboration mode
          codexCollabMode: widget.codexCollabMode,
          onCodexCollabModeChanged: widget.onCodexCollabModeChanged,
          scrollController: scrollController,
        ),
      ),
    );
  }

  /// Format thinking level display for CLI prompt bar
  String _formatThinkingLevelDisplay(String variant) {
    final backend = widget.backend;
    if (backend == AgentType.claudeCode) {
      switch (variant.toLowerCase()) {
        case 'low':
          return 'Low';
        case 'medium':
          return 'Med';
        case 'high':
          return 'High';
        case 'max':
          return 'Max';
        default:
          return variant;
      }
    } else if (backend == AgentType.codex) {
      switch (variant.toLowerCase()) {
        case 'none':
          return 'None';
        case 'minimal':
          return 'Min';
        case 'low':
          return 'Low';
        case 'medium':
          return 'Med';
        case 'high':
          return 'High';
        case 'xhigh':
          return 'XHigh';
        default:
          return variant;
      }
    }
    // OpenCode: capitalize first letter
    if (variant.isEmpty) return 'Default';
    return variant[0].toUpperCase() + variant.substring(1);
  }

  String _getModelDisplayName(SelectedModel? model) {
    if (model == null) return 'Auto';
    // Try to extract clean model name
    final id = model.modelID;
    if (id.contains('opus')) return 'Claude Opus 4.5 (latest)';
    if (id.contains('sonnet')) return 'Claude Sonnet 4';
    if (id.contains('haiku')) return 'Claude Haiku';
    if (id.contains('gpt-4')) return 'GPT-4';
    if (id.contains('gpt-3')) return 'GPT-3.5';
    return id;
  }

  String _getProviderName(SelectedModel? model) {
    if (model == null) return '';
    final provider = model.providerID.toLowerCase();
    if (provider.contains('anthropic')) return 'Anthropic';
    if (provider.contains('openai')) return 'OpenAI';
    if (provider.contains('google')) return 'Google';
    if (provider.contains('openrouter')) return 'OpenRouter';
    return model.providerID;
  }

  /// Get Claude Code model display name from model string
  String _getCCModelDisplayName(String? model) {
    if (model == null || model.isEmpty) return 'Auto';
    final m = model.toLowerCase();
    if (m.contains('opus')) return 'Opus';
    if (m.contains('sonnet')) return 'Sonnet';
    if (m.contains('haiku')) return 'Haiku';
    if (m == 'auto') return 'Auto';
    // Return just the model part if it's a full model ID
    final parts = model.split('/');
    return parts.last;
  }

  /// Get Codex model display name from model string
  String _getCodexModelDisplayName(String? model) {
    if (model == null || model.isEmpty) return 'gpt-5.2-codex';
    // Keep it short for display
    if (model.length > 16) return '${model.substring(0, 14)}...';
    return model;
  }

  /// Get Codex collaboration mode display name
  String _getCodexCollabModeDisplay(CodexCollaborationMode? mode) {
    switch (mode) {
      case CodexCollaborationMode.plan:
        return 'Plan';
      case CodexCollaborationMode.defaultMode:
        return 'Default';
      case null:
        return 'Default';
    }
  }

  /// Get color for Codex collaboration mode
  Color _getCodexCollabModeColor(
    CodexCollaborationMode? mode,
    OpenCodeTheme theme,
  ) {
    switch (mode) {
      case CodexCollaborationMode.plan:
        return theme.warning; // Planning mode - amber
      case CodexCollaborationMode.defaultMode:
        return theme.primary; // Default coding mode - primary
      case null:
        return theme.primary;
    }
  }

  /// Get color for permission mode
  Color _getPermissionModeColor(
    ClaudeCodePermissionMode? mode,
    OpenCodeTheme theme,
  ) {
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return theme.primary; // Normal mode - primary color
      case ClaudeCodePermissionMode.acceptEdits:
        return theme.success; // Auto-accept edits - green
      case ClaudeCodePermissionMode.plan:
        return theme.warning; // Plan mode - amber/yellow
      case ClaudeCodePermissionMode.bypassPermissions:
        return theme.error; // Dangerous mode - red
      case ClaudeCodePermissionMode.dontAsk:
        return theme.warning;
      case null:
        return theme.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final agent = _getCurrentAgent();
    // Priority: custom accent color > permission mode color (CC) > agent color (OC)
    final isClaudeCode = widget.backend == AgentType.claudeCode;
    final isCodex = widget.backend == AgentType.codex;
    final isOpenCode = widget.backend == AgentType.opencode;
    final Color agentColor;
    if (widget.customAccentColor != null) {
      agentColor = widget.customAccentColor!;
    } else if (isClaudeCode) {
      agentColor = _getPermissionModeColor(widget.ccPermissionMode, theme);
    } else {
      agentColor = agent?.resolveColor(theme) ?? theme.primary;
    }
    // During streaming, hide the input bar
    return AnimatedSlide(
      duration: const Duration(milliseconds: 200),
      offset: widget.isBusy ? const Offset(0, 1) : Offset.zero,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: widget.isBusy ? 0.0 : 1.0,
        child: Container(
          color: Colors.transparent,
          child: SafeArea(
            top: false,
            bottom: false, // Let the bar touch the screen bottom
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // File autocomplete dropdown (appears above input)
                if (widget.onFileSelect != null)
                  Visibility(
                    visible: widget.showFileAutocomplete,
                    maintainState: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 0, 0, 8),
                      child: FileAutocomplete(
                        visible: widget.showFileAutocomplete,
                        onSelect: widget.onFileSelect!,
                      ),
                    ),
                  ),
                // Main CLI input container with configurable glow style
                _buildCliContainer(
                  theme: theme,
                  agentColor: agentColor,
                  glowStyle: widget.glowStyle,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Attached files chips row
                      if (widget.onRemoveAttachment != null)
                        Visibility(
                          visible: widget.attachedFiles.isNotEmpty,
                          maintainState: true,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                            child: AttachedFilesChips(
                              attachments: widget.attachedFiles,
                              onRemove: widget.onRemoveAttachment!,
                            ),
                          ),
                        ),
                      // Text input area
                      // PERF: ValueListenableBuilder scopes the 6-second
                      // placeholder rotation rebuild to ONLY this TextField,
                      // not the entire input bar (buttons, badges, etc.).
                      Container(
                        constraints: const BoxConstraints(
                          minHeight: 44,
                          maxHeight: 140,
                        ),
                        child: ValueListenableBuilder<int>(
                          valueListenable: _placeholderIndex,
                          builder: (context, placeholderIdx, _) => TextField(
                            controller: widget.controller,
                            focusNode: widget.focusNode,
                            enabled: !widget.isOfflineMode && !widget.isBusy,
                            minLines: 1,
                            maxLines: 5,
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 14,
                              height: 1.5,
                            ),
                            decoration: InputDecoration(
                              hintText: widget.isOfflineMode
                                  ? 'Offline mode - read only'
                                  : _placeholders[placeholderIdx],
                              filled: false,
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              disabledBorder: InputBorder.none,
                              hintStyle: TextStyle(
                                color: widget.isOfflineMode
                                    ? theme.warning
                                    : theme.textMuted.withValues(alpha: 0.4),
                                fontSize: 14,
                              ),
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                12,
                                16,
                                4,
                              ),
                              isDense: true,
                            ),
                            onSubmitted: widget.canSend
                                ? (_) => widget.onSend()
                                : null,
                          ),
                        ),
                      ),
                      // Bottom info rows - agent + actions on top, model below
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          0,
                          12,
                          MediaQuery.of(context).padding.bottom + 12,
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // ROW 1: Agent/mode + action buttons
                            Row(
                              children: [
                                // Agent/mode selector - opens PowerSheet
                                GestureDetector(
                                  onTap: () => _showPowerSheet(context),
                                  child: Text(
                                    isClaudeCode
                                        ? (widget
                                                  .ccPermissionMode
                                                  ?.displayName ??
                                              'Default')
                                        : isCodex
                                        ? _getCodexCollabModeDisplay(
                                            widget.codexCollabMode,
                                          )
                                        : (agent?.displayName ?? 'Build'),
                                    style: TextStyle(
                                      color: isCodex
                                          ? _getCodexCollabModeColor(
                                              widget.codexCollabMode,
                                              theme,
                                            )
                                          : agentColor,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                const Spacer(),
                                // Attachment button
                                if (widget.onAttachTap != null)
                                  GestureDetector(
                                    onTap: widget.onAttachTap,
                                    child: Padding(
                                      padding: const EdgeInsets.only(right: 12),
                                      child: Icon(
                                        widget.attachIcon,
                                        color: theme.textMuted,
                                        size: 22,
                                      ),
                                    ),
                                  ),
                                // Voice input button
                                Consumer(
                                  builder: (context, ref, _) {
                                    return VoiceInputButton(
                                      size: 22,
                                      padding: const EdgeInsets.only(right: 10),
                                      onTranscription: (text) {
                                        if (text.isEmpty) return;
                                        final ctrl = widget.controller;
                                        final current = ctrl.text;
                                        final newText = current.isEmpty
                                            ? text
                                            : (current.endsWith(' ')
                                                  ? '$current$text'
                                                  : '$current $text');
                                        ctrl.value = TextEditingValue(
                                          text: newText,
                                          selection: TextSelection.collapsed(
                                            offset: newText.length,
                                          ),
                                        );
                                        Future.microtask(
                                          () => widget.focusNode.requestFocus(),
                                        );
                                      },
                                    );
                                  },
                                ),
                                // Send button (minimal)
                                GestureDetector(
                                  onTap: widget.canSend ? widget.onSend : null,
                                  child: Container(
                                    width: 28,
                                    height: 28,
                                    decoration: BoxDecoration(
                                      color: widget.canSend
                                          ? theme.text
                                          : theme.textMuted.withValues(
                                              alpha: 0.15,
                                            ),
                                      borderRadius: Radii.brSm,
                                    ),
                                    child: Center(
                                      child: Icon(
                                        AppIcons.arrowUp,
                                        color: widget.canSend
                                            ? theme.background
                                            : theme.textMuted.withValues(
                                                alpha: 0.4,
                                              ),
                                        size: 16,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            // ROW 2: Model + variant/thinking level
                            GestureDetector(
                              onTap: isClaudeCode
                                  ? widget.onCCModelTap
                                  : isCodex
                                  ? widget.onCodexModelTap
                                  : widget.onModelTap,
                              child: Row(
                                children: [
                                  // Model name
                                  if (isClaudeCode)
                                    Text(
                                      _getCCModelDisplayName(widget.ccModel),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    )
                                  else if (isCodex)
                                    Text(
                                      _getCodexModelDisplayName(
                                        widget.codexModel,
                                      ),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    )
                                  else ...[
                                    Text(
                                      _getModelDisplayName(widget.currentModel),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    // Provider name (muted) - only for OpenCode
                                    if (_getProviderName(
                                      widget.currentModel,
                                    ).isNotEmpty) ...[
                                      const SizedBox(width: 5),
                                      Text(
                                        _getProviderName(widget.currentModel),
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.4,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ],
                                  // Variant / thinking level (if applicable)
                                  if (isClaudeCode &&
                                      widget.currentVariant != null) ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.3,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: () => _showPowerSheet(context),
                                      child: Text(
                                        _formatThinkingLevelDisplay(
                                          widget.currentVariant!,
                                        ),
                                        style: TextStyle(
                                          color: theme.primary.withValues(
                                            alpha: 0.7,
                                          ),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ] else if (isCodex &&
                                      widget.currentVariant != null &&
                                      widget.currentVariant != 'medium') ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.3,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: () => _showPowerSheet(context),
                                      child: Text(
                                        _formatThinkingLevelDisplay(
                                          widget.currentVariant!,
                                        ),
                                        style: TextStyle(
                                          color: theme.primary.withValues(
                                            alpha: 0.7,
                                          ),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ] else if (isOpenCode &&
                                      widget.availableVariants.isNotEmpty) ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.3,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: widget.onVariantChanged != null
                                          ? () => _cycleVariant()
                                          : null,
                                      child: Text(
                                        widget.currentVariant ?? 'Default',
                                        style: TextStyle(
                                          color: widget.currentVariant != null
                                              ? theme.primary.withValues(
                                                  alpha: 0.7,
                                                )
                                              : theme.textMuted,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Builds the CLI input container with the appropriate glow style.
  Widget _buildCliContainer({
    required OpenCodeTheme theme,
    required Color agentColor,
    required GlowStyle glowStyle,
    required Widget child,
  }) {
    const radius = 20.0;
    final baseDecoration = BoxDecoration(
      color: theme.backgroundElement,
      borderRadius: const BorderRadius.only(
        topLeft: Radius.circular(radius),
        topRight: Radius.circular(radius),
      ),
    );
    switch (glowStyle) {
      case GlowStyle.none:
        // No glow — plain container
        return Container(
          key: const ValueKey('cli-input-container'),
          margin: EdgeInsets.zero,
          decoration: baseDecoration,
          child: child,
        );
      case GlowStyle.leftOnly:
        // Left-only glow strip (original design)
        return ClipRRect(
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(radius),
            topRight: Radius.circular(radius),
          ),
          child: Container(
            key: const ValueKey('cli-input-container'),
            margin: EdgeInsets.zero,
            decoration: baseDecoration,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 3,
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(radius),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: agentColor.withValues(alpha: 0.6),
                        blurRadius: 8,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ),
                Expanded(child: child),
              ],
            ),
          ),
        );
      case GlowStyle.fullBorder:
        // Full ∩-shaped glow border (left + top + right)
        return CustomPaint(
          key: const ValueKey('cli-input-container'),
          foregroundPainter: GlowBorderPainter(
            color: agentColor,
            radius: radius,
            strokeWidth: 3.5,
          ),
          child: Container(
            margin: EdgeInsets.zero,
            decoration: baseDecoration,
            child: child,
          ),
        );
    }
  }

  Agent? _getCurrentAgent() {
    final primaryAgents = widget.agents.where((a) => a.isPrimary).toList();
    if (primaryAgents.isEmpty) return null;
    return primaryAgents.firstWhere(
      (a) => a.name == widget.currentAgent,
      orElse: () => primaryAgents.first,
    );
  }
}

/// Chip widget for variant/thinking level selection.
/// Extracted from chat_screen.dart.
class VariantChip extends StatelessWidget {
  const VariantChip({
    super.key,
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
          borderRadius: Radii.brXl,
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? theme.primary : theme.text,
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
