import 'dart:async';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/agent/pickers/session_settings_fields.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:broski/widgets/chat/section_header.dart';
import 'package:broski/widgets/sessions/session_card_text.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Starts a session in a directory on the Mac, with the model, thinking and
/// modes the backend offers there (contract §11.3, §11.5). With [directory]
/// the sheet opens in it, as a project the person tapped; the directories the
/// backend already works in are offered under it.
void showNewSessionSheet(
  BuildContext context,
  BackendDescriptor backend, {
  String? directory,
}) => DetailSheet.show<void>(
  context: context,
  title: 'New session',
  initialSize: 0.7,
  child: _NewSessionForm(backend: backend, directory: directory),
);

class _NewSessionForm extends ConsumerStatefulWidget {
  const _NewSessionForm({required this.backend, this.directory});

  final BackendDescriptor backend;
  final String? directory;

  @override
  ConsumerState<_NewSessionForm> createState() => _NewSessionFormState();
}

class _NewSessionFormState extends ConsumerState<_NewSessionForm> {
  late final _cwd = TextEditingController(text: widget.directory);
  late String? _directory = widget.directory;
  var _settings = const SessionSettingsChoice();
  var _creating = false;

  @override
  void initState() {
    super.initState();
    final directories = ref.read(
      directoriesProvider(widget.backend.id).notifier,
    );
    unawaited(directories.load());
  }

  @override
  void dispose() {
    _cwd.dispose();
    super.dispose();
  }

  void _useDirectory(String value) {
    final trimmed = value.trim();
    setState(() {
      _directory = trimmed.isEmpty ? null : trimmed;
      _settings = const SessionSettingsChoice();
    });
  }

  Future<void> _create() async {
    final directory = _directory;
    if (directory == null) return;
    setState(() => _creating = true);
    final outcome = await SessionActions(
      ref.read(contractClientProvider),
    ).create(widget.backend.id, _settings.options(directory));
    if (!mounted) return;
    setState(() => _creating = false);
    switch (outcome) {
      case Done(value: final session):
        final navigator = Navigator.of(context)..pop();
        await navigator.push(
          MaterialPageRoute<void>(
            builder: (_) => AgentChatScreen(session: session),
          ),
        );
      case Refused() || Unreached():
        showProblem(context, problemOf(outcome));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final directory = _directory;
    final projects = ref.watch(directoriesProvider(widget.backend.id));
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(title: 'DIRECTORY', theme: theme),
          const SizedBox(height: Spacing.sm),
          _DirectoryField(controller: _cwd, onSubmitted: _useDirectory),
          if (projects.directories.isNotEmpty) ...[
            const SizedBox(height: Spacing.xl),
            SectionHeader(title: 'PROJECTS WITH SESSIONS', theme: theme),
            const SizedBox(height: Spacing.sm),
            for (final project in projects.directories)
              FilterProjectTile(
                key: ValueKey('new-session-project:${project.cwd}'),
                name: sessionProjectName(project.cwd),
                path: project.cwd,
                isSelected: project.cwd == directory,
                onTap: () => _choose(project.cwd),
              ),
          ],
          if (directory != null) ...[
            const SizedBox(height: Spacing.xl),
            SectionHeader(title: 'SESSION', theme: theme),
            const SizedBox(height: Spacing.sm),
            SessionSettingsFields(
              backend: widget.backend,
              cwd: directory,
              choice: _settings,
              onChanged: (choice) => setState(() => _settings = choice),
            ),
          ],
          const SizedBox(height: Spacing.xl),
          _StartButton(
            enabled: directory != null && !_creating,
            creating: _creating,
            onPressed: _create,
          ),
        ],
      ),
    );
  }

  void _choose(String path) {
    _cwd.text = path;
    _useDirectory(path);
  }
}

class _DirectoryField extends StatelessWidget {
  const _DirectoryField({required this.controller, required this.onSubmitted});

  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    OutlineInputBorder border(Color color) => OutlineInputBorder(
      borderRadius: Radii.brMd,
      borderSide: BorderSide(color: color),
    );
    return TextField(
      key: const ValueKey('new-session-cwd'),
      controller: controller,
      style: TextStyle(color: theme.text),
      decoration: InputDecoration(
        hintText: '/Users/you/project',
        hintStyle: TextStyle(color: theme.textMuted),
        filled: true,
        fillColor: theme.backgroundElement,
        border: border(theme.borderSubtle),
        enabledBorder: border(theme.borderSubtle),
        focusedBorder: border(theme.primary),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 12,
        ),
        suffixIcon: Tooltip(
          message: 'Use this directory',
          child: InkWell(
            onTap: () => onSubmitted(controller.text),
            borderRadius: Radii.brSm,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Icon(AppIcons.check, size: 18, color: theme.primary),
            ),
          ),
        ),
      ),
      onSubmitted: onSubmitted,
    );
  }
}

class _StartButton extends StatelessWidget {
  const _StartButton({
    required this.enabled,
    required this.creating,
    required this.onPressed,
  });

  final bool enabled;
  final bool creating;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ElevatedButton(
      onPressed: enabled ? onPressed : null,
      style: ElevatedButton.styleFrom(
        backgroundColor: theme.primary,
        foregroundColor: theme.selectedListItemText,
        disabledBackgroundColor: theme.backgroundElement,
        disabledForegroundColor: theme.textMuted,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
      ),
      child: Text(
        creating ? 'Starting\u2026' : 'Start',
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    );
  }
}
