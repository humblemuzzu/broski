import 'package:broski/models/font_preference.dart';
import 'package:broski/providers/font_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

/// Full-screen font picker with live preview.
///
/// Two tabs — UI Font and Code Font — each showing a preview card at top
/// and a scrollable list of fonts below. Fonts apply immediately on tap.
class FontSelectorScreen extends ConsumerWidget {
  const FontSelectorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: ocTheme.background,
        appBar: AppBar(
          backgroundColor: ocTheme.background,
          elevation: 0,
          scrolledUnderElevation: 0,
          title: Text(
            'Typography',
            style: AppTypography.h3(color: ocTheme.text),
          ),
          leading: IconButton(
            icon: Icon(AppIcons.back, color: ocTheme.text),
            onPressed: () => Navigator.of(context).pop(),
          ),
          bottom: TabBar(
            indicatorColor: ocTheme.primary,
            labelColor: ocTheme.text,
            unselectedLabelColor: ocTheme.textMuted,
            dividerColor: ocTheme.borderSubtle,
            labelStyle: AppTypography.labelLarge(),
            unselectedLabelStyle: AppTypography.labelLarge(),
            tabs: const [
              Tab(text: 'UI Font'),
              Tab(text: 'Code Font'),
            ],
          ),
        ),
        body: const AdaptiveContainer(
          width: ContentWidth.standard,
          child: TabBarView(children: [_UIFontTab(), _CodeFontTab()]),
        ),
      ),
    );
  }
}

// ─── UI Font Tab ────────────────────────────────────────────────────────────

class _UIFontTab extends ConsumerWidget {
  const _UIFontTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final selectedFont = ref.watch(currentUIFontProvider);

    return Column(
      children: [
        _FontPreviewCard(
          fontFamily: selectedFont.fontFamily,
          isAsset: selectedFont.isAsset,
          lines: const [
            _PreviewLine('The quick brown fox', 22, FontWeight.w700),
            _PreviewLine(
              'Aa Bb Cc Dd Ee Ff Gg 0123456789',
              16,
              FontWeight.w400,
            ),
            _PreviewLine(
              'Developer tools for the modern age',
              13,
              FontWeight.w400,
              muted: true,
            ),
          ],
        ),
        Container(height: 1, color: ocTheme.borderSubtle),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: Spacing.sm),
            itemCount: UIFont.values.length,
            itemBuilder: (context, index) {
              final font = UIFont.values[index];
              final isSelected = font == selectedFont;
              return _FontRow(
                fontFamily: font.fontFamily,
                displayName: font.displayName,
                description: font.description,
                isAsset: font.isAsset,
                isSelected: isSelected,
                onTap: () {
                  ref.read(fontProvider.notifier).setUIFont(font);
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

// ─── Code Font Tab ──────────────────────────────────────────────────────────

class _CodeFontTab extends ConsumerWidget {
  const _CodeFontTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final selectedFont = ref.watch(currentCodeFontProvider);

    return Column(
      children: [
        _FontPreviewCard(
          fontFamily: selectedFont.fontFamily,
          isAsset: selectedFont.isAsset,
          lines: const [
            _PreviewLine('const fn = (x) => x * 2;', 16, FontWeight.w400),
            _PreviewLine('0O 1l Il |! {} [] () <>', 14, FontWeight.w400),
            _PreviewLine(
              '// The quick brown fox jumps over',
              13,
              FontWeight.w400,
              muted: true,
            ),
          ],
        ),
        Container(height: 1, color: ocTheme.borderSubtle),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: Spacing.sm),
            itemCount: CodeFont.values.length,
            itemBuilder: (context, index) {
              final font = CodeFont.values[index];
              final isSelected = font == selectedFont;
              return _FontRow(
                fontFamily: font.fontFamily,
                displayName: font.displayName,
                description: font.description,
                isAsset: font.isAsset,
                isSelected: isSelected,
                onTap: () {
                  ref.read(fontProvider.notifier).setCodeFont(font);
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

// ─── Preview Card ───────────────────────────────────────────────────────────

class _PreviewLine {
  const _PreviewLine(
    this.text,
    this.fontSize,
    this.fontWeight, {
    this.muted = false,
  });

  final String text;
  final double fontSize;
  final FontWeight fontWeight;
  final bool muted;
}

class _FontPreviewCard extends StatelessWidget {
  const _FontPreviewCard({
    required this.fontFamily,
    required this.isAsset,
    required this.lines,
  });

  final String fontFamily;
  final bool isAsset;
  final List<_PreviewLine> lines;

  TextStyle _styleForLine(_PreviewLine line, Color color) {
    final baseStyle = isAsset
        ? TextStyle(
            fontFamily: fontFamily,
            fontSize: line.fontSize,
            fontWeight: line.fontWeight,
            color: color,
          )
        : GoogleFonts.getFont(
            fontFamily,
            fontSize: line.fontSize,
            fontWeight: line.fontWeight,
            color: color,
          );
    return baseStyle;
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.all(Spacing.lg),
      padding: Insets.card,
      decoration: BoxDecoration(
        color: ocTheme.backgroundElement,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < lines.length; i++) ...[
            if (i > 0) const SizedBox(height: Spacing.sm),
            Text(
              lines[i].text,
              style: _styleForLine(
                lines[i],
                lines[i].muted ? ocTheme.textMuted : ocTheme.text,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}

// ─── Font Row ───────────────────────────────────────────────────────────────

class _FontRow extends StatelessWidget {
  const _FontRow({
    required this.fontFamily,
    required this.displayName,
    required this.description,
    required this.isAsset,
    required this.isSelected,
    required this.onTap,
  });

  final String fontFamily;
  final String displayName;
  final String description;
  final bool isAsset;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    final nameStyle = isAsset
        ? TextStyle(
            fontFamily: fontFamily,
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: ocTheme.text,
          )
        : GoogleFonts.getFont(
            fontFamily,
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: ocTheme.text,
          );

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.xxs,
        ),
        padding: Insets.listItem,
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : Colors.transparent,
          borderRadius: Radii.brMd,
          border: isSelected
              ? Border(left: BorderSide(color: ocTheme.primary, width: 3))
              : null,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(displayName, style: nameStyle),
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: TextStyle(fontSize: 12, color: ocTheme.textMuted),
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(AppIcons.check, color: ocTheme.primary, size: 20),
          ],
        ),
      ),
    );
  }
}
