import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/agent/ui/composer/composer_extras.dart';
import 'package:broski/agent/ui/composer/composer_rules.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Where a prompt is written: the modes, attachments, mentions and commands
/// the backend takes, and nothing it does not (contract §6, §10).
class Composer extends ConsumerStatefulWidget {
  const Composer({
    super.key,
    required this.session,
    required this.state,
    required this.capabilities,
    required this.text,
  });

  final SessionRef session;
  final AgentSessionState state;
  final Capabilities capabilities;
  final TextEditingController text;

  @override
  ConsumerState<Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<Composer> {
  var _extras = const ComposerExtras();
  PromptMode? _mode;

  @override
  void initState() {
    super.initState();
    widget.text.addListener(_typed);
  }

  @override
  void dispose() {
    widget.text.removeListener(_typed);
    super.dispose();
  }

  void _typed() => setState(() {});

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

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final modes = composerModes(
      widget.capabilities,
      running: widget.state.running,
    );
    final mode = modes.contains(_mode) ? _mode : modes.firstOrNull;
    final problem = composerProblem(
      text: widget.text.text,
      attachments: _extras.attachments,
      command: _extras.command?.id,
    );
    return Padding(
      key: const ValueKey('composer'),
      padding: Insets.cardSm,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ComposerExtrasRow(
            session: widget.session,
            state: widget.state,
            capabilities: widget.capabilities,
            extras: _extras,
            onChanged: (extras) => setState(() => _extras = extras),
          ),
          if (modes.length > 1)
            SegmentedButton<PromptMode>(
              key: const ValueKey('composer-mode'),
              segments: [
                for (final option in modes)
                  ButtonSegment(value: option, label: Text(_modeLabel(option))),
              ],
              selected: {?mode},
              onSelectionChanged: (picked) =>
                  setState(() => _mode = picked.single),
            ),
          _inputRow(mode, sendable: mode != null && problem == null),
          if (mode == null)
            Text(
              'This backend takes no input while a run is on.',
              style: AppTypography.caption(color: theme.textMuted),
            ),
        ],
      ),
    );
  }

  Widget _inputRow(PromptMode? mode, {required bool sendable}) => Row(
    children: [
      Expanded(
        child: TextField(
          key: const ValueKey('composer-text'),
          controller: widget.text,
          minLines: 1,
          maxLines: 6,
          decoration: InputDecoration(
            hintText: mode == null
                ? 'Wait for the run to end'
                : _extras.command?.argumentHint ?? 'Message the agent',
          ),
        ),
      ),
      IconButton(
        key: const ValueKey('composer-send'),
        tooltip: mode == null ? null : _modeLabel(mode),
        icon: Icon(AppIcons.send, color: OpenCodeTheme.of(context).primary),
        onPressed: mode != null && sendable ? () => _send(mode) : null,
      ),
    ],
  );
}

String _modeLabel(PromptMode mode) => switch (mode) {
  PromptMode.start => 'Send',
  PromptMode.steer => 'Steer now',
  PromptMode.queue => 'Queue',
};
