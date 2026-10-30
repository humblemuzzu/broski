import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/pickers/session_settings_fields.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Starts a session in a directory on the Mac, with the model, thinking and
/// modes the backend offers there (contract §11.3, §11.5). With [directory]
/// the sheet opens in it, as a project the person tapped.
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
  void dispose() {
    _cwd.dispose();
    super.dispose();
  }

  void _useDirectory(String value) => setState(() {
    final trimmed = value.trim();
    _directory = trimmed.isEmpty ? null : trimmed;
    _settings = const SessionSettingsChoice();
  });

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
    final directory = _directory;
    return Padding(
      padding: Insets.screen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const ValueKey('new-session-cwd'),
            controller: _cwd,
            decoration: InputDecoration(
              labelText: 'Directory on the Mac',
              hintText: '/Users/you/project',
              suffixIcon: IconButton(
                tooltip: 'Use this directory',
                icon: const Icon(AppIcons.check),
                onPressed: () => _useDirectory(_cwd.text),
              ),
            ),
            onSubmitted: _useDirectory,
          ),
          if (directory != null)
            SessionSettingsFields(
              backend: widget.backend,
              cwd: directory,
              choice: _settings,
              onChanged: (choice) => setState(() => _settings = choice),
            ),
          const SizedBox(height: Spacing.lg),
          FilledButton(
            onPressed: directory == null || _creating ? null : _create,
            child: Text(_creating ? 'Starting…' : 'Start'),
          ),
        ],
      ),
    );
  }
}
