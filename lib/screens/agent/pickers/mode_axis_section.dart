import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/pickers/picker_choice_row.dart';
import 'package:broski/screens/agent/pickers/picker_section.dart';
import 'package:flutter/material.dart';

/// A mode axis a backend declares, drawn as the app draws a small set of
/// permission choices: each option a row with its label, what it does, and
/// the mark of the one in force.
class ModeAxisSection extends StatelessWidget {
  const ModeAxisSection({
    super.key,
    required this.axis,
    required this.isChosen,
    required this.onPick,
  });

  final ModeAxis axis;
  final bool Function(String value) isChosen;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) => PickerSection(
    title: axis.label,
    caption: axis.description,
    children: [
      for (final option in axis.options)
        PickerChoiceRow(
          key: ValueKey('mode:${axis.id}:${option.value}'),
          label: option.label,
          detail: option.description,
          selected: isChosen(option.value),
          onTap: () => onPick(option.value),
        ),
    ],
  );
}
