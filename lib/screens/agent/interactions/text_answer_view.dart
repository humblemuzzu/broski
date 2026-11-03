import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/ask_field.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Free text (contract §9, `text`), on one line unless the request is
/// multiline.
class TextAnswerView extends StatefulWidget {
  const TextAnswerView({
    super.key,
    required this.request,
    required this.onDraft,
  });

  final TextRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<TextAnswerView> createState() => _TextAnswerViewState();
}

class _TextAnswerViewState extends State<TextAnswerView> {
  @override
  void initState() {
    super.initState();
    final initial = widget.request.initialText;
    if (initial != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onDraft(DraftReply(TextReply(text: initial)));
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final multiline = widget.request.multiline;
    return TextFormField(
      key: const ValueKey('text-answer'),
      initialValue: widget.request.initialText,
      maxLines: multiline ? null : 1,
      keyboardType: multiline ? TextInputType.multiline : TextInputType.text,
      style: AppTypography.body(color: theme.text),
      decoration: askInput(theme, hint: widget.request.placeholder),
      onChanged: (text) => widget.onDraft(DraftReply(TextReply(text: text))),
    );
  }
}
