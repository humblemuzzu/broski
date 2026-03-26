import 'package:flutter/material.dart';
import 'package:broski/theme/opencode_theme.dart';

/// Show an error snackbar with consistent theming.
void showErrorSnackBar(BuildContext context, String message) {
  final theme = OpenCodeTheme.of(context);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: theme.error,
    ),
  );
}

/// Show a success/info snackbar with consistent theming.
void showSuccessSnackBar(BuildContext context, String message) {
  final theme = OpenCodeTheme.of(context);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: theme.backgroundPanel,
    ),
  );
}

/// Show a snackbar with an action button.
void showActionSnackBar(
  BuildContext context,
  String message, {
  required String actionLabel,
  required VoidCallback onAction,
}) {
  final theme = OpenCodeTheme.of(context);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: theme.backgroundPanel,
      action: SnackBarAction(
        label: actionLabel,
        textColor: theme.primary,
        onPressed: onAction,
      ),
    ),
  );
}
