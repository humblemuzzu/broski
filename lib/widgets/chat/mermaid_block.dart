import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Renders a mermaid code block with visual styling and copy functionality.
///
/// Detects mermaid syntax and shows it in a labeled container with
/// a diagram type indicator. Full rendering would require a webview;
/// this provides a readable presentation of the diagram source.
class MermaidBlock extends StatelessWidget {
  const MermaidBlock({super.key, required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final diagramType = _detectDiagramType(code);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: theme.info.withValues(alpha: 0.08),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(Radii.sm),
                topRight: Radius.circular(Radii.sm),
              ),
            ),
            child: Row(
              children: [
                Icon(AppIcons.gitBranch, size: 14, color: theme.info),
                const SizedBox(width: 6),
                Text(
                  diagramType,
                  style: AppTypography.labelSmall(color: theme.info),
                ),
                const Spacer(),
                GestureDetector(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: code));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Mermaid code copied'),
                        duration: Duration(seconds: 1),
                      ),
                    );
                  },
                  child: Icon(AppIcons.copy, size: 14, color: theme.textMuted),
                ),
              ],
            ),
          ),
          // Code content
          Padding(
            padding: const EdgeInsets.all(10),
            child: Text(
              code,
              style: AppTypography.code(color: theme.text),
              maxLines: 20,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  String _detectDiagramType(String code) {
    final first = code.trimLeft().split('\n').first.trim().toLowerCase();
    if (first.startsWith('graph') || first.startsWith('flowchart')) {
      return 'Flowchart';
    }
    if (first.startsWith('sequencediagram')) return 'Sequence Diagram';
    if (first.startsWith('classdiagram')) return 'Class Diagram';
    if (first.startsWith('statediagram')) return 'State Diagram';
    if (first.startsWith('erdiagram')) return 'ER Diagram';
    if (first.startsWith('gantt')) return 'Gantt Chart';
    if (first.startsWith('pie')) return 'Pie Chart';
    if (first.startsWith('gitgraph')) return 'Git Graph';
    if (first.startsWith('journey')) return 'User Journey';
    if (first.startsWith('mindmap')) return 'Mind Map';
    if (first.startsWith('timeline')) return 'Timeline';
    return 'Mermaid Diagram';
  }
}
