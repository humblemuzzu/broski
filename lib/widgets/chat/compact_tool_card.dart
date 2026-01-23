import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/card_style.dart';
import '../../models/message.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/opencode_theme.dart';
import '../../theme/tool_style.dart';
import 'detail_sheet.dart';

/// A compact single-line card for tool calls.
/// Tapping opens DetailSheet with full tool information.
///
/// Handles: Read, Write, Bash, Shell, Glob, Grep, WebFetch, and other tools.
/// Does NOT handle: Edit, Patch (use CompactEditCard), Task (use CompactAgentCard)
class CompactToolCard extends ConsumerWidget {
  final ToolCall tool;
  final String? messageId;
  final void Function(String messageId, String? partId)? onUndo;

  const CompactToolCard({
    super.key,
    required this.tool,
    this.messageId,
    this.onUndo,
  });

  /// Get display name: strip mcp_ prefix and capitalize first letter
  String _getDisplayName() {
    var name = tool.name;
    // Strip mcp_ prefix if present
    if (name.toLowerCase().startsWith('mcp_')) {
      name = name.substring(4);
    }
    // Capitalize first letter
    if (name.isNotEmpty) {
      name = name[0].toUpperCase() + name.substring(1);
    }
    return name;
  }

  /// Get preview text based on tool type
  String _getPreview() {
    final name = tool.name.toLowerCase();

    // Read tool: extract filename from path
    if (name.contains('read')) {
      final path =
          tool.input['path'] as String? ??
          tool.input['filePath'] as String? ??
          tool.input['file_path'] as String? ??
          '';
      return _extractFilename(path);
    }

    // Write tool: extract filename from path (shouldn't reach here - uses CompactWriteCard)
    if (name.contains('write')) {
      final path =
          tool.input['filePath'] as String? ??
          tool.input['path'] as String? ??
          tool.input['file_path'] as String? ??
          '';
      return _extractFilename(path);
    }

    // Bash/Shell: first 50 chars of command
    if (name.contains('bash') || name.contains('shell')) {
      final command = tool.input['command'] as String? ?? '';
      if (command.length > 50) {
        return '${command.substring(0, 50)}...';
      }
      return command;
    }

    // Glob: the pattern
    if (name.contains('glob')) {
      return tool.input['pattern'] as String? ?? '';
    }

    // Grep: the search pattern
    if (name.contains('grep')) {
      return tool.input['pattern'] as String? ?? '';
    }

    // WebFetch: the URL
    if (name.contains('webfetch') || name.contains('fetch')) {
      return tool.input['url'] as String? ?? '';
    }

    // Other/generic: status or first 50 chars of JSON input
    if (tool.input.isNotEmpty) {
      try {
        final jsonStr = const JsonEncoder().convert(tool.input);
        if (jsonStr.length > 50) {
          return '${jsonStr.substring(0, 50)}...';
        }
        return jsonStr;
      } catch (_) {
        return tool.status;
      }
    }
    return tool.status;
  }

  /// Extract filename from path (last segment after /)
  String _extractFilename(String path) {
    if (path.isEmpty) return 'file';
    final parts = path.split('/');
    return parts.last.isNotEmpty ? parts.last : 'file';
  }

  void _showDetailSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final toolName = _getDisplayName();

    DetailSheet.show(
      context: context,
      title: toolName,
      child: _buildSheetContent(theme),
    );
  }

  Widget _buildSheetContent(OpenCodeTheme theme) {
    final name = tool.name.toLowerCase();

    // Read tool
    if (name.contains('read')) {
      return _buildReadContent(theme);
    }

    // Write tool
    if (name.contains('write')) {
      return _buildWriteContent(theme);
    }

    // Bash/Shell tool
    if (name.contains('bash') || name.contains('shell')) {
      return _buildBashContent(theme);
    }

    // Glob tool
    if (name.contains('glob')) {
      return _buildGlobContent(theme);
    }

    // Grep tool
    if (name.contains('grep')) {
      return _buildGrepContent(theme);
    }

    // WebFetch tool
    if (name.contains('webfetch') || name.contains('fetch')) {
      return _buildWebFetchContent(theme);
    }

    // Generic/other tools
    return _buildGenericContent(theme);
  }

  Widget _buildReadContent(OpenCodeTheme theme) {
    final path =
        tool.input['path'] as String? ??
        tool.input['filePath'] as String? ??
        'Unknown';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailSection(
          label: 'File',
          child: SelectableText(
            path,
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        DetailSection(
          label: 'Content',
          child: SelectableText(
            tool.output ?? 'Loading...',
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
      ],
    );
  }

  Widget _buildWriteContent(OpenCodeTheme theme) {
    final path =
        tool.input['filePath'] as String? ??
        tool.input['path'] as String? ??
        'Unknown';
    final content = tool.input['content'] as String? ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailSection(
          label: 'File',
          child: SelectableText(
            path,
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        if (content.isNotEmpty)
          DetailSection(
            label: 'Content',
            child: SelectableText(
              content,
              style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
            ),
          ),
        if (tool.output != null && tool.output!.isNotEmpty)
          DetailSection(
            label: 'Result',
            child: SelectableText(
              tool.output!,
              style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
            ),
          ),
      ],
    );
  }

  Widget _buildBashContent(OpenCodeTheme theme) {
    final command = tool.input['command'] as String? ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailSection(
          label: 'Command',
          child: SelectableText(
            command,
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        DetailSection(
          label: 'Output',
          child: SelectableText(
            tool.output ??
                (tool.status == 'running' ? 'Running...' : 'No output'),
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        // Status indicator for errors
        if (tool.status == 'error')
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(Icons.error_outline, color: theme.error, size: 16),
                const SizedBox(width: 8),
                Text('Error', style: TextStyle(color: theme.error)),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildGlobContent(OpenCodeTheme theme) {
    final pattern = tool.input['pattern'] as String? ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailSection(
          label: 'Pattern',
          child: SelectableText(
            pattern,
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        DetailSection(
          label: 'Matches',
          child: SelectableText(
            tool.output ?? 'Searching...',
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
      ],
    );
  }

  Widget _buildGrepContent(OpenCodeTheme theme) {
    final pattern = tool.input['pattern'] as String? ?? '';
    final include = tool.input['include'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailSection(
          label: 'Pattern',
          child: SelectableText(
            pattern,
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        if (include != null)
          DetailSection(
            label: 'File Filter',
            child: SelectableText(
              include,
              style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
            ),
          ),
        DetailSection(
          label: 'Results',
          child: SelectableText(
            tool.output ?? 'Searching...',
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
      ],
    );
  }

  Widget _buildWebFetchContent(OpenCodeTheme theme) {
    final url = tool.input['url'] as String? ?? '';
    final isLoading = tool.output == null || tool.status == 'running';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailSection(
          label: 'URL',
          child: SelectableText(
            url,
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
        DetailSection(
          label: 'Content',
          child: isLoading
              ? Row(
                  children: [
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: theme.info,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Fetching...',
                      style: TextStyle(color: theme.textMuted),
                    ),
                  ],
                )
              : MarkdownBody(
                  data: tool.output!,
                  selectable: true,
                  styleSheet: _buildMarkdownStyle(theme),
                ),
        ),
      ],
    );
  }

  /// Build markdown style for content rendering
  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      p: GoogleFonts.inter(fontSize: 14, color: theme.text, height: 1.5),
      h1: GoogleFonts.inter(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h2: GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h3: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      strong: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      em: TextStyle(fontStyle: FontStyle.italic, color: theme.textMuted),
      code: GoogleFonts.jetBrainsMono(
        fontSize: 12,
        color: theme.accent,
        backgroundColor: theme.backgroundElement,
      ),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.borderSubtle),
      ),
      codeblockPadding: const EdgeInsets.all(12),
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: theme.borderSubtle, width: 3)),
      ),
      blockquotePadding: const EdgeInsets.only(left: 12),
      listBullet: TextStyle(color: theme.textMuted),
      tableHead: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      tableBody: TextStyle(color: theme.text),
      tableBorder: TableBorder.all(color: theme.borderSubtle, width: 1),
      tableCellsPadding: const EdgeInsets.all(8),
    );
  }

  Widget _buildGenericContent(OpenCodeTheme theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (tool.input.isNotEmpty)
          DetailSection(
            label: 'Input',
            child: SelectableText(
              const JsonEncoder.withIndent('  ').convert(tool.input),
              style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
            ),
          ),
        DetailSection(
          label: 'Output',
          child: SelectableText(
            tool.output ?? 'No output',
            style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    final toolColor = ToolStyle.getColor(context, tool.name);
    final icon = ToolStyle.getIcon(tool.name);
    final isRunning = tool.status == 'running';
    final hasError = tool.status == 'error';

    // Determine colors based on card style settings
    final Color headerBg;
    final Color borderColor;

    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = theme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = toolColor.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = theme.bgRaised;
    }

    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = theme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = theme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = toolColor.withValues(alpha: 0.5);
    }

    return GestureDetector(
      onTap: () => _showDetailSheet(context),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 2),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: hasError ? theme.error.withValues(alpha: 0.5) : borderColor,
            width: 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: headerBg,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Row(
            children: [
              // Icon with 6px spacing
              Icon(icon, size: 16, color: hasError ? theme.error : toolColor),
              const SizedBox(width: 6),

              // Tool name (bold) - using cardHeaderText
              Text(
                _getDisplayName(),
                style: TextStyle(
                  color: theme.cardHeaderText,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),

              // Preview text (muted, truncated, flexible)
              Expanded(
                child: Text(
                  _getPreview(),
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),

              // Arrow or spinner
              if (isRunning)
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(toolColor),
                  ),
                )
              else
                Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: theme.textMuted.withValues(alpha: 0.5),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
