import 'dart:typed_data';

import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';

class PdfFileViewer extends StatefulWidget {
  const PdfFileViewer({super.key, required this.data, required this.filename});
  final Uint8List data;
  final String filename;
  @override
  State<PdfFileViewer> createState() => _PdfFileViewerState();
}

class _PdfFileViewerState extends State<PdfFileViewer> {
  final _controller = PdfViewerController();
  int _currentPage = 1;
  int _totalPages = 0;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      children: [
        if (_totalPages > 0)
          Container(
            padding: Insets.listItemDense,
            color: theme.backgroundPanel,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: Icon(AppIcons.chevronLeft, color: theme.text),
                  onPressed: _currentPage > 1
                      ? () => _controller.goToPage(pageNumber: _currentPage - 1)
                      : null,
                ),
                Text(
                  'Page $_currentPage of $_totalPages',
                  style: AppTypography.labelLarge(color: theme.text),
                ),
                IconButton(
                  icon: Icon(AppIcons.chevronRight, color: theme.text),
                  onPressed: _currentPage < _totalPages
                      ? () => _controller.goToPage(pageNumber: _currentPage + 1)
                      : null,
                ),
              ],
            ),
          ),
        Expanded(
          child: PdfViewer(
            PdfDocumentRefData(widget.data, sourceName: widget.filename),
            controller: _controller,
            params: PdfViewerParams(
              backgroundColor: theme.background,
              loadingBannerBuilder: (context, bytesDownloaded, totalBytes) {
                return Center(
                  child: CircularProgressIndicator(color: theme.primary),
                );
              },
              errorBannerBuilder: (context, error, stackTrace, documentRef) {
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(AppIcons.error, size: 64, color: theme.error),
                      SizedBox(height: Spacing.lg),
                      Text(
                        'Failed to load PDF',
                        style: TextStyle(color: theme.textMuted),
                      ),
                      SizedBox(height: Spacing.sm),
                      Text(
                        error.toString(),
                        style: AppTypography.label(color: theme.textMuted),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                );
              },
              onPageChanged: (pageNumber) {
                setState(() => _currentPage = pageNumber ?? 1);
              },
              onDocumentChanged: (document) {
                if (document != null) {
                  setState(() => _totalPages = document.pages.length);
                }
              },
            ),
          ),
        ),
      ],
    );
  }
}
