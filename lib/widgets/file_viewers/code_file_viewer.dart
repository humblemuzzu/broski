import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../theme/opencode_theme.dart';

class CodeFileViewer extends StatelessWidget {
  const CodeFileViewer({
    super.key,
    required this.content,
    required this.language,
    required this.filename,
  });

  final String content;
  final String language;
  final String filename;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final lines = content.split('\n');

    return Container(
      color: theme.background,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: theme.backgroundPanel,
            child: Row(
              children: [
                Icon(Icons.code, size: 16, color: theme.textMuted),
                const SizedBox(width: 8),
                Text(
                  '${lines.length} lines',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: theme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    language.toUpperCase(),
                    style: TextStyle(
                      color: theme.primary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: Icon(Icons.copy, size: 18, color: theme.textMuted),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: content));
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: const Text('Copied to clipboard'),
                        backgroundColor: theme.backgroundPanel,
                        behavior: SnackBarBehavior.floating,
                        duration: const Duration(seconds: 2),
                      ),
                    );
                  },
                  tooltip: 'Copy',
                  constraints: const BoxConstraints(),
                  padding: const EdgeInsets.all(8),
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 48,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: List.generate(
                          lines.length,
                          (index) => Text(
                            '${index + 1}',
                            style: GoogleFonts.jetBrainsMono(
                              fontSize: 13,
                              height: 1.6,
                              color: theme.textMuted.withValues(alpha: 0.5),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    HighlightView(
                      content,
                      language: language,
                      theme: atomOneDarkTheme,
                      textStyle: GoogleFonts.jetBrainsMono(
                        fontSize: 13,
                        height: 1.6,
                      ),
                      padding: EdgeInsets.zero,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
