import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';

/// macOS-style terminal window card with colored output lines + blinking cursor.
/// Used by the Full Terminal onboarding page.
class OnboardingTerminalCard extends StatefulWidget {
  const OnboardingTerminalCard({super.key});
  @override
  State<OnboardingTerminalCard> createState() => _OnboardingTerminalCardState();
}

class _OnboardingTerminalCardState extends State<OnboardingTerminalCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _cursorController;
  @override
  void initState() {
    super.initState();
    _cursorController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _cursorController.dispose();
    super.dispose();
  }

  // ── Figma-matched palette ──
  static const _termBg = Color(0xFF2A2421);
  static const _titleBarBg = Color(0xFF322D29);
  static const _dotRed = Color(0xFFFF5F57);
  static const _dotYellow = Color(0xFFFFBD2E);
  static const _dotGreen = Color(0xFF28CA41);
  static const _green = Color(0xFF50FA7B);
  static const _blue = Color(0xFF8BE9FD);
  static const _red = Color(0xFFFF6E6E);
  static const _checkGreen = Color(0xFF50FA7B);
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: _termBg,
        borderRadius: Radii.brMd,
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.07),
          width: 1,
        ),
      ),
      child: ClipRRect(
        borderRadius: Radii.brMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Title bar with traffic lights
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: const BoxDecoration(
                color: _titleBarBg,
                border: Border(bottom: BorderSide(color: Color(0xFF3A3430))),
              ),
              child: Row(
                children: [
                  Container(
                    width: 13,
                    height: 13,
                    decoration: const BoxDecoration(
                      color: _dotRed,
                      shape: BoxShape.circle,
                    ),
                  ),
                  SizedBox(width: Spacing.sm),
                  Container(
                    width: 13,
                    height: 13,
                    decoration: const BoxDecoration(
                      color: _dotYellow,
                      shape: BoxShape.circle,
                    ),
                  ),
                  SizedBox(width: Spacing.sm),
                  Container(
                    width: 13,
                    height: 13,
                    decoration: const BoxDecoration(
                      color: _dotGreen,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    'zsh \u2014 80x24',
                    style: TextStyle(
                      fontSize: 12,
                      fontFamily: AppTypography.codeFontFamily,
                      color: Colors.white.withValues(alpha: 0.5),
                    ),
                  ),
                ],
              ),
            ),
            // ── Terminal body
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                child: SingleChildScrollView(
                  physics: const NeverScrollableScrollPhysics(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _tPromptLine('~/project', 'git status'),
                      _tLine('On branch main', null),
                      _tLine('modified: src/App.tsx', _red),
                      _tLine('modified: src/api/client.ts', _red),
                      const SizedBox(height: 14),
                      _tPromptLine('~/project', 'npm run build'),
                      _tLine('> vite build', null),
                      const SizedBox(height: 6),
                      _tLine(
                        'vite v4.4.9 building for production...',
                        null,
                      ),
                      _tLine(
                        'transforming...',
                        Colors.white.withValues(alpha: 0.45),
                      ),
                      _tColorLine(
                        '\u2713 ',
                        _checkGreen,
                        '428 modules transformed.',
                        _checkGreen,
                      ),
                      _tLine(
                        'rendering chunks...',
                        Colors.white.withValues(alpha: 0.45),
                      ),
                      _tSizeLine('dist/index.html', '0.45 kB'),
                      _tSizeLine('dist/assets/index.js', '142.32 kB'),
                      const SizedBox(height: 14),
                      _tPromptLineWithCursor('~/project', 'firebase deploy'),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Prompt line: "-> ~/project command"
  Widget _tPromptLine(String dir, String cmd) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '\u2192 ',
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: _green,
              ),
            ),
            TextSpan(
              text: '$dir ',
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: _blue,
              ),
            ),
            TextSpan(
              text: cmd,
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: Colors.white,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Prompt line with a blinking block cursor at the end.
  Widget _tPromptLineWithCursor(String dir, String cmd) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: '\u2192 ',
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: AppTypography.codeFontFamily,
                    color: _green,
                  ),
                ),
                TextSpan(
                  text: '$dir ',
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: AppTypography.codeFontFamily,
                    color: _blue,
                  ),
                ),
                TextSpan(
                  text: cmd,
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: AppTypography.codeFontFamily,
                    color: Colors.white,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          // Blinking block cursor
          FadeTransition(
            opacity: _cursorController,
            child: Container(
              width: 8,
              height: 16,
              margin: const EdgeInsets.only(left: 1),
              color: Colors.white.withValues(alpha: 0.9),
            ),
          ),
        ],
      ),
    );
  }

  /// Plain text line with optional color override.
  Widget _tLine(String text, Color? color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 13,
          fontFamily: AppTypography.codeFontFamily,
          color: color ?? Colors.white.withValues(alpha: 0.88),
        ),
      ),
    );
  }

  /// Two-part colored line (e.g. checkmark + message).
  Widget _tColorLine(
    String prefix,
    Color prefixColor,
    String body,
    Color bodyColor,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: prefix,
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: prefixColor,
              ),
            ),
            TextSpan(
              text: body,
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: bodyColor,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// File + size line (white filename, muted size).
  Widget _tSizeLine(String filename, String size) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: filename,
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: Colors.white,
                fontWeight: FontWeight.w500,
              ),
            ),
            TextSpan(
              text: '  $size',
              style: TextStyle(
                fontSize: 13,
                fontFamily: AppTypography.codeFontFamily,
                color: Colors.white.withValues(alpha: 0.45),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
