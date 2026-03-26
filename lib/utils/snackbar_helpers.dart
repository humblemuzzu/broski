import 'package:flutter/material.dart';
import 'package:broski/theme/opencode_theme.dart';

/// Shows a success snackbar with consistent theming.
void showSuccess(
  BuildContext context,
  String message, {
  SnackBarAction? action,
}) {
  final theme = OpenCodeTheme.of(context);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message, style: TextStyle(color: theme.text)),
      backgroundColor: theme.backgroundPanel,
      behavior: SnackBarBehavior.floating,
      action: action,
    ),
  );
}

/// Shows an error snackbar with consistent theming.
void showError(BuildContext context, String message, {SnackBarAction? action}) {
  final theme = OpenCodeTheme.of(context);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message, style: TextStyle(color: theme.text)),
      backgroundColor: theme.error.withValues(alpha: 0.9),
      behavior: SnackBarBehavior.floating,
      action: action,
    ),
  );
}

/// Shows an info snackbar with consistent theming.
void showInfo(BuildContext context, String message, {SnackBarAction? action}) {
  final theme = OpenCodeTheme.of(context);
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message, style: TextStyle(color: theme.text)),
      backgroundColor: theme.backgroundPanel,
      behavior: SnackBarBehavior.floating,
      action: action,
    ),
  );
}

// ---------------------------------------------------------------------------
// Legacy helpers — kept for backward compatibility with existing callers.
// Prefer showSuccess / showError / showInfo for new code.
// ---------------------------------------------------------------------------

/// Show an error snackbar (legacy — use [showError] for new code).
void showErrorSnackBar(BuildContext context, String message) {
  showError(context, message);
}

/// Show a success/info snackbar (legacy — use [showSuccess] for new code).
void showSuccessSnackBar(BuildContext context, String message) {
  showSuccess(context, message);
}

/// Show a snackbar with an action button.
void showActionSnackBar(
  BuildContext context,
  String message, {
  required String actionLabel,
  required VoidCallback onAction,
}) {
  final theme = OpenCodeTheme.of(context);
  showSuccess(
    context,
    message,
    action: SnackBarAction(
      label: actionLabel,
      textColor: theme.primary,
      onPressed: onAction,
    ),
  );
}
