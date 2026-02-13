
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/skill.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
class MarkdownFileEditorScreen extends StatefulWidget {
  const MarkdownFileEditorScreen({
    super.key,
    required this.title,
    required this.source,
    required this.initialName,
    required this.initialContent,
    required this.onSave,
    this.onDelete,
    this.readOnly = false,
    this.path,
    this.namePattern,
    this.nameHint,
  });
  final String title;
  final SkillSource source;
  final String initialName;
  final String initialContent;
  final String? path;
  final bool readOnly;
  final RegExp? namePattern;
  final String? nameHint;
  final Future<bool> Function({
    required String name,
    required SkillSource source,
    required String content,
  })
  onSave;
  final Future<bool> Function()? onDelete;
  @override
  State<MarkdownFileEditorScreen> createState() =>
      _MarkdownFileEditorScreenState();
}
class _MarkdownFileEditorScreenState extends State<MarkdownFileEditorScreen> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _contentCtrl;
  bool _saving = false;
  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initialName);
    _contentCtrl = TextEditingController(text: widget.initialContent);
  }
  @override
  void dispose() {
    _nameCtrl.dispose();
    _contentCtrl.dispose();
    super.dispose();
  }
  Future<void> _save() async {
    if (widget.readOnly) return;
    final name = _nameCtrl.text.trim();
    final pattern = widget.namePattern;
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name is required')),
      );
      return;
    }
    if (pattern != null && !pattern.hasMatch(name)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(widget.nameHint ?? 'Invalid name'),
        ),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final ok = await widget.onSave(
        name: name,
        source: widget.source,
        content: _contentCtrl.text,
      );
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context, true);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Save failed')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Save failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
  Future<void> _delete() async {
    if (widget.readOnly) return;
    final onDelete = widget.onDelete;
    if (onDelete == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _saving = true);
    try {
      final ok = await onDelete();
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context, true);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Delete failed')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final nameReadOnly = widget.readOnly || widget.initialName.isNotEmpty;
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text(widget.title, style: TextStyle(color: oc.text)),
        actions: [
          IconButton(
            tooltip: 'Copy path',
            onPressed: widget.path == null || widget.path!.isEmpty
                ? null
                : () async {
                    await Clipboard.setData(ClipboardData(text: widget.path!));
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Path copied')),
                    );
                  },
            icon: const Icon(AppIcons.copy),
          ),
          if (!widget.readOnly && widget.onDelete != null)
            IconButton(
              tooltip: 'Delete',
              onPressed: _saving ? null : _delete,
              icon: const Icon(AppIcons.delete),
            ),
          if (!widget.readOnly)
            IconButton(
              tooltip: 'Save',
              onPressed: _saving ? null : _save,
              icon: const Icon(AppIcons.save),
            ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Text(
                        widget.source.displayName,
                        style: TextStyle(
                          color: oc.textMuted,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const Spacer(),
                      if (widget.path != null && widget.path!.isNotEmpty)
                        Flexible(
                          child: Text(
                            widget.path!,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.label(color: oc.textMuted),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _nameCtrl,
                    readOnly: nameReadOnly,
                    decoration: InputDecoration(
                      labelText: 'Name',
                      hintText: widget.nameHint,
                      filled: true,
                      fillColor: oc.backgroundPanel,
                      border: OutlineInputBorder(
                        borderRadius: Radii.brMd,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: TextField(
                  controller: _contentCtrl,
                  readOnly: widget.readOnly,
                  expands: true,
                  minLines: null,
                  maxLines: null,
                  style: AppTypography.code(color: oc.text),
                  decoration: InputDecoration(
                    labelText: 'Content',
                    alignLabelWithHint: true,
                    filled: true,
                    fillColor: oc.backgroundPanel,
                    border: OutlineInputBorder(
                      borderRadius: Radii.brMd,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      ),
    );
  }
}
