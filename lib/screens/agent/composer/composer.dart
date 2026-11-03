import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/file_search_provider.dart';
import 'package:broski/screens/agent/composer/composer_attach_sheet.dart';
import 'package:broski/screens/agent/composer/composer_autocomplete.dart';
import 'package:broski/screens/agent/composer/composer_bar.dart';
import 'package:broski/screens/agent/composer/composer_extras.dart';
import 'package:broski/screens/agent/composer/composer_notes.dart';
import 'package:broski/screens/agent/composer/composer_rules.dart';
import 'package:broski/screens/agent/composer/composer_settings.dart';
import 'package:broski/screens/agent/composer/prompt_suggestion_chip.dart';
import 'package:broski/screens/agent/composer/shell_command.dart';
import 'package:broski/screens/agent/pickers/live_settings_sheet.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart'
    show showProblem;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Where a prompt is written, in the app's input bar: the modes, extras,
/// mentions and commands the backend takes, and nothing it does not
/// (contract §6, §10).
class Composer extends ConsumerStatefulWidget {
  const Composer({
    super.key,
    required this.session,
    required this.state,
    required this.capabilities,
    required this.text,
    this.onMenu,
  });

  final SessionRef session;
  final AgentSessionState state;
  final Capabilities capabilities;
  final TextEditingController text;
  final VoidCallback? onMenu;

  @override
  ConsumerState<Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<Composer> {
  final _focus = FocusNode();
  var _extras = const ComposerExtras();
  PromptMode? _mode;

  String? get _cwd => widget.state.summary?.cwd;

  @override
  void initState() {
    super.initState();
    widget.text.addListener(_typed);
  }

  @override
  void dispose() {
    widget.text.removeListener(_typed);
    _focus.dispose();
    super.dispose();
  }

  void _typed() {
    setState(() {});
    final query = mentionQuery(widget.text.text);
    final cwd = _cwd;
    if (query == null || cwd == null || !_mentionsFiles) return;
    ref.read(fileSearchProvider.notifier)
      ..setProjectPath(cwd)
      ..search(query);
  }

  bool get _mentionsFiles =>
      widget.capabilities.mentions.contains(MentionKind.file);

  Future<void> _send(PromptMode mode) async {
    final draft = PromptDraft(
      mode: mode,
      text: widget.text.text,
      attachments: _extras.attachments,
      mentions: _extras.mentions,
      command: _extras.command?.id,
    );
    widget.text.clear();
    setState(() => _extras = const ComposerExtras());
    await ref
        .read(sessionProvider(widget.session).notifier)
        .prompts
        .send(draft);
  }

  Future<void> _runShell(ShellCommand shell) async {
    final problem = await startShellCommand(
      ref.read(contractClientProvider),
      widget.session,
      shell,
    );
    if (!mounted) return;
    if (problem == null) {
      widget.text.clear();
    } else {
      showProblem(context, problem);
    }
  }

  void _pickCommand(CommandSummary command) {
    widget.text.clear();
    setState(() => _extras = _extras.withCommand(command));
  }

  void _pickFile(FileAttachment file) {
    final text = withoutMentionQuery(widget.text.text);
    widget.text.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    ref.read(fileSearchProvider.notifier).clear();
    setState(() => _extras = _extras.withMention(FileMention(path: file.path)));
  }

  void _attach() => showComposerAttachSheet(
    context,
    session: widget.session,
    cwd: _cwd,
    capabilities: widget.capabilities,
    onAdd: (add) => setState(() => _extras = add(_extras)),
  );

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final capabilities = widget.capabilities;
    final shell = offersShell(capabilities) && _extras.attachments.isEmpty
        ? shellCommandOf(widget.text.text)
        : null;
    final modes = composerModes(capabilities, running: state.running);
    final mode = modes.contains(_mode) ? _mode : modes.firstOrNull;
    final slash = capabilities.commands ? slashFilter(widget.text.text) : null;
    return Column(
      key: const ValueKey('composer'),
      mainAxisSize: MainAxisSize.min,
      children: [
        PromptSuggestionChip(state: state, text: widget.text),
        if (slash != null)
          SlashCommandsPopup(
            session: widget.session,
            cwd: _cwd,
            filter: slash,
            onPick: _pickCommand,
          ),
        if (modes.length > 1)
          ModeToggle(
            modes: modes,
            selected: mode,
            onChanged: (picked) => setState(() => _mode = picked),
          ),
        if (_extras.command case final command?)
          CommandNote(
            command: command,
            onClear: () => setState(() => _extras = _extras.withCommand(null)),
          ),
        if (shell != null) ShellNote(shell: shell, running: state.running),
        _bar(modes, mode, shell),
        if (mode == null) const NoInputNote(),
      ],
    );
  }

  Widget _bar(List<PromptMode> modes, PromptMode? mode, ShellCommand? shell) {
    final settings = composerSettings(ref, widget.state, widget.capabilities);
    final cwd = _cwd ?? '';
    return ComposerBar(
      controller: widget.text,
      focusNode: _focus,
      project: ProjectSummary(id: '', name: _folderName(cwd), path: cwd),
      settings: settings,
      actions: _actions(modes, mode, shell, settings.modeAxis),
    );
  }

  ComposerBarActions _actions(
    List<PromptMode> modes,
    PromptMode? mode,
    ShellCommand? shell,
    ModeAxis? axis,
  ) {
    final problem = composerProblem(
      text: widget.text.text,
      attachments: _extras.attachments,
      command: _extras.command?.id,
    );
    final controls = ref
        .read(sessionProvider(widget.session).notifier)
        .controls;
    final other = modes.where((option) => option != mode).firstOrNull;
    final chips = _extras.chips;
    return (
      canSend: shell != null
          ? !widget.state.running
          : mode != null && problem == null,
      onSend: () => shell != null ? _runShell(shell) : _send(mode!),
      onLongPressSend: shell == null && other != null
          ? () => _send(other)
          : null,
      onAttach: takesExtras(widget.capabilities) ? _attach : null,
      onModel: () =>
          showLiveSettings(context, widget.session, widget.capabilities),
      onMenu: widget.onMenu,
      onThinking: (level) {
        if (level != null) controls.setThinking(level);
      },
      onMode: (value) {
        if (axis != null) controls.setMode(axis.id, value);
      },
      chips: [for (final (chip, _) in chips) chip],
      onRemoveChip: (chip) => setState(() {
        final held = chips.firstWhere((pair) => identical(pair.$1, chip));
        _extras = _extras.without(held.$2);
      }),
      showFiles: _mentionsFiles && mentionQuery(widget.text.text) != null,
      onFile: _pickFile,
    );
  }
}

String _folderName(String path) =>
    path.split('/').where((part) => part.isNotEmpty).lastOrNull ?? '';
