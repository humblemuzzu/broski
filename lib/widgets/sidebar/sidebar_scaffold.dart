import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The container both session sidebars are drawn in: the edge drawer's width,
/// its background and border, the header and the scrolling body.
class SidebarScaffold extends StatelessWidget {
  const SidebarScaffold({
    super.key,
    required this.header,
    required this.children,
  });

  final Widget header;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      width: MediaQuery.of(context).size.width * 0.78,
      decoration: BoxDecoration(
        color: theme.background,
        border: Border(left: BorderSide(color: theme.borderSubtle, width: 1)),
      ),
      child: SafeArea(
        left: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            header,
            Expanded(
              child: ListView(padding: Insets.screenH, children: children),
            ),
          ],
        ),
      ),
    );
  }
}
