import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../theme/opencode_theme.dart';

class TextFileViewer extends StatelessWidget {
  const TextFileViewer({
    super.key,
    required this.content,
    required this.filename,
  });

  final String content;
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
                Icon(Icons.description, size: 16, color: theme.textMuted),
                const SizedBox(width: 8),
                Text(
                  '${lines.length} lines',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
                const Spacer(),
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
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.backgroundPanel,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: theme.borderSubtle),
                ),
                child: SelectableText(
                  content,
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 13,
                    color: theme.text,
                    height: 1.6,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
