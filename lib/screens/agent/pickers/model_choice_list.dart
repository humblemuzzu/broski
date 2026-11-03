import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/pickers/model_choice_row.dart';
import 'package:flutter/material.dart';

/// The models that can be chosen now, the one in force marked.
class ModelChoiceList extends StatelessWidget {
  const ModelChoiceList({
    super.key,
    required this.models,
    required this.current,
    required this.onPick,
  });

  final List<ModelSummary> models;
  final ModelId? current;
  final ValueChanged<ModelSummary> onPick;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final model in models.where(isUsableModel))
        ModelChoiceRow(
          key: ValueKey('model:${model.id}'),
          model: model,
          selected: model.id == current,
          onTap: () => onPick(model),
        ),
    ],
  );
}
