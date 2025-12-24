import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../screens/diff_view_screen.dart';
import '../theme/colors.dart';
import '../utils/diff_utils.dart';

class PermissionPrompt extends StatelessWidget {
  const PermissionPrompt({
    super.key,
    required this.request,
    required this.onApprove,
    required this.onDeny,
  });

  final PermissionRequest request;
  final VoidCallback onApprove;
  final VoidCallback onDeny;

  @override
  Widget build(BuildContext context) {
    final diffText = request.metadata['diff'] as String?;
    final filePath =
        request.metadata['filePath'] as String? ??
        request.metadata['filepath'] as String? ??
        request.metadata['path'] as String?;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: BroskiColors.abyss,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Permission required',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(request.title, style: Theme.of(context).textTheme.bodyMedium),
          if (request.command != null) ...[
            const SizedBox(height: 12),
            Text(
              request.command!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          if (diffText != null && diffText.trim().isNotEmpty) ...[
            const SizedBox(height: 16),
            const Text(
              'Proposed changes',
              style: TextStyle(
                color: Color(0xFFE4E4E7),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            _PermissionDiffPreview(
              diffText: diffText,
              filePath: filePath,
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onDeny,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: BroskiColors.ember,
                  ),
                  child: const Text('Deny'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: onApprove,
                  child: const Text('Approve'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PermissionDiffPreview extends StatelessWidget {
  const _PermissionDiffPreview({required this.diffText, this.filePath});

  final String diffText;
  final String? filePath;

  @override
  Widget build(BuildContext context) {
    final parsed = UnifiedDiff.parse(diffText);
    final preview = <DiffLine>[];
    for (final line in parsed) {
      if (line.kind == DiffLineKind.header ||
          line.kind == DiffLineKind.hunk ||
          line.kind == DiffLineKind.meta) {
        continue;
      }
      preview.add(line);
      if (preview.length >= 10) break;
    }

    final (adds, dels) = _countAddsDels(parsed);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF17181C),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF2A2D36)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (preview.isEmpty)
            Text(
              'No preview available',
              style: GoogleFonts.jetBrainsMono(
                fontSize: 12,
                color: const Color(0xFF9CA3AF),
              ),
            )
          else
            Column(children: [for (final line in preview) _PreviewRow(line: line)]),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => DiffViewScreen(
                      diff: DiffEntry(
                        file: filePath ?? 'file',
                        before: '',
                        after: '',
                        additions: adds,
                        deletions: dels,
                        diff: diffText,
                      ),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.open_in_full_rounded, size: 16),
              label: const Text('View full'),
            ),
          ),
        ],
      ),
    );
  }

  (int, int) _countAddsDels(List<DiffLine> lines) {
    var adds = 0;
    var dels = 0;
    for (final line in lines) {
      if (line.kind == DiffLineKind.added) adds++;
      if (line.kind == DiffLineKind.removed) dels++;
    }
    return (adds, dels);
  }
}

class _PreviewRow extends StatelessWidget {
  const _PreviewRow({required this.line});

  final DiffLine line;

  @override
  Widget build(BuildContext context) {
    final bg = switch (line.kind) {
      DiffLineKind.added => const Color(0xFF10B981).withValues(alpha: 0.12),
      DiffLineKind.removed => const Color(0xFFEF4444).withValues(alpha: 0.12),
      _ => Colors.transparent,
    };
    final fg = switch (line.kind) {
      DiffLineKind.added => const Color(0xFF10B981),
      DiffLineKind.removed => const Color(0xFFEF4444),
      _ => const Color(0xFFE4E4E7),
    };
    final prefix = switch (line.kind) {
      DiffLineKind.added => '+',
      DiffLineKind.removed => '-',
      _ => ' ',
    };

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '$prefix ${line.text.isEmpty ? ' ' : line.text}',
        style: GoogleFonts.jetBrainsMono(
          fontSize: 12,
          color: fg,
          height: 1.35,
        ),
      ),
    );
  }
}
