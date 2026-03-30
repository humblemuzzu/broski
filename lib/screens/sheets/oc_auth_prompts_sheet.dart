import 'package:broski/models/provider.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Shows a dialog with dynamic auth prompts (text inputs + select dropdowns).
/// Returns a map of key to value answers, or null if cancelled.
///
/// Supports conditional visibility via [AuthPromptWhen]: a prompt is shown
/// only when the referenced key's current value matches the condition.
Future<Map<String, String>?> showAuthPromptsDialog({
  required BuildContext context,
  required String providerName,
  required List<AuthPrompt> prompts,
}) {
  return showDialog<Map<String, String>>(
    context: context,
    builder: (ctx) =>
        _AuthPromptsDialog(providerName: providerName, prompts: prompts),
  );
}

class _AuthPromptsDialog extends StatefulWidget {
  final String providerName;
  final List<AuthPrompt> prompts;

  const _AuthPromptsDialog({required this.providerName, required this.prompts});

  @override
  State<_AuthPromptsDialog> createState() => _AuthPromptsDialogState();
}

class _AuthPromptsDialogState extends State<_AuthPromptsDialog> {
  final Map<String, String> _values = {};
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    for (final prompt in widget.prompts) {
      // Initialize selects with the first option's value
      if (prompt.isSelect && prompt.options.isNotEmpty) {
        _values[prompt.key] = prompt.options.first.value;
      } else {
        _values[prompt.key] = '';
      }
      if (prompt.isText) {
        _controllers[prompt.key] = TextEditingController();
      }
    }
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  bool _isVisible(AuthPrompt prompt) {
    if (prompt.when == null) return true;
    return prompt.when!.evaluate(_values);
  }

  bool get _canSubmit {
    for (final prompt in widget.prompts) {
      if (!_isVisible(prompt)) continue;
      final val = _values[prompt.key] ?? '';
      if (val.isEmpty && prompt.isText) return false;
      if (val.isEmpty && prompt.isSelect) return false;
    }
    return true;
  }

  Map<String, String> _collectInputs() {
    final result = <String, String>{};
    for (final prompt in widget.prompts) {
      if (!_isVisible(prompt)) continue;
      final val = prompt.isText
          ? (_controllers[prompt.key]?.text ?? '').trim()
          : (_values[prompt.key] ?? '');
      if (val.isNotEmpty) {
        result[prompt.key] = val;
      }
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final visiblePrompts = widget.prompts.where((p) => _isVisible(p)).toList();

    return AlertDialog(
      backgroundColor: oc.backgroundPanel,
      title: Text(
        'Configure ${widget.providerName}',
        style: TextStyle(color: oc.text, fontSize: 16),
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final prompt in visiblePrompts) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 4, top: 8),
                child: Text(
                  prompt.message,
                  style: TextStyle(
                    color: oc.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (prompt.isText)
                TextField(
                  controller: _controllers[prompt.key],
                  style: TextStyle(color: oc.text, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: prompt.placeholder ?? '',
                    hintStyle: TextStyle(color: oc.textMuted),
                    contentPadding: Insets.cardSm,
                    border: OutlineInputBorder(
                      borderRadius: Radii.brSm,
                      borderSide: BorderSide(color: oc.borderSubtle),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: Radii.brSm,
                      borderSide: BorderSide(color: oc.borderSubtle),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: Radii.brSm,
                      borderSide: BorderSide(color: oc.primary),
                    ),
                  ),
                  onChanged: (v) => setState(() {
                    _values[prompt.key] = v;
                  }),
                ),
              if (prompt.isSelect)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    border: Border.all(color: oc.borderSubtle),
                    borderRadius: Radii.brSm,
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: _values[prompt.key],
                      isExpanded: true,
                      dropdownColor: oc.backgroundPanel,
                      style: TextStyle(color: oc.text, fontSize: 13),
                      items: prompt.options
                          .map(
                            (opt) => DropdownMenuItem(
                              value: opt.value,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(opt.label),
                                  if (opt.hint != null)
                                    Text(
                                      opt.hint!,
                                      style: TextStyle(
                                        color: oc.textMuted,
                                        fontSize: 11,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (v) {
                        if (v == null) return;
                        setState(() {
                          _values[prompt.key] = v;
                        });
                      },
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Cancel', style: TextStyle(color: oc.textMuted)),
        ),
        TextButton(
          onPressed: _canSubmit
              ? () => Navigator.pop(context, _collectInputs())
              : null,
          child: Text(
            'Authenticate',
            style: TextStyle(color: _canSubmit ? oc.primary : oc.textMuted),
          ),
        ),
      ],
    );
  }
}
