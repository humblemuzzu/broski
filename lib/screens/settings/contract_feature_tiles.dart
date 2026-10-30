import 'package:broski/screens/subscription_usage_screen.dart';
import 'package:broski/screens/terminal_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// What Settings offers while a contract backend is selected: the features
/// that belong to the Mac and the accounts, not to one agent's protocol.
class ContractFeatureTiles extends StatelessWidget {
  const ContractFeatureTiles({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final divider = Divider(
      height: 1,
      thickness: 1,
      indent: 16,
      endIndent: 16,
      color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
    );
    return Column(
      children: [
        divider,
        const _FeatureTile(
          title: 'AI Usage',
          subtitle: 'Your AI provider limits & credits',
          icon: AppIcons.dataUsage,
          screen: SubscriptionUsageScreen(),
        ),
        divider,
        const _FeatureTile(
          title: 'Terminal Sessions',
          subtitle: 'PTY terminal sessions',
          icon: AppIcons.terminal,
          screen: TerminalScreen(),
        ),
      ],
    );
  }
}

class _FeatureTile extends StatelessWidget {
  const _FeatureTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.screen,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Widget screen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute<void>(builder: (_) => screen),
      ),
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              AppIcons.chevronRight,
              size: 20,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }
}
