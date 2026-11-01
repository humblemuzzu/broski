import 'package:broski/models/claude_code.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/prompt_accent_color.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/claude_code_variant_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/glow_style_provider.dart';
import 'package:broski/providers/input_style_provider.dart';
import 'package:broski/providers/prompt_accent_provider.dart';
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
    required this.projectName,
    required this.effectivePath,
    this.ccSessionModel,
    this.ccDraftModel,
    required this.onSend,
    required this.onRemoveAttachment,
    required this.onFileSelect,
    required this.onAttachTap,
    required this.onTakePhoto,
    required this.onModelTap,
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

  // --- Project info ---
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
  final VoidCallback onModelTap;
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

  /// The selected thinking level.
  String? _currentVariant(WidgetRef ref) =>
      ref.watch(claudeCodeVariantProvider).selectedVariant;

  /// The thinking levels the current model supports, from the SDK's init data.
  List<String> _availableVariants(WidgetRef ref) {
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

  void _onVariantChanged(WidgetRef ref, String? v) =>
      ref.read(claudeCodeVariantProvider.notifier).setVariant(v);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inputStyle = ref.watch(inputStyleProvider);
    // Busy only while streaming with a message already queued (one queue slot).
    final pendingCCMessage = ref.watch(
      chatSessionProvider.select((s) => s.pendingCCMessage),
    );
    final isBusy = ccIsStreaming && pendingCCMessage != null;
    final hasContent =
        controller.text.trim().isNotEmpty || attachedFiles.isNotEmpty;
    final canSend =
        connection.isConnected &&
        !connection.isOfflineMode &&
        !isBusy &&
        hasContent;
    final ccConfig = ref.watch(ccConfigProvider).valueOrNull;
    final promptAccent = ref.watch(promptAccentProvider);
    final glowStyle = ref.watch(glowStyleProvider);
    final theme = OpenCodeTheme.of(context);
    final customAccent = promptAccent == PromptAccentColor.themePrimary
        ? null
        : promptAccent.getColor(theme.primary);
    final powerProject = ProjectSummary(
      id: '',
      name: projectName,
      path: effectivePath,
    );

    final variant = _currentVariant(ref);
    final variants = _availableVariants(ref);
    void variantChanged(String? v) => _onVariantChanged(ref, v);

    // Permission mode chip: the SDK's fixed PermissionMode values.
    final ccPerm =
        ccConfig?.permissionMode ??
        ref.watch(chatSessionProvider.select((s) => s.ccInit))?.permissionMode;
    final currentMode = ccPerm?.wireValue;
    final modeOptions = {
      for (final m in ClaudeCodePermissionMode.values)
        m.wireValue: m.displayName,
    };
    void onModeChanged(String wireValue) {
      final mode = ClaudeCodePermissionMode.fromWireValue(wireValue);
      _handleCCPermissionModeChanged(context, ref, mode);
    }

    // Fast mode: shown when the current model supports it (SDK init data).
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.ccCwd ?? effectivePath;
    final modelsAsync = ref.watch(ccSupportedModelsProvider(cwd));
    final modelDisplay =
        ccConfig?.model ??
        ccModel ??
        ccInit?.model ??
        ccSessionModel ??
        ccDraftModel;
    final models = modelsAsync.valueOrNull ?? const [];
    final currentModelInfo = (models.isNotEmpty && modelDisplay != null)
        ? models.cast<ClaudeCodeSupportedModel?>().firstWhere(
            (m) => m!.value == modelDisplay,
            orElse: () => null,
          )
        : null;
    final showFastToggle = currentModelInfo?.supportsFastMode == true;
    final fastEnabled = chatState.ccInit?.fastModeState == 'on';
    final void Function(bool)? onFastChanged = showFastToggle
        ? (enabled) {
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

    if (inputStyle == InputBarStyle.cli) {
      return CliStyleInputBar(
        controller: controller,
        focusNode: focusNode,
        onSend: onSend,
        isBusy: isBusy,
        canSend: canSend,
        project: powerProject,
        isOfflineMode: connection.isOfflineMode,
        onModelTap: onModelTap,
        attachedFiles: attachedFiles,
        onRemoveAttachment: onRemoveAttachment,
        showFileAutocomplete: showFileAutocomplete,
        onFileSelect: onFileSelect,
        onAttachTap: onAttachTap,
        onTakePhoto: onTakePhoto,
        attachIcon: AppIcons.add,
        ccPermissionMode: ccConfig?.permissionMode ?? ccInit?.permissionMode,
        ccModel: modelDisplay,
        onCCModelTap: onModelTap,
        customAccentColor: customAccent,
        glowStyle: glowStyle,
        currentVariant: variant,
        availableVariants: variants,
        onVariantChanged: variantChanged,
        onMenuTap: onMenuTap,
        modelDisplay: modelDisplay,
        currentMode: currentMode,
        modeOptions: modeOptions,
        onModeChanged: onModeChanged,
        showFastToggle: showFastToggle,
        fastEnabled: fastEnabled,
        onFastChanged: onFastChanged,
      );
    }

    return FloatingInputBar(
      controller: controller,
      focusNode: focusNode,
      onSend: onSend,
      isBusy: isBusy,
      canSend: canSend,
      project: powerProject,
      isOfflineMode: connection.isOfflineMode,
      attachedFiles: attachedFiles,
      onRemoveAttachment: onRemoveAttachment,
      showFileAutocomplete: showFileAutocomplete,
      onFileSelect: onFileSelect,
      onAttachTap: onAttachTap,
      onTakePhoto: onTakePhoto,
      attachIcon: AppIcons.add,
      currentModel: modelDisplay,
      onModelTap: onModelTap,
      currentVariant: variant,
      availableVariants: variants,
      onVariantChanged: variantChanged,
      glowStyle: glowStyle,
      accentColor: customAccent,
      onMenuTap: onMenuTap,
      currentMode: currentMode,
      modeOptions: modeOptions,
      onModeChanged: onModeChanged,
      showFastToggle: showFastToggle,
      fastEnabled: fastEnabled,
      onFastChanged: onFastChanged,
    );
  }
}
