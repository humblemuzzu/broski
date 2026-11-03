import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A block of a picker that stays closed until it is asked for: the app's
/// disclosure row, its chevron, and what the block holds once it is open.
class PickerDisclosure extends StatefulWidget {
  const PickerDisclosure({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final List<Widget> children;

  @override
  State<PickerDisclosure> createState() => _PickerDisclosureState();
}

class _PickerDisclosureState extends State<PickerDisclosure> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _DisclosureHeader(
          title: widget.title,
          subtitle: widget.subtitle,
          trailing: widget.trailing,
          open: _open,
          onTap: () => setState(() => _open = !_open),
        ),
        if (_open) ...widget.children,
      ],
    );
  }
}

class _DisclosureHeader extends StatelessWidget {
  const _DisclosureHeader({
    required this.title,
    required this.subtitle,
    required this.trailing,
    required this.open,
    required this.onTap,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Spacing.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _DisclosureTitle(
                title: title,
                subtitle: subtitle,
                theme: theme,
              ),
            ),
            if (trailing case final trailing?) ...[
              const SizedBox(width: Spacing.sm),
              trailing,
            ],
            const SizedBox(width: Spacing.sm),
            Padding(
              padding: const EdgeInsets.only(top: Spacing.xxs),
              child: Icon(
                open ? AppIcons.expandLess : AppIcons.expandMore,
                size: 16,
                color: theme.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DisclosureTitle extends StatelessWidget {
  const _DisclosureTitle({
    required this.title,
    required this.subtitle,
    required this.theme,
  });

  final String title;
  final String? subtitle;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: AppTypography.labelLarge(
            color: theme.text,
          ).copyWith(fontSize: 13),
        ),
        if (subtitle case final subtitle?)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.xxs),
            child: Text(
              subtitle,
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}
