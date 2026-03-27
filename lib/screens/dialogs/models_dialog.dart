import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/selection_provider.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/chat/model_selector_content.dart';

/// Shows the model selector sheet. Extracted from chat_screen.dart.
void showModelsDialog(BuildContext context, WidgetRef ref) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Select Model',
    initialSize: 0.5,
    child: ModelSelectorContent(
      onModelSelected: (model) {
        ref.read(selectionProvider.notifier).selectModelFromString(model);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Switched to $model'),
            backgroundColor: theme.backgroundPanel,
            behavior: SnackBarBehavior.floating,
          ),
        );
      },
    ),
  );
}
