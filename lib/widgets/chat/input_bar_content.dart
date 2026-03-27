import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/agent.dart';
import '../../models/agent_type.dart';
import '../../models/claude_code.dart';
import '../../models/codex.dart';
import '../../models/file_attachment.dart';
import '../../models/pi.dart';
import '../../models/project.dart';
import '../../models/prompt_accent_color.dart';
import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../providers/claude_code_variant_provider.dart';
import '../../providers/codex_settings_provider.dart';
import '../../providers/glow_style_provider.dart';
import '../../providers/input_style_provider.dart';
import '../../providers/opencode_variant_provider.dart';
import '../../providers/prompt_accent_provider.dart';
import '../../providers/selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/connection_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/opencode_theme.dart';
import 'cli_input_bar.dart';
import 'floating_input_bar.dart';

/// Builds the chat input bar (CLI or Floating style) with all provider watches
/// and agent-specific configuration.
///
/// Extracted from `_ChatScreenState._buildInputBarWithParams` in chat_screen.dart.
class ChatInputBarContent extends ConsumerWidget {
  const ChatInputBarContent({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.attachedFiles,
    required this.showFileAutocomplete,
    required this.connection,
    required this.ccIsStreaming,
    this.ccInit,
    this.ccModel,
    required this.isClaudeCode,
    required this.isCodex,
    required this.isPi,
    this.selectedAgent,
    this.agents = const [],
    required this.project,
    required this.projectName,
    required this.effectivePath,
    this.ccSessionModel,
    this.ccDraftModel,
    required this.onSend,
    required this.onRemoveAttachment,
    required this.onFileSelect,
    required this.onAttachTap,
    required this.onTakePhoto,
    required this.onAgentChanged,
    required this.onModelTap,
    required this.onSetCodexReasoningEffort,
    required this.onSetPiThinkingLevel,
  });

  // --- Text input state (from _ChatScreenState) ---
  final TextEditingController controller;
  final FocusNode focusNode;
  final List<FileAttachment> attachedFiles;
  final bool showFileAutocomplete;

  // --- Connection & streaming state (from build method params) ---
  final BridgeConnectionState connection;
  final bool ccIsStreaming;
  final CCSessionInit? ccInit;
  final String? ccModel;

  // --- Agent type flags ---
  final bool isClaudeCode;
  final bool isCodex;
  final bool isPi;
  bool get isOpenCode => !isClaudeCode && !isCodex && !isPi;

  // --- OpenCode agent selection ---
  final String? selectedAgent;
  final List<Agent> agents;

  // --- Project info ---
  final ProjectSummary project;
  final String projectName;
  final String effectivePath;
  final String? ccSessionModel;
  final String? ccDraftModel;

  // --- Callbacks ---
  final VoidCallback onSend;
  final void Function(FileAttachment) onRemoveAttachment;
  final void Function(FileAttachment) onFileSelect;
  final VoidCallback onAttachTap;
  final VoidCallback onTakePhoto;
  final void Function(String?) onAgentChanged;
  final VoidCallback onModelTap;
  final void Function(String?) onSetCodexReasoningEffort;
  final void Function(String?) onSetPiThinkingLevel;

  /// Handles CC permission mode change: persists config and optionally applies
  /// to the live session.
  Future<void> _handleCCPermissionModeChanged(
    BuildContext context,
    WidgetRef ref,
    ClaudeCodePermissionMode mode,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final notifier = ref.read(ccConfigProvider.notifier);
    final existing = ref.read(ccConfigProvider).valueOrNull;
    await notifier.updateConfig(
      existing?.copyWith(permissionMode: mode) ??
          ClaudeCodeConfig(
            permissionMode: mode,
            allowedTools: const [],
            disallowedTools: const [],
          ),
    );

    final liveState = ref.read(chatSessionProvider);
    final sessionId = liveState.ccSessionId;
    final canApplyLive =
        liveState.ccIsStreaming && sessionId != null && sessionId.isNotEmpty;
    if (!canApplyLive) return;

    final ok = await ref
        .read(bridgeServiceProvider)
        .ccSetPermissionMode(sessionId: sessionId, mode: mode.wireValue);
    if (!context.mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          ok
              ? 'Permission mode applied to current Claude turn.'
              : 'Saved as default. Live turn update failed.',
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Resolves the current variant/thinking-level string for the active agent.
  String? _currentVariant(WidgetRef ref) {
    if (isOpenCode) {
      return ref
          .watch(openCodeVariantProvider)
          .getVariant(ref.watch(selectionProvider).model);
    }
    if (isClaudeCode) {
      return ref.watch(claudeCodeVariantProvider).selectedVariant;
    }
    if (isCodex) {
      return ref.watch(codexSettingsProvider).reasoningEffort.wireValue;
    }
    if (isPi) {
      return ref
          .watch(chatSessionProvider.select((s) => s.piThinkingLevel))
          ?.wireValue;
    }
    return null;
  }

  /// Resolves the list of available variants for the active agent.
  List<String> _availableVariants(WidgetRef ref) {
    if (isOpenCode) {
      return ref
          .watch(openCodeVariantProvider)
          .getAvailableVariants(ref.watch(selectionProvider).model);
    }
    if (isClaudeCode) return claudeCodeVariants;
    if (isCodex) {
      return CodexReasoningEffort.values.map((e) => e.wireValue).toList();
    }
    if (isPi) {
      return PiThinkingLevel.values.map((e) => e.wireValue).toList();
    }
    return const [];
  }

  /// Callback for variant changes, dispatching to the correct provider.
  void Function(String?)? _onVariantChanged(WidgetRef ref) {
    if (isOpenCode) {
      return (v) {
        final model = ref.read(selectionProvider).model;
        if (model != null && v != null) {
          ref.read(openCodeVariantProvider.notifier).setVariant(model, v);
        } else if (model != null && v == null) {
          ref.read(openCodeVariantProvider.notifier).clearVariant(model);
        }
      };
    }
    if (isClaudeCode) {
      return (v) => ref.read(claudeCodeVariantProvider.notifier).setVariant(v);
    }
    if (isCodex) return onSetCodexReasoningEffort;
    if (isPi) return onSetPiThinkingLevel;
    return null;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inputStyle = ref.watch(inputStyleProvider);
    // Busy logic per agent:
    // - CC: busy only if streaming AND already has a queued message (allow 1 queue)
    // - Codex: never busy — if streaming, _sendMessage steers the agent mid-turn
    // - OpenCode: never busy — SDK's promptAsync() queues server-side
    final pendingCCMessage = isClaudeCode
        ? ref.watch(chatSessionProvider.select((s) => s.pendingCCMessage))
        : null;
    final isBusy = isClaudeCode
        ? (ccIsStreaming && pendingCCMessage != null)
        : false;
    final hasContent =
        controller.text.trim().isNotEmpty || attachedFiles.isNotEmpty;
    final canSend =
        connection.isConnected &&
        !connection.isOfflineMode &&
        !isBusy &&
        hasContent;
    // Get CC config for Claude Code mode
    final ccConfig = isClaudeCode
        ? ref.watch(ccConfigProvider).valueOrNull
        : null;
    // Get custom prompt accent color and glow style
    final promptAccent = ref.watch(promptAccentProvider);
    final glowStyle = ref.watch(glowStyleProvider);
    final theme = OpenCodeTheme.of(context);
    final customAccent = promptAccent == PromptAccentColor.themePrimary
        ? null
        : promptAccent.getColor(theme.primary);
    // Determine backend type
    final backend = isClaudeCode
        ? AgentType.claudeCode
        : isCodex
        ? AgentType.codex
        : isPi
        ? AgentType.pi
        : AgentType.opencode;
    // Build project for power sheet
    final powerProject = isOpenCode
        ? project
        : ProjectSummary(id: '', name: projectName, path: effectivePath);

    // Shared variant values
    final variant = _currentVariant(ref);
    final variants = _availableVariants(ref);
    final variantChanged = _onVariantChanged(ref);
    // CC permission mode change callback
    final ccPermModeChanged = isClaudeCode
        ? (ClaudeCodePermissionMode mode) =>
              _handleCCPermissionModeChanged(context, ref, mode)
        : null;

    if (inputStyle == InputBarStyle.cli) {
      return CliStyleInputBar(
        controller: controller,
        focusNode: focusNode,
        onSend: onSend,
        isBusy: isBusy,
        canSend: canSend,
        backend: backend,
        project: powerProject,
        isOfflineMode: connection.isOfflineMode,
        currentAgent: isOpenCode ? selectedAgent : null,
        agents: isOpenCode ? agents : const [],
        onAgentChanged: isOpenCode ? onAgentChanged : null,
        currentModel: isOpenCode ? ref.watch(selectionProvider).model : null,
        onModelTap: onModelTap,
        attachedFiles: attachedFiles,
        onRemoveAttachment: onRemoveAttachment,
        showFileAutocomplete: showFileAutocomplete,
        onFileSelect: onFileSelect,
        onAttachTap: onAttachTap,
        onTakePhoto: onTakePhoto,
        attachIcon: AppIcons.add,
        // Claude Code specific
        ccPermissionMode: isClaudeCode
            ? (ccConfig?.permissionMode ?? ccInit?.permissionMode)
            : null,
        ccModel: isClaudeCode
            ? (ccConfig?.model ??
                  ccModel ??
                  ccInit?.model ??
                  ccSessionModel ??
                  ccDraftModel)
            : null,
        onCCModelTap: isClaudeCode ? onModelTap : null,
        onCCPermissionModeChanged: ccPermModeChanged,
        // Codex specific
        codexModel: isCodex
            ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
            : null,
        onCodexModelTap: isCodex ? onModelTap : null,
        // Codex Collaboration Mode (SDK v0.87.0+)
        codexCollabMode: isCodex
            ? ref.watch(codexSettingsProvider).collaborationMode
            : null,
        onCodexCollabModeChanged: isCodex
            ? (mode) => ref
                  .read(codexSettingsProvider.notifier)
                  .setCollaborationMode(mode)
            : null,
        customAccentColor: customAccent,
        glowStyle: glowStyle,
        // Variant/Thinking Level
        currentVariant: variant,
        availableVariants: variants,
        onVariantChanged: variantChanged,
      );
    }

    // FloatingInputBar
    return FloatingInputBar(
      controller: controller,
      focusNode: focusNode,
      onSend: onSend,
      isBusy: isBusy,
      canSend: canSend,
      backend: backend,
      project: powerProject,
      isOfflineMode: connection.isOfflineMode,
      attachedFiles: attachedFiles,
      onRemoveAttachment: onRemoveAttachment,
      showFileAutocomplete: showFileAutocomplete,
      onFileSelect: onFileSelect,
      onAttachTap: onAttachTap,
      onTakePhoto: onTakePhoto,
      attachIcon: AppIcons.add,
      // Model selector
      currentModel: isClaudeCode
          ? ref.watch(chatSessionProvider.select((s) => s.ccModel))
          : isCodex
          ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
          : isPi
          ? ref.watch(chatSessionProvider.select((s) => s.piModel))
          : ref.watch(selectionProvider).model?.displayString,
      onModelTap: onModelTap,
      // OpenCode specific
      agents: isOpenCode ? agents : const [],
      currentAgent: isOpenCode ? selectedAgent : null,
      onAgentChanged: isOpenCode ? onAgentChanged : null,
      // Claude Code specific
      ccPermissionMode: isClaudeCode
          ? (ref.watch(ccConfigProvider).valueOrNull?.permissionMode ??
                ref
                    .watch(chatSessionProvider.select((s) => s.ccInit))
                    ?.permissionMode)
          : null,
      onCCPermissionModeChanged: ccPermModeChanged,
      // Codex specific
      codexCollabMode: isCodex
          ? ref.watch(codexSettingsProvider).collaborationMode
          : null,
      onCodexCollabModeChanged: isCodex
          ? (mode) => ref
                .read(codexSettingsProvider.notifier)
                .setCollaborationMode(mode)
          : null,
      // Variant/Thinking Level
      currentVariant: variant,
      availableVariants: variants,
      onVariantChanged: variantChanged,
      // Glow style and accent color
      glowStyle: glowStyle,
      accentColor: customAccent,
    );
  }
}
