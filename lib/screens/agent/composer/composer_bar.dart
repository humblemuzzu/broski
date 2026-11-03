import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/glow_style.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/prompt_accent_color.dart';
import 'package:broski/providers/glow_style_provider.dart';
import 'package:broski/providers/input_style_provider.dart';
import 'package:broski/providers/prompt_accent_provider.dart';
import 'package:broski/screens/agent/composer/composer_settings.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/cli_input_bar.dart';
import 'package:broski/widgets/chat/floating_input_bar.dart';
import 'package:broski/widgets/chat/input_bar_keys.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The keys the shared chat gives the input bar's controls.
const composerKeys = InputBarKeys(
  text: ValueKey('composer-text'),
  send: ValueKey('composer-send'),
  model: ValueKey('chat-settings'),
  attach: ValueKey('composer-attach'),
  menu: ValueKey('chat-actions'),
);

/// What the input bar is handed besides its text: the actions behind its
/// buttons and chips, and the chips' values.
typedef ComposerBarActions = ({
  bool canSend,
  VoidCallback onSend,
  VoidCallback? onLongPressSend,
  VoidCallback? onAttach,
  VoidCallback onModel,
  VoidCallback? onMenu,
  ValueChanged<String?> onThinking,
  ValueChanged<String> onMode,
  List<FileAttachment> chips,
  ValueChanged<FileAttachment> onRemoveChip,
  bool showFiles,
  ValueChanged<FileAttachment> onFile,
});

typedef _Look = ({GlowStyle glow, Color? accent, Map<String, String> modes});

/// The app's input bar in the style the person chose in Settings (floating
/// or terminal), driven by the session's settings and [actions].
class ComposerBar extends ConsumerWidget {
  const ComposerBar({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.project,
    required this.settings,
    required this.actions,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ProjectSummary project;
  final ComposerSettings settings;
  final ComposerBarActions actions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accent = ref.watch(promptAccentProvider);
    final look = (
      glow: ref.watch(glowStyleProvider),
      accent: accent == PromptAccentColor.themePrimary
          ? null
          : accent.getColor(OpenCodeTheme.of(context).primary),
      modes: <String, String>{
        for (final option in settings.modeAxis?.options ?? const <Option>[])
          option.value: option.label,
      },
    );
    return ref.watch(inputStyleProvider) == InputBarStyle.cli
        ? _terminal(look)
        : _floating(look);
  }

  Widget _terminal(_Look look) => CliStyleInputBar(
    keys: composerKeys,
    controller: controller,
    focusNode: focusNode,
    onSend: actions.onSend,
    onLongPressSend: actions.onLongPressSend,
    isBusy: false,
    canSend: actions.canSend,
    project: project,
    onModelTap: actions.onModel,
    modelDisplay: settings.model,
    attachedFiles: actions.chips,
    onRemoveAttachment: actions.onRemoveChip,
    showFileAutocomplete: actions.showFiles,
    onFileSelect: actions.onFile,
    onAttachTap: actions.onAttach,
    customAccentColor: look.accent,
    glowStyle: look.glow,
    currentVariant: settings.thinking,
    availableVariants: settings.thinkingLevels,
    onVariantChanged: actions.onThinking,
    onMenuTap: actions.onMenu,
    currentMode: settings.mode,
    modeOptions: look.modes,
    onModeChanged: actions.onMode,
  );

  Widget _floating(_Look look) => FloatingInputBar(
    keys: composerKeys,
    controller: controller,
    focusNode: focusNode,
    onSend: actions.onSend,
    onLongPressSend: actions.onLongPressSend,
    isBusy: false,
    canSend: actions.canSend,
    project: project,
    currentModel: settings.model,
    onModelTap: actions.onModel,
    attachedFiles: actions.chips,
    onRemoveAttachment: actions.onRemoveChip,
    showFileAutocomplete: actions.showFiles,
    onFileSelect: actions.onFile,
    onAttachTap: actions.onAttach,
    glowStyle: look.glow,
    accentColor: look.accent,
    currentVariant: settings.thinking,
    availableVariants: settings.thinkingLevels,
    onVariantChanged: actions.onThinking,
    onMenuTap: actions.onMenu,
    currentMode: settings.mode,
    modeOptions: look.modes,
    onModeChanged: actions.onMode,
  );
}
