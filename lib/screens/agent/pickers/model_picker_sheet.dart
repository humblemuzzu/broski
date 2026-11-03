import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/pickers/model_choice_list.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';

/// The models a session can run on, in a sheet of its own: the list is long,
/// the form that offers it is not.
void showModelPicker(
  BuildContext context, {
  required List<ModelSummary> models,
  required ModelId? current,
  required ValueChanged<ModelSummary> onPick,
}) => DetailSheet.show<void>(
  context: context,
  title: 'Model',
  initialSize: 0.6,
  child: Padding(
    padding: const EdgeInsets.fromLTRB(
      Spacing.lg,
      Spacing.xs,
      Spacing.lg,
      Spacing.xxl,
    ),
    child: Builder(
      builder: (context) => ModelChoiceList(
        models: models,
        current: current,
        onPick: (model) {
          onPick(model);
          Navigator.of(context).pop();
        },
      ),
    ),
  ),
);
