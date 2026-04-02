import 'dart:async';

import 'package:broski/models/agent.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/glow_style.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/glow_border_painter.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:broski/widgets/file_tagging.dart';
import 'package:broski/widgets/voice_input_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// CLI-style input bar (OpenCode terminal aesthetic).
/// Extracted from chat_screen.dart.
class CliStyleInputBar extends StatefulWidget {
  const CliStyleInputBar({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.onSend,
    this.onLongPressSend,
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
    // Codex specific props
    this.codexModel,
    this.onCodexModelTap,
    // Custom accent color (null = use agent/permission mode color)
    this.customAccentColor,
    // Glow style for border accent
    this.glowStyle = GlowStyle.fullBorder,
    // Variant/Thinking Level (all backends)
    this.currentVariant,
    this.availableVariants = const [],
    this.onVariantChanged,
    // ⋯ menu
    this.onMenuTap,
    // Unified model display string (for all backends)
    this.modelDisplay,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final VoidCallback? onLongPressSend;
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
  // Codex specific props
  final String? codexModel;
  final VoidCallback? onCodexModelTap;
  // Custom accent color (null = use agent/permission mode color)
  final Color? customAccentColor;
  // Glow style for border accent
  final GlowStyle glowStyle;
  // Variant/Thinking Level (all backends)
  final String? currentVariant;
  final List<String> availableVariants;
  final void Function(String?)? onVariantChanged;
  // ⋯ menu
  final VoidCallback? onMenuTap;
  // Unified model display string
  final String? modelDisplay;
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

  /// Get unified model display string for the chip.
  /// Uses the pre-computed modelDisplay from input_bar_content when available,
  /// falls back to backend-specific model fields.
  String _getUnifiedModelDisplay() {
    if (widget.modelDisplay != null && widget.modelDisplay!.isNotEmpty) {
      return getModelDisplayName(
        widget.modelDisplay,
        fallback: 'Model',
        maxLength: 14,
      );
    }
    // Fallback to backend-specific fields
    final isClaudeCode = widget.backend == AgentType.claudeCode;
    final isCodex = widget.backend == AgentType.codex;
    if (isClaudeCode) {
      return getModelDisplayName(
        widget.ccModel,
        fallback: 'Model',
        maxLength: 14,
      );
    }
    if (isCodex) {
      return getModelDisplayName(
        widget.codexModel,
        fallback: 'Model',
        maxLength: 14,
      );
    }
    // OpenCode / Pi — use SelectedModel
    return getModelDisplayName(
      widget.currentModel?.modelID,
      fallback: 'Model',
      maxLength: 14,
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

  /// Get color for permission mode (used for glow accent)
  Color _getPermissionModeColor(
    ClaudeCodePermissionMode? mode,
    OpenCodeTheme theme,
  ) {
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return theme.primary;
      case ClaudeCodePermissionMode.acceptEdits:
        return theme.success;
      case ClaudeCodePermissionMode.plan:
        return theme.warning;
      case ClaudeCodePermissionMode.bypassPermissions:
        return theme.error;
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
                      // Bottom: Unified action row — [+] [Model▾] [Thinking▾]  [🎤] [⋯] [↑]
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          12,
                          0,
                          12,
                          MediaQuery.of(context).padding.bottom + 12,
                        ),
                        child: Row(
                          children: [
                            // Attachment button (+)
                            if (widget.onAttachTap != null)
                              GestureDetector(
                                onTap: widget.onAttachTap,
                                child: Padding(
                                  padding: Insets.cardXs,
                                  child: Icon(
                                    widget.attachIcon,
                                    color: theme.textMuted,
                                    size: 22,
                                  ),
                                ),
                              ),
                            const SizedBox(width: Spacing.xs),
                            // Model chip
                            GestureDetector(
                              onTap: isClaudeCode
                                  ? widget.onCCModelTap
                                  : isCodex
                                  ? widget.onCodexModelTap
                                  : widget.onModelTap,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 5,
                                ),
                                decoration: BoxDecoration(
                                  borderRadius: Radii.brSm,
                                  border: Border.all(
                                    color: theme.textMuted.withValues(
                                      alpha: 0.25,
                                    ),
                                  ),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      _getUnifiedModelDisplay(),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    const SizedBox(width: 3),
                                    Icon(
                                      AppIcons.expandMore,
                                      size: 12,
                                      color: theme.textMuted.withValues(
                                        alpha: 0.6,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: Spacing.sm),
                            // Thinking level chip (if variants available)
                            if (widget.availableVariants.isNotEmpty)
                              GestureDetector(
                                onTap: _cycleVariant,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 5,
                                  ),
                                  decoration: BoxDecoration(
                                    borderRadius: Radii.brSm,
                                    border: Border.all(
                                      color: theme.textMuted.withValues(
                                        alpha: 0.25,
                                      ),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        AppIcons.bolt,
                                        size: 11,
                                        color: widget.currentVariant != null
                                            ? theme.primary
                                            : theme.textMuted.withValues(
                                                alpha: 0.6,
                                              ),
                                      ),
                                      const SizedBox(width: 4),
                                      Text(
                                        _formatThinkingLevelDisplay(
                                          widget.currentVariant ?? 'medium',
                                        ),
                                        style: TextStyle(
                                          color: widget.currentVariant != null
                                              ? theme.primary
                                              : theme.textMuted,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            // Settings / power menu button (sliders icon)
                            if (widget.onMenuTap != null) ...[
                              const SizedBox(width: Spacing.sm),
                              GestureDetector(
                                onTap: widget.onMenuTap,
                                child: Padding(
                                  padding: Insets.cardXs,
                                  child: Icon(
                                    AppIcons.tune,
                                    color: theme.textMuted,
                                    size: 18,
                                  ),
                                ),
                              ),
                            ],
                            const Spacer(),
                            // Voice input button
                            Consumer(
                              builder: (context, ref, _) {
                                return VoiceInputButton(
                                  size: 22,
                                  padding: Insets.cardXs,
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
                            const SizedBox(width: 6),
                            // Send button (minimal)
                            GestureDetector(
                              onTap: widget.canSend ? widget.onSend : null,
                              onLongPress: widget.canSend
                                  ? widget.onLongPressSend
                                  : null,
                              child: Container(
                                width: 28,
                                height: 28,
                                decoration: BoxDecoration(
                                  color: widget.canSend
                                      ? theme.text
                                      : theme.textMuted.withValues(alpha: 0.15),
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
