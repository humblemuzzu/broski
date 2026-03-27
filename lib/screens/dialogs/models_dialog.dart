import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/selection_provider.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/chat/model_selector_content.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the model selector sheet. Extracted from chat_screen.dart.
void showModelsDialog(BuildContext context, WidgetRef ref) {
  DetailSheet.show(
    context: context,
    title: 'Select Model',
    initialSize: 0.5,
    child: ModelSelectorContent(
      onModelSelected: (model) {
        ref.read(selectionProvider.notifier).selectModelFromString(model);
        Navigator.pop(context);
        showSuccess(context, 'Switched to $model');
      },
    ),
  );
}
