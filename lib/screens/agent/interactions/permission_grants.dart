import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/choice_mark.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What an allow also grants, as the prompt previewed an "always": a box
/// tinted in the success colour, every grant a row that can be taken back.
class GrantChoices extends StatelessWidget {
  const GrantChoices({
    super.key,
    required this.grants,
    required this.chosen,
    required this.onToggle,
  });

  final List<PermissionGrant> grants;
  final Set<String> chosen;
  final void Function(PermissionGrant grant, bool granted) onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      margin: Insets.bottomMd,
      decoration: BoxDecoration(
        color: theme.success.withValues(alpha: 0.08),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.success.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(AppIcons.checkCircle, size: 14, color: theme.success),
              const SizedBox(width: Spacing.sm),
              Text(
                'This answer also allows',
                style: TextStyle(
                  color: theme.success,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.sm),
          for (final grant in grants)
            _GrantRow(
              grant: grant,
              granted: chosen.contains(grant.id),
              onTap: () => onToggle(grant, !chosen.contains(grant.id)),
            ),
        ],
      ),
    );
  }
}

class _GrantRow extends StatelessWidget {
  const _GrantRow({
    required this.grant,
    required this.granted,
    required this.onTap,
  });

  final PermissionGrant grant;
  final bool granted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: Insets.chipV,
        child: Row(
          children: [
            ChoiceMark(selected: granted, square: true),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                grantText(grant),
                style: AppTypography.codeSmall(
                  color: granted ? theme.text : theme.textMuted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String grantText(PermissionGrant grant) => [
  switch (grant.kind) {
    GrantKind.network => 'Network access',
    GrantKind.read => 'Read',
    GrantKind.write => 'Write',
    GrantKind.deny => 'Deny',
  },
  ?grant.target,
].join(' ');
