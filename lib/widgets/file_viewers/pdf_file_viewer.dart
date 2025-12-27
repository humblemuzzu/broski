import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../theme/opencode_theme.dart';

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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: theme.backgroundPanel,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: Icon(Icons.chevron_left, color: theme.text),
                  onPressed: _currentPage > 1
                      ? () => _controller.goToPage(pageNumber: _currentPage - 1)
                      : null,
                ),
                Text(
                  'Page $_currentPage of $_totalPages',
                  style: TextStyle(color: theme.text, fontSize: 14),
                ),
                IconButton(
                  icon: Icon(Icons.chevron_right, color: theme.text),
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
                      Icon(Icons.error_outline, size: 64, color: theme.error),
                      const SizedBox(height: 16),
                      Text(
                        'Failed to load PDF',
                        style: TextStyle(color: theme.textMuted),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        error.toString(),
                        style: TextStyle(color: theme.textMuted, fontSize: 12),
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
