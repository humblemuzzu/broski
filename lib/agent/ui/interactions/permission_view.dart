import 'dart:convert';

import 'package:broski/agent/ui/interactions/permission_parts.dart';
import 'package:broski/agent/ui/interactions/reply_draft.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
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

  void _grant(String id, {required bool granted}) {
    setState(() => granted ? _grants.add(id) : _grants.remove(id));
    _report();
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;
    final option = _option;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final preview in request.previews)
          PermissionPreviewView(preview: preview),
        if (request.reason case final reason?)
          Padding(
            padding: Insets.bottomSm,
            child: Text(reason, style: AppTypography.bodySmall()),
          ),
        if (request.input != null) _inputField(request),
        for (final candidate in request.options)
          PermissionOptionTile(
            option: candidate,
            selected: candidate.id == option?.id,
            onTap: () => _choose(candidate),
          ),
        if (option?.effect == PermissionEffect.allow)
          for (final grant in request.grants)
            CheckboxListTile(
              dense: true,
              value: _grants.contains(grant.id),
              title: Text(grantText(grant)),
              onChanged: (checked) =>
                  _grant(grant.id, granted: checked ?? false),
            ),
        if (option != null && option.message != MessagePolicy.none)
          _messageField(option),
      ],
    );
  }

  Widget _inputField(ToolPermissionRequest request) => TextField(
    key: const ValueKey('permission-input'),
    controller: _input,
    readOnly: !request.inputEditable,
    maxLines: null,
    style: AppTypography.codeSmall(),
    decoration: InputDecoration(
      labelText: request.inputEditable ? 'Input (editable)' : 'Input',
    ),
    onChanged: (_) {
      _inputEdited = true;
      _report();
    },
  );

  Widget _messageField(PermissionOption option) => TextField(
    key: const ValueKey('permission-message'),
    controller: _message,
    decoration: InputDecoration(
      labelText: option.message == MessagePolicy.required
          ? 'Message to the agent'
          : 'Message to the agent (optional)',
    ),
    onChanged: (_) => _report(),
  );
}
