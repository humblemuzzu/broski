import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/link_status_indicator.dart';
import 'package:flutter/material.dart';

/// The session sidebar's top bar: the session's title, its close button and
/// how the machine is reached.
class SidebarHeader extends StatelessWidget {
  const SidebarHeader({super.key, required this.title, this.onClose});

  final String title;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.borderSubtle, width: 1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title.isNotEmpty ? title : 'Session Details',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: theme.text,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (onClose != null)
                IconButton(
                  onPressed: onClose,
                  icon: Icon(AppIcons.close, color: theme.textMuted, size: 20),
                  splashRadius: 20,
                  tooltip: 'Close',
                ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: LinkStatusIndicator(),
          ),
        ],
      ),
    );
  }
}
