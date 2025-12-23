import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';

import '../models/message.dart';
import '../theme/colors.dart';

class DiffViewer extends StatelessWidget {
  const DiffViewer({super.key, required this.diff});

  final DiffEntry diff;

  @override
  Widget build(BuildContext context) {
    final diffText = _toUnifiedDiff(diff);

    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: BroskiColors.abyss,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BroskiColors.slate),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(diff.file, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          HighlightView(
            diffText,
            language: 'diff',
            theme: atomOneDarkTheme,
            padding: const EdgeInsets.all(8),
            textStyle: const TextStyle(fontSize: 12, height: 1.4),
          ),
        ],
      ),
    );
  }

  String _toUnifiedDiff(DiffEntry entry) {
    final beforeLines = entry.before.split('\n');
    final afterLines = entry.after.split('\n');

    final buffer = StringBuffer();
    buffer.writeln('--- ${entry.file} (before)');
    buffer.writeln('+++ ${entry.file} (after)');
    buffer.writeln('@@ -1,${beforeLines.length} +1,${afterLines.length} @@');
    for (final line in beforeLines) {
      buffer.writeln('-$line');
    }
    for (final line in afterLines) {
      buffer.writeln('+$line');
    }
    return buffer.toString();
  }
}
