import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/models/file_content.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  ConsumerState<TextFileViewerScreen> createState() =>
      _TextFileViewerScreenState();
}

class _TextFileViewerScreenState extends ConsumerState<TextFileViewerScreen> {
  bool _loading = true;
  String? _error;
  String _content = '';
  FileContent? _fileContent;
  Uint8List? _binaryData;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _binaryData = null;
      _fileContent = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final file = await bridge.readFile(
        widget.path,
        projectPath: widget.projectPath,
      );
      if (!mounted) return;
      setState(() {
        _fileContent = file;
        if (file.isBinary) {
          // Try to decode base64 content for binary files
          if (file.encoding == 'base64' && file.content.isNotEmpty) {
            try {
              _binaryData = base64Decode(file.content);
            } catch (_) {
              // Decoding failed
            }
          }
          _content = '';
        } else {
          _content = file.content;
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Widget _buildBinaryView(OpenCodeTheme oc) {
    final file = _fileContent;
    if (file == null) {
      return Center(
        child: Text(
          'Binary file cannot be displayed.',
          style: TextStyle(color: oc.textMuted),
        ),
      );
    }
    final fileName = widget.path.split('/').last;
    // If we have decoded binary data and it's an image, show preview
    if (_binaryData != null && file.isImage) {
      return SingleChildScrollView(
        padding: Insets.card,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            ClipRRect(
              borderRadius: Radii.brSm,
              child: Image.memory(
                _binaryData!,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => _buildBinaryPlaceholder(
                  oc,
                  fileName: fileName,
                  icon: AppIcons.imageOff,
                  label: 'Failed to decode image',
                ),
              ),
            ),
            const SizedBox(height: Spacing.md),
            Text(
              '$fileName  ·  ${_formatBytes(_binaryData!.length)}',
              style: TextStyle(
                fontFamily: AppTypography.uiFontFamily,
                fontSize: 12,
                color: oc.textMuted,
              ),
            ),
          ],
        ),
      );
    }
    // Non-image binary or no decoded data
    return Center(
      child: _buildBinaryPlaceholder(
        oc,
        fileName: fileName,
        icon: AppIcons.file,
        label: 'Binary file',
        subtitle: _binaryData != null
            ? _formatBytes(_binaryData!.length)
            : file.mime,
      ),
    );
  }

  Widget _buildBinaryPlaceholder(
    OpenCodeTheme oc, {
    required String fileName,
    required IconData icon,
    required String label,
    String? subtitle,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: oc.borderSubtle.withValues(alpha: 0.3),
            borderRadius: Radii.brMd,
          ),
          child: Icon(icon, size: 32, color: oc.textMuted),
        ),
        const SizedBox(height: Spacing.md),
        Text(
          label,
          style: TextStyle(
            fontFamily: AppTypography.uiFontFamily,
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: oc.text,
          ),
        ),
        const SizedBox(height: Spacing.xs),
        Text(
          fileName,
          style: TextStyle(
            fontFamily: AppTypography.uiFontFamily,
            fontSize: 12,
            color: oc.textMuted,
          ),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: Spacing.xxs),
          Text(
            subtitle,
            style: TextStyle(
              fontFamily: AppTypography.uiFontFamily,
              fontSize: 11,
              color: oc.textMuted,
            ),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final title = widget.title ?? widget.path;
    final isBinary = _fileContent?.isBinary ?? false;
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
            icon: const Icon(AppIcons.refresh),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SafeArea(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: Padding(
                    padding: Insets.card,
                    child: Text(_error!, style: TextStyle(color: oc.textMuted)),
                  ),
                )
              : isBinary
              ? _buildBinaryView(oc)
              : Container(
                  width: double.infinity,
                  padding: Insets.card,
                  child: SelectableText(
                    _content,
                    style: AppTypography.codeSmall(
                      color: oc.text,
                    ).copyWith(height: 1.5),
                  ),
                ),
        ),
      ),
    );
  }
}
