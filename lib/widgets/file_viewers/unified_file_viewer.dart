
import 'dart:typed_data';

import 'package:flutter/material.dart';
import '../../theme/design_tokens.dart';

import '../../models/file_content.dart';
import '../../theme/opencode_theme.dart';
import 'code_file_viewer.dart';
import 'csv_file_viewer.dart';
import 'image_file_viewer.dart';
import 'markdown_file_viewer.dart';
import 'pdf_file_viewer.dart';
import 'text_file_viewer.dart';
import 'package:broski/theme/app_icons.dart';
enum FileViewerType { image, pdf, markdown, code, csv, text }
class UnifiedFileViewer extends StatelessWidget {
  const UnifiedFileViewer({
    super.key,
    required this.filePath,
    this.textContent,
    this.binaryData,
    this.mimeType,
  });
  final String filePath;
  final String? textContent;
  final Uint8List? binaryData;
  final String? mimeType;
  String get filename => filePath.split('/').last;
  FileViewerType get viewerType {
    if (FileContent.isImagePath(filePath)) return FileViewerType.image;
    if (FileContent.isPdfPath(filePath)) return FileViewerType.pdf;
    if (FileContent.isMarkdownPath(filePath)) return FileViewerType.markdown;
    if (FileContent.isCsvPath(filePath)) return FileViewerType.csv;
    if (FileContent.isCodePath(filePath)) return FileViewerType.code;
    return FileViewerType.text;
  }
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    switch (viewerType) {
      case FileViewerType.image:
        if (binaryData == null) {
          return _buildNoDataError(theme, 'Image data not available');
        }
        return ImageFileViewer(data: binaryData!, filename: filename);
      case FileViewerType.pdf:
        if (binaryData == null) {
          return _buildNoDataError(theme, 'PDF data not available');
        }
        return PdfFileViewer(data: binaryData!, filename: filename);
      case FileViewerType.markdown:
        if (textContent == null || textContent!.isEmpty) {
          return _buildNoDataError(theme, 'Markdown content not available');
        }
        return MarkdownFileViewer(content: textContent!, filename: filename);
      case FileViewerType.csv:
        if (textContent == null || textContent!.isEmpty) {
          return _buildNoDataError(theme, 'CSV content not available');
        }
        return CsvFileViewer(content: textContent!, filename: filename);
      case FileViewerType.code:
        if (textContent == null || textContent!.isEmpty) {
          return _buildNoDataError(theme, 'File content not available');
        }
        return CodeFileViewer(
          content: textContent!,
          language: FileContent.languageFromPath(filePath),
          filename: filename,
        );
      case FileViewerType.text:
        if (textContent == null || textContent!.isEmpty) {
          return _buildNoDataError(theme, 'File content not available');
        }
        return TextFileViewer(content: textContent!, filename: filename);
    }
  }
  Widget _buildNoDataError(OpenCodeTheme theme, String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(AppIcons.error, size: 64, color: theme.textMuted),
          SizedBox(height: Spacing.lg),
          Text(message, style: TextStyle(color: theme.textMuted)),
        ],
      ),
    );
  }
}
