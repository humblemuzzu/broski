import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Inline card for Codex image generation events (DALL-E).
/// Shows a spinner while generating and the result when complete.
class CxImageGenCard extends StatelessWidget {
  const CxImageGenCard({
    super.key,
    required this.isCompleted,
    this.prompt,
    this.imageUrl,
  });

  /// Whether the image generation is completed.
  final bool isCompleted;

  /// The prompt used to generate the image.
  final String? prompt;

  /// URL of the generated image (set when completed).
  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                if (isCompleted)
                  Icon(AppIcons.check, size: 14, color: theme.success)
                else
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 1.5,
                      color: theme.primary,
                    ),
                  ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    isCompleted ? 'Image Generated' : 'Generating Image…',
                    style: AppTypography.bodySmall(
                      color: theme.text,
                    ).copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
          // Prompt
          if (prompt != null && prompt!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Text(
                prompt!,
                style: AppTypography.label(color: theme.textMuted),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          // Image preview
          if (isCompleted && imageUrl != null && imageUrl!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: ClipRRect(
                borderRadius: Radii.brSm,
                child: Image.network(
                  imageUrl!,
                  width: double.infinity,
                  height: 200,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    height: 80,
                    alignment: Alignment.center,
                    color: theme.bgRaised,
                    child: Text(
                      'Image unavailable',
                      style: AppTypography.label(color: theme.textMuted),
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
