import 'package:broski/models/agent.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code/cc_permission.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/glow_style.dart';
import 'package:broski/models/project.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/pill_glow_painter.dart';
import 'package:broski/widgets/file_tagging.dart';
import 'package:broski/widgets/power_sheet.dart';
import 'package:broski/widgets/voice_input_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Floating input bar for the chat screen. Extracted from chat_screen.dart.
class FloatingInputBar extends ConsumerWidget {
  const FloatingInputBar({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.onSend,
    required this.isBusy,
    required this.canSend,
    required this.backend,
    required this.project,
    this.isOfflineMode = false,
    this.attachedFiles = const [],
    this.onRemoveAttachment,
    this.showFileAutocomplete = false,
    this.onFileSelect,
    this.onAttachTap,
    this.onTakePhoto,
    this.attachIcon = AppIcons.add,
    // Model selector
    this.currentModel,
    this.onModelTap,
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
    // Variant/Thinking Level (all backends)
    this.currentVariant,
    this.availableVariants = const [],
    this.onVariantChanged,
    // Glow style and accent color
    this.glowStyle = GlowStyle.none,
    this.accentColor,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;
  final AgentType backend;
  final ProjectSummary project;
  final bool isOfflineMode;
  final List<FileAttachment> attachedFiles;
  final void Function(FileAttachment)? onRemoveAttachment;
  final bool showFileAutocomplete;
  final void Function(FileAttachment)? onFileSelect;
  final VoidCallback? onAttachTap;
  final VoidCallback? onTakePhoto;
  final IconData attachIcon;
  // Model selector
  final String? currentModel;
  final VoidCallback? onModelTap;
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
  // Variant/Thinking Level (all backends)
  final String? currentVariant;
  final List<String> availableVariants;
  final void Function(String?)? onVariantChanged;
  // Glow style and accent color
  final GlowStyle glowStyle;
  final Color? accentColor;
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
          backend: backend,
          project: project,
          onAttachFile: onAttachTap,
          onTakePhoto: onTakePhoto,
          currentModel: currentModel,
          onModelTap: onModelTap,
          currentVariant: currentVariant,
          availableVariants: availableVariants,
          onVariantChanged: onVariantChanged,
          // OpenCode
          agents: agents,
          currentAgent: currentAgent,
          onAgentChanged: onAgentChanged,
          // Claude Code
          ccPermissionMode: ccPermissionMode,
          onCCPermissionModeChanged: onCCPermissionModeChanged,
          // Codex
          codexCollabMode: codexCollabMode,
          onCodexCollabModeChanged: onCodexCollabModeChanged,
          scrollController: scrollController,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final kMuted = theme.textMuted;
    final kOnBackground = theme.text;
    final kBackground = theme.background;
    // During streaming, hide the input bar completely
    // (Stop button is shown separately)
    return AnimatedSlide(
      duration: const Duration(milliseconds: 200),
      offset: isBusy ? const Offset(0, 1) : Offset.zero,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: isBusy ? 0.0 : 1.0,
        child: Container(
          color: Colors.transparent,
          child: SafeArea(
            top: false,
            minimum: const EdgeInsets.only(bottom: 3),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // File autocomplete dropdown (appears above input)
                if (onFileSelect != null)
                  Visibility(
                    visible: showFileAutocomplete,
                    maintainState: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: FileAutocomplete(
                        visible: showFileAutocomplete,
                        onSelect: onFileSelect!,
                      ),
                    ),
                  ),
                // Attached files chips row
                if (onRemoveAttachment != null)
                  Visibility(
                    visible: attachedFiles.isNotEmpty,
                    maintainState: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                      child: AttachedFilesChips(
                        attachments: attachedFiles,
                        onRemove: onRemoveAttachment!,
                      ),
                    ),
                  ),
                // Main input container - ChatGPT-style unified card
                Padding(
                  key: const ValueKey('floating-input-row'),
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                  child: _buildFloatingContainer(
                    glowStyle: glowStyle,
                    accentColor: accentColor,
                    kCard: kCard,
                    kMuted: kMuted,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Top: Text input (full width)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(18, 6, 18, 0),
                          child: TextField(
                            controller: controller,
                            focusNode: focusNode,
                            enabled: !isOfflineMode && !isBusy,
                            minLines: 1,
                            maxLines: 5,
                            style: TextStyle(
                              fontWeight: FontWeight.w400,
                              color: kOnBackground,
                              fontSize: 15,
                            ),
                            decoration: InputDecoration(
                              hintText: isOfflineMode
                                  ? 'Offline mode - read only'
                                  : 'Ask AI to edit code...',
                              filled: false,
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              disabledBorder: InputBorder.none,
                              errorBorder: InputBorder.none,
                              focusedErrorBorder: InputBorder.none,
                              hintStyle: TextStyle(
                                color: isOfflineMode
                                    ? theme.warning
                                    : kMuted.withValues(alpha: 0.5),
                                fontWeight: FontWeight.w400,
                                fontSize: 15,
                              ),
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 0,
                                vertical: 10,
                              ),
                              isDense: true,
                            ),
                            onSubmitted: canSend ? (_) => onSend() : null,
                          ),
                        ),
                        // Bottom: Action row
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 2, 10, 10),
                          child: Row(
                            children: [
                              // Project chip (left)
                              GestureDetector(
                                onTap: () => _showPowerSheet(context),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 6,
                                  ),
                                  decoration: BoxDecoration(
                                    borderRadius: Radii.brXl,
                                    border: Border.all(
                                      color: _fade(kMuted, 0.25),
                                    ),
                                  ),
                                  child: Text(
                                    project.name.isNotEmpty
                                        ? project.name
                                        : 'Project',
                                    style: TextStyle(
                                      color: kMuted,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w400,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                              const Spacer(),
                              // Attach button (+)
                              if (onAttachTap != null)
                                GestureDetector(
                                  onTap: onAttachTap,
                                  child: Padding(
                                    padding: Insets.cardXs,
                                    child: Icon(
                                      AppIcons.add,
                                      color: kMuted,
                                      size: 22,
                                    ),
                                  ),
                                ),
                              const SizedBox(width: Spacing.xs),
                              // Voice input button
                              VoiceInputButton(
                                size: 20,
                                padding: Insets.cardXs,
                                onTranscription: (text) {
                                  if (text.isEmpty) return;
                                  final current = controller.text;
                                  final newText = current.isEmpty
                                      ? text
                                      : (current.endsWith(' ')
                                            ? '$current$text'
                                            : '$current $text');
                                  controller.value = TextEditingValue(
                                    text: newText,
                                    selection: TextSelection.collapsed(
                                      offset: newText.length,
                                    ),
                                  );
                                  Future.microtask(
                                    () => focusNode.requestFocus(),
                                  );
                                },
                              ),
                              const SizedBox(width: Spacing.xs),
                              // Tune / PowerSheet button
                              GestureDetector(
                                onTap: () => _showPowerSheet(context),
                                child: Padding(
                                  padding: Insets.cardXs,
                                  child: Icon(
                                    AppIcons.tune,
                                    color: kMuted,
                                    size: 20,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              // Send button
                              GestureDetector(
                                onTap: canSend ? onSend : null,
                                child: Container(
                                  width: 32,
                                  height: 32,
                                  decoration: BoxDecoration(
                                    color: canSend
                                        ? kOnBackground
                                        : _fade(kMuted, 0.08),
                                    borderRadius: Radii.brLg,
                                  ),
                                  child: Center(
                                    child: Icon(
                                      AppIcons.arrowUp,
                                      color: canSend
                                          ? kBackground
                                          : _fade(kMuted, 0.4),
                                      size: 18,
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
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Local fade helper (avoids importing top-level function from chat_screen).
  static Color _fade(Color c, double a) => c.withValues(alpha: a);

  /// Builds the floating pill container with the appropriate glow style.
  Widget _buildFloatingContainer({
    required GlowStyle glowStyle,
    required Color? accentColor,
    required Color kCard,
    required Color kMuted,
    required Widget child,
  }) {
    const radius = 24.0;
    switch (glowStyle) {
      case GlowStyle.none:
        // No glow — original plain pill
        return Container(
          decoration: BoxDecoration(
            color: kCard,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: _fade(kMuted, 0.18)),
          ),
          child: child,
        );
      case GlowStyle.leftOnly:
        // Left-only glow strip inside the pill
        final color = accentColor ?? kMuted;
        return Container(
          decoration: BoxDecoration(
            color: kCard,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: _fade(kMuted, 0.18)),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 4,
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(radius),
                      bottomLeft: Radius.circular(radius),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(alpha: 0.6),
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
        // Full pill glow — accent border all around
        final color = accentColor ?? kMuted;
        return CustomPaint(
          foregroundPainter: PillGlowPainter(
            color: color,
            radius: radius,
            strokeWidth: 3.0,
          ),
          child: Container(
            decoration: BoxDecoration(
              color: kCard,
              borderRadius: BorderRadius.circular(radius),
            ),
            child: child,
          ),
        );
    }
  }
}
