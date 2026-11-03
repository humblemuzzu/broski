import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The icon that opens an ask and the colour that marks its kind: what the
/// tool would do for a permission, the shape of the answer otherwise.
({IconData icon, Color color}) askLook(
  InteractionRequest request,
  OpenCodeTheme theme,
) => switch (request) {
  ToolPermissionRequest(:final previews) => _previewLook(previews, theme),
  QuestionsRequest() => (icon: AppIcons.help, color: theme.primary),
  ConfirmRequest() => (icon: AppIcons.help, color: theme.info),
  ChoiceRequest() => (icon: AppIcons.list, color: theme.primary),
  TextRequest() => (icon: AppIcons.textFields, color: theme.primary),
  FormRequest() => (icon: AppIcons.checklist, color: theme.primary),
  PlanApprovalRequest() => (icon: AppIcons.checklist, color: theme.accent),
  ExternalUrlRequest() => (icon: AppIcons.openExternal, color: theme.info),
};

({IconData icon, Color color}) _previewLook(
  List<PermissionPreview> previews,
  OpenCodeTheme theme,
) => switch (previews.firstOrNull) {
  CommandPreview() => (icon: AppIcons.terminal, color: theme.error),
  FileChangesPreview() => (icon: AppIcons.edit, color: theme.warning),
  NetworkPreview() => (icon: AppIcons.network, color: theme.info),
  PathsPreview() => (icon: AppIcons.folder, color: theme.success),
  null => (icon: AppIcons.security, color: theme.accent),
};

/// The tinted tile the app's prompts open with.
class AskIcon extends StatelessWidget {
  const AskIcon({
    super.key,
    required this.icon,
    required this.color,
    this.size = 20,
  });

  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.cardXs,
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.15),
      borderRadius: Radii.brMd,
    ),
    child: Icon(icon, color: color, size: size),
  );
}
