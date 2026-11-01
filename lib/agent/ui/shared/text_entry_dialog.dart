import 'package:flutter/material.dart';

/// Asks for one line of text; null when the person cancels, or leaves it
/// empty unless [allowEmpty].
Future<String?> askForText(
  BuildContext context, {
  required String title,
  required String action,
  String initial = '',
  String? hint,
  bool allowEmpty = false,
}) async {
  final text = await showDialog<String>(
    context: context,
    builder: (context) => _TextEntryDialog(
      title: title,
      action: action,
      initial: initial,
      hint: hint,
    ),
  );
  final trimmed = text?.trim();
  if (trimmed == null || (trimmed.isEmpty && !allowEmpty)) return null;
  return trimmed;
}

/// Owns its text controller, so the controller lives exactly as long as the
/// field, through the dialog's closing animation.
class _TextEntryDialog extends StatefulWidget {
  const _TextEntryDialog({
    required this.title,
    required this.action,
    required this.initial,
    required this.hint,
  });

  final String title;
  final String action;
  final String initial;
  final String? hint;

  @override
  State<_TextEntryDialog> createState() => _TextEntryDialogState();
}

class _TextEntryDialogState extends State<_TextEntryDialog> {
  late final _text = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(
      controller: _text,
      autofocus: true,
      decoration: InputDecoration(hintText: widget.hint),
      onSubmitted: (value) => Navigator.of(context).pop(value),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      TextButton(
        onPressed: () => Navigator.of(context).pop(_text.text),
        child: Text(widget.action),
      ),
    ],
  );
}

/// Asks before something that stops or removes what it is about.
Future<bool> askToConfirm(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(action),
          ),
        ],
      ),
    ) ??
    false;

/// Shows [problem], when there is one, as a passing message.
void showProblem(BuildContext context, String? problem) {
  if (problem == null || !context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
}
