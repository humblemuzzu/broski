import 'dart:convert';

import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/screens/agent/interactions/ask_field.dart';
import 'package:broski/screens/agent/interactions/permission_grants.dart';
import 'package:broski/screens/agent/interactions/permission_options.dart';
import 'package:broski/screens/agent/interactions/permission_parts.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A tool asks to run (contract §9, `tool_permission`): what it would do,
/// the options the backend offers with their scope and rule, the message an
/// option takes, the grants to allow, and the input when it may be edited.
/// A `deliberate` ask never answers on one tap.
class PermissionView extends StatefulWidget {
  const PermissionView({
    super.key,
    required this.request,
    required this.onDraft,
    required this.onSubmit,
  });

  final ToolPermissionRequest request;
  final ValueChanged<ReplyDraft> onDraft;
  final ValueChanged<InteractionReply> onSubmit;

  @override
  State<PermissionView> createState() => _PermissionViewState();
}

class _PermissionViewState extends State<PermissionView> {
  late PermissionOption? _option = widget.request.options
      .where((option) => option.id == widget.request.defaultOptionId)
      .firstOrNull;
  late final Set<String> _grants = {
    for (final grant in widget.request.grants) grant.id,
  };
  final _message = TextEditingController();
  late final _input = TextEditingController(text: _inputText());
  var _inputEdited = false;

  String _inputText() => switch (widget.request.input) {
    null => '',
    final input => const JsonEncoder.withIndent('  ').convert(input.toJson()),
  };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _report());
  }

  @override
  void dispose() {
    _message.dispose();
    _input.dispose();
    super.dispose();
  }

  ReplyDraft? _draft() {
    final option = _option;
    if (option == null) return null;
    return permissionDraft(
      request: widget.request,
      option: option,
      message: _message.text.trim(),
      grantIds: _grants,
      editedInputText: _inputEdited ? _input.text : null,
    );
  }

  void _report() {
    final draft = _draft();
    if (draft != null && mounted) widget.onDraft(draft);
  }

  void _choose(PermissionOption option) {
    setState(() => _option = option);
    final draft = _draft();
    final oneTap =
        !widget.request.deliberate && option.message != MessagePolicy.required;
    if (oneTap && draft is DraftReply) {
      widget.onSubmit(draft.reply);
    } else {
      _report();
    }
  }

  void _grant(PermissionGrant grant, bool granted) {
    setState(() {
      if (granted) {
        _grants.add(grant.id);
      } else {
        _grants.remove(grant.id);
      }
    });
    _report();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final request = widget.request;
    final option = _option;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final preview in request.previews)
          PermissionPreviewView(preview: preview),
        if (request.reason case final reason?)
          Padding(
            padding: Insets.bottomMd,
            child: Text(
              reason,
              style: AppTypography.bodySmall(color: theme.textMuted),
            ),
          ),
        if (request.input != null) _inputField(request, theme),
        ..._optionRows(option),
        if (option?.effect == PermissionEffect.allow &&
            request.grants.isNotEmpty)
          GrantChoices(
            grants: request.grants,
            chosen: _grants,
            onToggle: _grant,
          ),
        if (option != null && option.message != MessagePolicy.none)
          _messageField(option, theme),
      ],
    );
  }

  List<Widget> _optionRows(PermissionOption? chosen) {
    final options = widget.request.options;
    return [
      for (var at = 0; at < options.length; at += 2)
        Padding(
          padding: Insets.bottomSm,
          child: Row(
            children: [
              Expanded(child: _optionButton(options[at], chosen)),
              if (at + 1 < options.length) ...[
                const SizedBox(width: Spacing.sm),
                Expanded(child: _optionButton(options[at + 1], chosen)),
              ],
            ],
          ),
        ),
    ];
  }

  Widget _optionButton(PermissionOption option, PermissionOption? chosen) =>
      AnswerButton(
        key: ValueKey('permission-option:${option.id}'),
        label: option.label,
        detail: permissionDetail(option),
        tone: permissionTone(option),
        icon: permissionIcon(option),
        selected: option.id == chosen?.id,
        onTap: () => _choose(option),
      );

  Widget _inputField(ToolPermissionRequest request, OpenCodeTheme theme) =>
      Padding(
        padding: Insets.bottomMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AskFieldLabel(
              text: request.inputEditable ? 'Input (editable)' : 'Input',
            ),
            TextField(
              key: const ValueKey('permission-input'),
              controller: _input,
              readOnly: !request.inputEditable,
              maxLines: null,
              style: AppTypography.codeSmall(color: theme.text),
              decoration: askInput(
                theme,
                hint: 'The input this tool would run with',
              ),
              onChanged: (_) {
                _inputEdited = true;
                _report();
              },
            ),
          ],
        ),
      );

  Widget _messageField(PermissionOption option, OpenCodeTheme theme) {
    final allows = option.effect == PermissionEffect.allow;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AskFieldLabel(
          text: option.message == MessagePolicy.required
              ? 'Message to the agent'
              : 'Message to the agent (optional)',
        ),
        TextField(
          key: const ValueKey('permission-message'),
          controller: _message,
          maxLines: 2,
          style: AppTypography.body(color: theme.text),
          decoration: askInput(
            theme,
            hint: 'e.g. "Use a different approach…"',
            focus: allows ? theme.success : theme.error,
          ),
          onChanged: (_) => _report(),
        ),
      ],
    );
  }
}
