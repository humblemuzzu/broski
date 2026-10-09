import 'package:broski/models/agent.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/prompt_accent_color.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/claude_code_variant_provider.dart';
import 'package:broski/providers/codex_provider.dart';
import 'package:broski/providers/codex_settings_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/glow_style_provider.dart';
import 'package:broski/providers/input_style_provider.dart';
import 'package:broski/providers/opencode_variant_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/prompt_accent_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/cli_input_bar.dart';
import 'package:broski/widgets/chat/floating_input_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
    this.isPiDurable = false,
    this.selectedAgent,
    this.agents = const [],
    required this.project,
    required this.projectName,
    required this.effectivePath,
    this.ccSessionModel,
    this.ccDraftModel,
    required this.onSend,
    this.onLongPressSend,
    required this.onRemoveAttachment,
    required this.onFileSelect,
    required this.onAttachTap,
    required this.onTakePhoto,
    required this.onAgentChanged,
    required this.onModelTap,
    required this.onSetCodexReasoningEffort,
    required this.onSetPiThinkingLevel,
    this.onMenuTap,
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
  final bool isPiDurable;
  bool get isOpenCode => !isClaudeCode && !isCodex && !isPi && !isPiDurable;

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
  final VoidCallback? onLongPressSend;
  final void Function(FileAttachment) onRemoveAttachment;
  final void Function(FileAttachment) onFileSelect;
  final VoidCallback onAttachTap;
  final VoidCallback onTakePhoto;
  final void Function(String?) onAgentChanged;
  final VoidCallback onModelTap;
  final void Function(String?) onSetCodexReasoningEffort;
  final void Function(String?) onSetPiThinkingLevel;
  final VoidCallback? onMenuTap;

  /// Handles CC permission mode change: persists config and optionally applies
  /// to the live session.
  Future<void> _handleCCPermissionModeChanged(
    BuildContext context,
    WidgetRef ref,
    ClaudeCodePermissionMode mode,
  ) async {
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
    if (ok) {
      showSuccess(context, 'Permission mode applied to current Claude turn.');
    } else {
      showInfo(context, 'Saved as default. Live turn update failed.');
    }
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
    if (isPiDurable) {
      return ref
          .watch(chatSessionProvider.select((s) => s.pdThinkingLevel))
          ?.wireValue;
    }
    return null;
  }

  /// Resolves the list of available variants for the active agent.
  /// All backends use dynamic per-model data from their respective SDKs.
  List<String> _availableVariants(WidgetRef ref) {
    if (isOpenCode) {
      return ref
          .watch(openCodeVariantProvider)
          .getAvailableVariants(ref.watch(selectionProvider).model);
    }
    if (isClaudeCode) {
      // Dynamic: use per-model supportedEffortLevels from CC SDK init data
      final chatState = ref.read(chatSessionProvider);
      final cwd = chatState.ccCwd ?? effectivePath;
      final modelsAsync = ref.watch(ccSupportedModelsProvider(cwd));
      final currentModel =
          ref.watch(ccConfigProvider).valueOrNull?.model ??
          chatState.ccModel ??
          chatState.ccInit?.model ??
          ccSessionModel ??
          ccDraftModel;
      final models = modelsAsync.valueOrNull ?? const [];
      if (models.isNotEmpty && currentModel != null) {
        // Find the current model's supported effort levels
        final match = models.cast<ClaudeCodeSupportedModel?>().firstWhere(
          (m) => m!.value == currentModel,
          orElse: () => null,
        );
        if (match != null &&
            match.supportedEffortLevels != null &&
            match.supportedEffortLevels!.isNotEmpty) {
          return match.supportedEffortLevels!;
        }
      }
      // Fallback: all effort levels from models that support effort
      final allEfforts = models
          .where((m) => m.supportedEffortLevels != null)
          .expand((m) => m.supportedEffortLevels!)
          .toSet()
          .toList();
      if (allEfforts.isNotEmpty) return allEfforts;
      // Last resort: standard CC effort levels (protocol-defined)
      return const ['low', 'medium', 'high', 'max'];
    }
    if (isCodex) {
      // Dynamic: use per-model supportedReasoningEfforts from Codex model/list API
      final currentModel = ref.watch(
        chatSessionProvider.select((s) => s.cxModel),
      );
      final modelsAsync = ref.watch(codexModelsProvider);
      final models = modelsAsync.valueOrNull ?? const [];
      if (models.isNotEmpty && currentModel != null) {
        final match = models.cast<CodexModel?>().firstWhere(
          (m) => m!.id == currentModel,
          orElse: () => null,
        );
        if (match != null && match.supportedReasoningEfforts.isNotEmpty) {
          return match.supportedReasoningEfforts;
        }
      }
      // Fallback: standard Codex reasoning efforts (protocol-defined)
      return CodexReasoningEffort.values.map((e) => e.wireValue).toList();
    }
    if (isPi) {
      // Dynamic: use per-model available levels from bridge
      final cwd = ref.read(chatSessionProvider).piCwd ?? effectivePath;
      final capsAsync = ref.watch(piThinkingCapabilitiesProvider(cwd));
      final caps = capsAsync.valueOrNull;
      if (caps != null && caps.availableLevels.isNotEmpty) {
        return caps.availableLevels.map((l) => l.wireValue).toList();
      }
      // Fallback: standard Pi thinking levels (protocol-defined)
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
        : isPiDurable
        ? AgentType.piDurable
        : AgentType.opencode;
    // Build project for power sheet
    final powerProject = isOpenCode
        ? project
        : ProjectSummary(id: '', name: projectName, path: effectivePath);

    // Shared variant values
    final variant = _currentVariant(ref);
    final variants = _availableVariants(ref);
    final variantChanged = _onVariantChanged(ref);

    // Permission/mode chip data (CC/CX only — protocol-defined modes from SDK)
    // CC: PermissionMode from SDK type system (5 fixed modes)
    // CX: AskForApproval from SDK protocol (4 fixed policies)
    final String? currentMode;
    final Map<String, String> modeOptions;
    final void Function(String)? onModeChanged;
    if (isClaudeCode) {
      final ccPerm =
          ccConfig?.permissionMode ??
          ref
              .watch(chatSessionProvider.select((s) => s.ccInit))
              ?.permissionMode;
      currentMode = ccPerm?.wireValue;
      modeOptions = {
        for (final m in ClaudeCodePermissionMode.values)
          m.wireValue: m.displayName,
      };
      onModeChanged = (wireValue) {
        final mode = ClaudeCodePermissionMode.fromWireValue(wireValue);
        _handleCCPermissionModeChanged(context, ref, mode);
      };
    } else if (isCodex) {
      // Codex: approval policy (permission equivalent), not collab mode
      final cxApproval = ref.watch(codexSettingsProvider).approvalPolicy;
      currentMode = cxApproval.wireValue;
      modeOptions = {
        for (final m in CodexApprovalPolicy.values) m.wireValue: m.displayName,
      };
      onModeChanged = (wireValue) {
        final policy = CodexApprovalPolicy.values.firstWhere(
          (p) => p.wireValue == wireValue,
          orElse: () => CodexApprovalPolicy.onRequest,
        );
        ref.read(codexSettingsProvider.notifier).setApprovalPolicy(policy);
      };
    } else {
      currentMode = null;
      modeOptions = const {};
      onModeChanged = null;
    }

    // Fast mode data (CC/CX only, per-model from SDK)
    final bool showFastToggle;
    final bool fastEnabled;
    final void Function(bool)? onFastChanged;
    if (isClaudeCode) {
      // CC: check if current model supports fast mode from SDK init data
      final chatState = ref.read(chatSessionProvider);
      final cwd = chatState.ccCwd ?? effectivePath;
      final modelsAsync = ref.watch(ccSupportedModelsProvider(cwd));
      final currentModelStr =
          ccConfig?.model ??
          chatState.ccModel ??
          chatState.ccInit?.model ??
          ccSessionModel ??
          ccDraftModel;
      final models = modelsAsync.valueOrNull ?? const [];
      final currentModelInfo = (models.isNotEmpty && currentModelStr != null)
          ? models.cast<ClaudeCodeSupportedModel?>().firstWhere(
              (m) => m!.value == currentModelStr,
              orElse: () => null,
            )
          : null;
      showFastToggle = currentModelInfo?.supportsFastMode == true;
      // Fast mode state from init message
      fastEnabled = chatState.ccInit?.fastModeState == 'on';
      onFastChanged = showFastToggle
          ? (enabled) {
              // Toggle via ccApplySettings (same as quick settings sheet)
              final sid = chatState.ccSessionId;
              if (sid != null && sid.isNotEmpty) {
                ref
                    .read(bridgeServiceProvider)
                    .ccApplySettings(
                      sessionId: sid,
                      settings: {'fastMode': enabled},
                    );
              }
            }
          : null;
    } else if (isCodex) {
      // CX: service tier fast/flex from settings
      showFastToggle = true; // Codex always supports fast mode
      final cxSettings = ref.watch(codexSettingsProvider);
      fastEnabled = cxSettings.serviceTier == CodexServiceTier.fast;
      onFastChanged = (enabled) {
        ref
            .read(codexSettingsProvider.notifier)
            .setServiceTier(
              enabled ? CodexServiceTier.fast : CodexServiceTier.flex,
            );
      };
    } else {
      showFastToggle = false;
      fastEnabled = false;
      onFastChanged = null;
    }

    // Unified model display string for all backends
    final modelDisplay = isClaudeCode
        ? (ccConfig?.model ??
              ccModel ??
              ccInit?.model ??
              ccSessionModel ??
              ccDraftModel)
        : isCodex
        ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
        : isPi
        ? ref.watch(chatSessionProvider.select((s) => s.piModel))
        : isPiDurable
        ? ref.watch(chatSessionProvider.select((s) => s.pdModel))
        : ref.watch(selectionProvider).model?.displayString;

    if (inputStyle == InputBarStyle.cli) {
      return CliStyleInputBar(
        controller: controller,
        focusNode: focusNode,
        onSend: onSend,
        onLongPressSend: onLongPressSend,
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
        // Codex specific
        codexModel: isCodex
            ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
            : null,
        onCodexModelTap: isCodex ? onModelTap : null,
        customAccentColor: customAccent,
        glowStyle: glowStyle,
        // Variant/Thinking Level
        currentVariant: variant,
        availableVariants: variants,
        onVariantChanged: variantChanged,
        // ⋯ menu
        onMenuTap: onMenuTap,
        modelDisplay: modelDisplay,
        // Permission/mode chip
        currentMode: currentMode,
        modeOptions: modeOptions,
        onModeChanged: onModeChanged,
        // Fast mode
        showFastToggle: showFastToggle,
        fastEnabled: fastEnabled,
        onFastChanged: onFastChanged,
      );
    }

    // FloatingInputBar
    return FloatingInputBar(
      controller: controller,
      focusNode: focusNode,
      onSend: onSend,
      onLongPressSend: onLongPressSend,
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
      currentModel: modelDisplay,
      onModelTap: onModelTap,
      // Variant/Thinking Level
      currentVariant: variant,
      availableVariants: variants,
      onVariantChanged: variantChanged,
      // Glow style and accent color
      glowStyle: glowStyle,
      accentColor: customAccent,
      // ⋯ menu
      onMenuTap: onMenuTap,
      // Permission/mode chip
      currentMode: currentMode,
      modeOptions: modeOptions,
      onModeChanged: onModeChanged,
      // Fast mode
      showFastToggle: showFastToggle,
      fastEnabled: fastEnabled,
      onFastChanged: onFastChanged,
    );
  }
}
