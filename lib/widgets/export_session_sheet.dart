import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../models/message.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';

enum ExportFormat { markdown, json, text }

/// Shows an export session sheet using DetailSheet.
Future<void> showExportSessionSheet({
  required BuildContext context,
  required String title,
  required List<ChatMessage> messages,
}) {
  return DetailSheet.show(
    context: context,
    title: 'Export Session',
    initialSize: 0.7,
    maxSize: 0.9,
    minSize: 0.4,
    child: _ExportSessionSheetContent(title: title, messages: messages),
  );
}

/// Legacy widget for backwards compatibility.
/// Prefer using [showExportSessionSheet] instead.
class ExportSessionSheet extends StatefulWidget {
  const ExportSessionSheet({
    super.key,
    required this.title,
    required this.messages,
  });

  final String title;
  final List<ChatMessage> messages;

  @override
  State<ExportSessionSheet> createState() => _ExportSessionSheetState();
}

class _ExportSessionSheetState extends State<ExportSessionSheet> {
  @override
  Widget build(BuildContext context) {
    return DetailSheet(
      title: 'Export Session',
      child: SingleChildScrollView(
        child: _ExportSessionSheetContent(
          title: widget.title,
          messages: widget.messages,
        ),
      ),
    );
  }
}

/// The actual content of the export session sheet.
class _ExportSessionSheetContent extends StatefulWidget {
  const _ExportSessionSheetContent({
    required this.title,
    required this.messages,
  });

  final String title;
  final List<ChatMessage> messages;

  @override
  State<_ExportSessionSheetContent> createState() =>
      _ExportSessionSheetContentState();
}

class _ExportSessionSheetContentState
    extends State<_ExportSessionSheetContent> {
  final _filenameCtrl = TextEditingController();
  ExportFormat _format = ExportFormat.markdown;

  bool _includeUsers = true;
  bool _includeAssistants = true;
  bool _includeThinking = false;
  bool _includeToolCalls = true;
  bool _includeToolOutputs = false;
  bool _includeMetadata = false;

  @override
  void initState() {
    super.initState();
    final ts = DateTime.now().toIso8601String().replaceAll(':', '-');
    _filenameCtrl.text = 'session-$ts.md';
  }

  @override
  void dispose() {
    _filenameCtrl.dispose();
    super.dispose();
  }

  List<ChatMessage> get _filtered {
    return widget.messages.where((m) {
      if (m.role == MessageRole.user) return _includeUsers;
      if (m.role == MessageRole.assistant) return _includeAssistants;
      return true;
    }).toList();
  }

  String _toMarkdown() {
    final buf = StringBuffer();
    buf.writeln('# ${widget.title}');
    buf.writeln();
    for (final m in _filtered) {
      final role = m.role == MessageRole.user
          ? 'USER'
          : m.role == MessageRole.assistant
          ? 'ASSISTANT'
          : 'SYSTEM';
      buf.writeln('## $role');
      if (_includeMetadata) {
        buf.writeln('- id: `${m.id}`');
        buf.writeln('- createdAt: `${m.createdAt.toIso8601String()}`');
        buf.writeln();
      }
      if (m.text.trim().isNotEmpty) {
        buf.writeln(m.text.trimRight());
        buf.writeln();
      }
      if (_includeThinking && m.reasoningParts.isNotEmpty) {
        buf.writeln('### THINKING');
        for (final p in m.reasoningParts) {
          if (p.text.trim().isEmpty) continue;
          buf.writeln('```');
          buf.writeln(p.text.trimRight());
          buf.writeln('```');
          buf.writeln();
        }
      }
      if (_includeToolCalls && m.toolCalls.isNotEmpty) {
        buf.writeln('### TOOLS');
        for (final t in m.toolCalls) {
          buf.writeln('```json');
          buf.writeln(
            const JsonEncoder.withIndent('  ').convert({
              'name': t.name,
              'status': t.status,
              if (t.title != null) 'title': t.title,
              if (t.input.isNotEmpty) 'input': t.input,
              if (_includeToolOutputs && (t.output ?? '').isNotEmpty)
                'output': t.output,
            }),
          );
          buf.writeln('```');
          buf.writeln();
        }
      }
    }
    return buf.toString();
  }

  String _toText() {
    final buf = StringBuffer();
    buf.writeln(widget.title);
    buf.writeln();
    for (final m in _filtered) {
      final role = m.role == MessageRole.user
          ? 'You'
          : m.role == MessageRole.assistant
          ? 'Assistant'
          : 'System';
      buf.writeln('$role:');
      buf.writeln(m.text.trimRight());
      buf.writeln();
    }
    return buf.toString();
  }

  String _toJson() {
    final payload = {
      'title': widget.title,
      'exportedAt': DateTime.now().toIso8601String(),
      'messages': [
        for (final m in _filtered)
          {
            'id': m.id,
            'role': m.role.name,
            'createdAt': m.createdAt.toIso8601String(),
            'text': m.text,
            if (_includeThinking && m.reasoningParts.isNotEmpty)
              'thinking': m.reasoningParts.map((p) => p.text).toList(),
            if (_includeToolCalls && m.toolCalls.isNotEmpty)
              'tools': [
                for (final t in m.toolCalls)
                  {
                    'name': t.name,
                    'status': t.status,
                    if (t.title != null) 'title': t.title,
                    if (t.input.isNotEmpty) 'input': t.input,
                    if (_includeToolOutputs && (t.output ?? '').isNotEmpty)
                      'output': t.output,
                  },
              ],
          },
      ],
    };
    return const JsonEncoder.withIndent('  ').convert(payload);
  }

  String _render() {
    return switch (_format) {
      ExportFormat.markdown => _toMarkdown(),
      ExportFormat.text => _toText(),
      ExportFormat.json => _toJson(),
    };
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _filenameCtrl,
            style: TextStyle(color: oc.text),
            decoration: InputDecoration(
              labelText: 'Filename',
              labelStyle: TextStyle(color: oc.textMuted),
              filled: true,
              fillColor: oc.backgroundElement,
              border: OutlineInputBorder(
                borderRadius: Radii.brMd,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              _FormatChip(
                label: 'Markdown',
                selected: _format == ExportFormat.markdown,
                onTap: () => setState(() => _format = ExportFormat.markdown),
              ),
              _FormatChip(
                label: 'Text',
                selected: _format == ExportFormat.text,
                onTap: () => setState(() => _format = ExportFormat.text),
              ),
              _FormatChip(
                label: 'JSON',
                selected: _format == ExportFormat.json,
                onTap: () => setState(() => _format = ExportFormat.json),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SwitchListTile(
            value: _includeThinking,
            onChanged: (v) => setState(() => _includeThinking = v),
            title: const Text('Include thinking'),
            subtitle: const Text('Reasoning / extended thinking parts'),
          ),
          SwitchListTile(
            value: _includeToolCalls,
            onChanged: (v) => setState(() => _includeToolCalls = v),
            title: const Text('Include tools'),
            subtitle: const Text('Tool calls and inputs'),
          ),
          SwitchListTile(
            value: _includeToolOutputs,
            onChanged: _includeToolCalls
                ? (v) => setState(() => _includeToolOutputs = v)
                : null,
            title: const Text('Include tool outputs'),
            subtitle: const Text('May be large'),
          ),
          SwitchListTile(
            value: _includeMetadata,
            onChanged: (v) => setState(() => _includeMetadata = v),
            title: const Text('Include metadata'),
            subtitle: const Text('IDs and timestamps'),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: oc.textMuted,
                    side: BorderSide(color: oc.borderSubtle),
                  ),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () async {
                    final content = _render();
                    final name = _filenameCtrl.text.trim().isEmpty
                        ? 'session'
                        : _filenameCtrl.text.trim();
                    await Share.share(content, subject: name);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: oc.primary,
                    foregroundColor: oc.selectedListItemText,
                  ),
                  icon: const Icon(Icons.share_rounded, size: 18),
                  label: const Text('Share'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FormatChip extends StatelessWidget {
  const _FormatChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brFull,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? oc.primary.withValues(alpha: 0.2)
              : oc.backgroundElement,
          borderRadius: Radii.brFull,
          border: Border.all(
            color: selected
                ? oc.primary.withValues(alpha: 0.6)
                : oc.borderSubtle,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? oc.text : oc.textMuted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
