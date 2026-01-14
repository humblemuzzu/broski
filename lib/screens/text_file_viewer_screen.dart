import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class TextFileViewerScreen extends ConsumerStatefulWidget {
  const TextFileViewerScreen({
    super.key,
    required this.path,
    this.title,
    this.projectPath,
  });

  final String path;
  final String? title;
  final String? projectPath;

  @override
  ConsumerState<TextFileViewerScreen> createState() => _TextFileViewerScreenState();
}

class _TextFileViewerScreenState extends ConsumerState<TextFileViewerScreen> {
  bool _loading = true;
  String? _error;
  String _content = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final file = await bridge.readFile(widget.path, projectPath: widget.projectPath);
      if (!mounted) return;
      setState(() {
        _content = file.content;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final title = widget.title ?? widget.path;

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text(
          title,
          style: TextStyle(color: oc.text),
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!, style: TextStyle(color: oc.textMuted)),
                ),
              )
            : Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                child: SelectableText(
                  _content,
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 12,
                    color: oc.text,
                    height: 1.5,
                  ),
                ),
              ),
      ),
    );
  }
}

