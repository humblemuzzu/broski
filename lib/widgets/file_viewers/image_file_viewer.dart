import 'dart:typed_data';

import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:photo_view/photo_view.dart';

class ImageFileViewer extends StatelessWidget {
  const ImageFileViewer({
    super.key,
    required this.data,
    required this.filename,
  });
  final Uint8List data;
  final String filename;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      color: theme.background,
      child: PhotoView(
        imageProvider: MemoryImage(data),
        backgroundDecoration: BoxDecoration(color: theme.background),
        minScale: PhotoViewComputedScale.contained,
        maxScale: PhotoViewComputedScale.covered * 4,
        initialScale: PhotoViewComputedScale.contained,
        heroAttributes: PhotoViewHeroAttributes(tag: filename),
        loadingBuilder: (context, event) => Center(
          child: CircularProgressIndicator(
            color: theme.primary,
            value: event?.expectedTotalBytes != null
                ? event!.cumulativeBytesLoaded / event.expectedTotalBytes!
                : null,
          ),
        ),
        errorBuilder: (context, error, stackTrace) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(AppIcons.imageOff, size: 64, color: theme.error),
              const SizedBox(height: Spacing.lg),
              Text(
                'Failed to load image',
                style: TextStyle(color: theme.textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
