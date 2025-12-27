import 'package:flutter/material.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';

/// A collapsible card that displays background task completion notifications.
/// Shows the agent, description, and can be expanded to see more details.
class SubtaskNotificationCard extends StatefulWidget {
  const SubtaskNotificationCard({
    super.key,
    required this.notification,
    this.onTap,
  });

  final SubtaskNotification notification;
  final VoidCallback? onTap;

  @override
  State<SubtaskNotificationCard> createState() =>
      _SubtaskNotificationCardState();
}

class _SubtaskNotificationCardState extends State<SubtaskNotificationCard>
    with SingleTickerProviderStateMixin {
  bool _isExpanded = false;

  late AnimationController _controller;
  late Animation<double> _heightFactor;
  late Animation<double> _iconTurns;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 200),
      vsync: this,
    );
    _heightFactor = _controller.drive(CurveTween(curve: Curves.easeInOut));
    _iconTurns = _controller.drive(
      Tween<double>(
        begin: 0.0,
        end: 0.5,
      ).chain(CurveTween(curve: Curves.easeInOut)),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      _isExpanded = !_isExpanded;
      if (_isExpanded) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final notification = widget.notification;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: theme.info.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.info.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header - always visible
          InkWell(
            onTap: _toggle,
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  // Agent icon
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: theme.info.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Center(
                      child: Icon(
                        _getAgentIcon(notification.agent),
                        size: 14,
                        color: theme.info,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Content
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: theme.info.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.auto_awesome_rounded,
                                    size: 10,
                                    color: theme.info,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    '@${notification.agent}',
                                    style: TextStyle(
                                      color: theme.info,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 5,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: theme.success.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                'Completed',
                                style: TextStyle(
                                  color: theme.success,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          notification.description,
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  // Expand icon
                  RotationTransition(
                    turns: _iconTurns,
                    child: Icon(
                      Icons.expand_more_rounded,
                      size: 20,
                      color: theme.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Expanded content
          ClipRect(
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                return Align(
                  heightFactor: _heightFactor.value,
                  alignment: Alignment.topCenter,
                  child: child,
                );
              },
              child: _buildExpandedContent(theme),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildExpandedContent(OpenCodeTheme theme) {
    final notification = widget.notification;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Divider(color: theme.borderSubtle, height: 16),
          if (notification.prompt != null) ...[
            Text(
              'Prompt',
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: theme.backgroundElement,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                notification.prompt!,
                style: TextStyle(
                  color: theme.text.withValues(alpha: 0.9),
                  fontSize: 11,
                  fontFamily: 'monospace',
                  height: 1.4,
                ),
                maxLines: 6,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
          if (notification.sessionId.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.link_rounded, size: 12, color: theme.textMuted),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    'Session: ${notification.sessionId}',
                    style: TextStyle(color: theme.textMuted, fontSize: 10),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (widget.onTap != null)
                  InkWell(
                    onTap: widget.onTap,
                    borderRadius: BorderRadius.circular(4),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: theme.info.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'View Session',
                        style: TextStyle(
                          color: theme.info,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  IconData _getAgentIcon(String agent) {
    switch (agent.toLowerCase()) {
      case 'explore':
        return Icons.search_rounded;
      case 'librarian':
        return Icons.menu_book_rounded;
      case 'oracle':
        return Icons.psychology_rounded;
      case 'general':
        return Icons.auto_awesome_rounded;
      default:
        return Icons.smart_toy_rounded;
    }
  }
}

/// A compact inline version of the subtask notification for tight spaces.
class SubtaskNotificationChip extends StatelessWidget {
  const SubtaskNotificationChip({
    super.key,
    required this.notification,
    this.onTap,
  });

  final SubtaskNotification notification;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: theme.info.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.info.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle_rounded, size: 14, color: theme.success),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: theme.info.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(3),
              ),
              child: Text(
                '@${notification.agent}',
                style: TextStyle(
                  color: theme.info,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                notification.description,
                style: TextStyle(color: theme.text, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
