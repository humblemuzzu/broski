import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/pickers/picker_choice_row.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Whether a model can be chosen now.
bool isUsableModel(ModelSummary model) => model.unavailableReason == null;

/// One model of a picker: its name, the line under it, and the marks the app
/// puts on a model, that it is the backend's default or that it thinks.
class ModelChoiceRow extends StatelessWidget {
  const ModelChoiceRow({
    super.key,
    required this.model,
    required this.selected,
    required this.onTap,
  });

  final ModelSummary model;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final marks = <Widget>[
      if (model.isDefault) _ModelMark(label: 'Default', color: theme.primary),
      if (model.thinking.options.isNotEmpty)
        _ModelMark(label: 'Thinking', color: theme.warning),
    ];
    return PickerChoiceRow(
      label: model.displayName,
      detail: modelDetailLine(model),
      selected: selected,
      onTap: onTap,
      trailing: marks.isEmpty
          ? null
          : Row(mainAxisSize: MainAxisSize.min, children: marks),
    );
  }
}

/// The line under a model's name: where it comes from, its id when the name
/// hides it, and how much it remembers.
String modelDetailLine(ModelSummary model) {
  final provider = model.providerName ?? model.providerId;
  final parts = [
    if (provider != null && provider.isNotEmpty) provider,
    if (model.displayName != model.id) model.id,
    if (model.contextWindow case final window? when window > 0)
      _contextWindowLabel(window),
  ];
  return parts.isEmpty ? model.id : parts.join(' • ');
}

String _contextWindowLabel(int tokens) => switch (tokens) {
  >= 1000000 => '${tokens ~/ 1000000}M context',
  >= 1000 => '${tokens ~/ 1000}K context',
  _ => '$tokens context',
};

class _ModelMark extends StatelessWidget {
  const _ModelMark({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(left: Spacing.xs),
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.14),
      borderRadius: Radii.brFull,
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700),
    ),
  );
}
