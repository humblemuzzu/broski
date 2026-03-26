import 'package:flutter/material.dart';

import '../../models/agent.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../variant_badge.dart';
import '../../theme/app_icons.dart';

/// Card for primary agents (Build/Plan). Extracted from chat_screen.dart.
class AgentCard extends StatelessWidget {
  const AgentCard({
    super.key,
    required this.agent,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });
  final Agent agent;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: Insets.cardMd,
        decoration: BoxDecoration(
          color: isSelected
              ? agent.resolveColor(theme).withValues(alpha: 0.12)
              : theme.backgroundPanel,
          borderRadius: Radii.brLg,
          border: Border.all(
            color: isSelected ? agent.resolveColor(theme) : theme.borderSubtle,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: agent.resolveColor(theme),
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          agent.displayName,
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (agent.variant != null &&
                          agent.variant!.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        VariantBadge.small(variant: agent.variant),
                      ],
                    ],
                  ),
                  Text(
                    agent.shortDescription,
                    style: AppTypography.caption(color: theme.textMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (agent.model != null)
                    Text(
                      agent.model!.displayName,
                      style: TextStyle(
                        color: theme.textMuted.withValues(alpha: 0.7),
                        fontSize: 10,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                ],
              ),
            ),
            if (isSelected)
              Icon(
                AppIcons.checkCircle,
                color: agent.resolveColor(theme),
                size: 20,
              ),
          ],
        ),
      ),
    );
  }
}
