import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

// =============================================================================
// PAGE 2: UNIFIED INTELLIGENCE
// =============================================================================
class UnifiedIntelligencePage extends StatefulWidget {
  const UnifiedIntelligencePage({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });
  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;
  @override
  State<UnifiedIntelligencePage> createState() =>
      _UnifiedIntelligencePageState();
}

class _UnifiedIntelligencePageState extends State<UnifiedIntelligencePage>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
  }

  @override
  void didUpdateWidget(UnifiedIntelligencePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentPage == 2 && oldWidget.currentPage != 2) {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.currentPage == 2 && !_controller.isAnimating) {
      _controller.forward(from: 0);
    }
    return Container(
      color: Colors.black,
      child: SafeArea(
        child: Stack(
          children: [
            // Subtle vertical grid lines background
            Positioned.fill(child: CustomPaint(painter: _GridLinesPainter())),
            // Main content
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 60),
                // Title
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: FadeTransition(
                    opacity: CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
                    ),
                    child: SlideTransition(
                      position:
                          Tween<Offset>(
                            begin: const Offset(0, 0.1),
                            end: Offset.zero,
                          ).animate(
                            CurvedAnimation(
                              parent: _controller,
                              curve: const Interval(
                                0.0,
                                0.5,
                                curve: Curves.easeOutCubic,
                              ),
                            ),
                          ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Unified Intelligence.',
                            style: TextStyle(
                              fontFamily: 'GeistPixel',
                              fontSize: 32,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                              letterSpacing: -0.5,
                              height: 1.1,
                            ),
                          ),
                          const SizedBox(height: Spacing.md),
                          Text(
                            'Connect your preferred engines. We\norchestrate the rest.',
                            style: TextStyle(
                              fontFamily: 'GeistSans',
                              fontSize: 17,
                              color: Colors.white.withValues(alpha: 0.50),
                              height: 1.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                // Agent cards - centered vertically in remaining space
                Expanded(
                  child: FadeTransition(
                    opacity: CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(0.2, 0.7, curve: Curves.easeOut),
                    ),
                    child: SlideTransition(
                      position:
                          Tween<Offset>(
                            begin: const Offset(0, 0.08),
                            end: Offset.zero,
                          ).animate(
                            CurvedAnimation(
                              parent: _controller,
                              curve: const Interval(
                                0.2,
                                0.7,
                                curve: Curves.easeOutCubic,
                              ),
                            ),
                          ),
                      child: Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 28),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Codex card
                              _AgentCard(
                                iconWidget: Container(
                                  width: 44,
                                  height: 44,
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: Radii.brMd,
                                  ),
                                  child: Padding(
                                    padding: Insets.cardXs,
                                    child: Image.asset(
                                      'docs/assets/codex-icon.png',
                                      fit: BoxFit.contain,
                                    ),
                                  ),
                                ),
                                name: 'Codex',
                              ),
                              const SizedBox(height: 19),
                              // OpenCode card
                              _AgentCard(
                                iconWidget: ClipRRect(
                                  borderRadius: Radii.brMd,
                                  child: Image.asset(
                                    'docs/assets/opencode-mark.png',
                                    width: 44,
                                    height: 44,
                                    fit: BoxFit.cover,
                                  ),
                                ),
                                name: 'OpenCode',
                              ),
                              const SizedBox(height: 19),
                              // Claude Code card
                              _AgentCard(
                                iconWidget: ClipRRect(
                                  borderRadius: Radii.brMd,
                                  child: Image.asset(
                                    'docs/assets/claude-code.png',
                                    width: 44,
                                    height: 44,
                                    fit: BoxFit.cover,
                                  ),
                                ),
                                name: 'Claude Code',
                              ),
                              const SizedBox(height: 19),
                              // Pi card
                              _AgentCard(
                                iconWidget: Container(
                                  width: 44,
                                  height: 44,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF1a1a2e),
                                    borderRadius: Radii.brMd,
                                  ),
                                  padding: Insets.cardXs,
                                  child: SvgPicture.asset(
                                    'docs/assets/pi/pi-logo-dark.svg',
                                    fit: BoxFit.contain,
                                  ),
                                ),
                                name: 'Pi',
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                // Continue button
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
                  child: FadeTransition(
                    opacity: CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(0.5, 1.0, curve: Curves.easeOut),
                    ),
                    child: GestureDetector(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        widget.onContinue();
                      },
                      child: Container(
                        width: double.infinity,
                        height: 58,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: Radii.brFull,
                        ),
                        child: const Center(
                          child: Text(
                            'Continue',
                            style: TextStyle(
                              fontFamily: 'GeistSans',
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                              color: Colors.black,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Agent row card for the Unified Intelligence page
class _AgentCard extends StatelessWidget {
  const _AgentCard({required this.iconWidget, required this.name});
  final Widget iconWidget;
  final String name;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      decoration: BoxDecoration(
        color: const Color(0xFF0A0A0A),
        borderRadius: Radii.brXl,
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.10),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          // Icon with subtle background container
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A1A),
              borderRadius: Radii.brLg,
            ),
            child: Center(
              child: ClipRRect(
                borderRadius: Radii.brMd,
                child: SizedBox(width: 44, height: 44, child: iconWidget),
              ),
            ),
          ),
          const SizedBox(width: Spacing.lg),
          Expanded(
            child: Text(
              name,
              style: const TextStyle(
                fontFamily: 'GeistSans',
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
                letterSpacing: -0.2,
              ),
            ),
          ),
          // Green status dot
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: const Color(0xFF22C55E),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF22C55E).withValues(alpha: 0.4),
                  blurRadius: 6,
                  spreadRadius: 1,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 3 staggered vertical accent lines — each with its own start/end and fade.
class _GridLinesPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final h = size.height;
    final w = size.width;
    // Line 1 (left ~30% x)
    _drawFadedLine(canvas, size, x: w * 0.30, startY: h * 0.18, endY: h * 0.88);
    // Line 2 (center ~50% x)
    _drawFadedLine(canvas, size, x: w * 0.50, startY: h * 0.24, endY: h * 0.90);
    // Line 3 (right ~70% x)
    _drawFadedLine(canvas, size, x: w * 0.70, startY: h * 0.14, endY: h * 0.92);
  }

  void _drawFadedLine(
    Canvas canvas,
    Size size, {
    required double x,
    required double startY,
    required double endY,
  }) {
    final lineHeight = endY - startY;
    final paint = Paint()
      ..strokeWidth = 0.5
      ..style = PaintingStyle.stroke
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withValues(alpha: 0.0),
          Colors.white.withValues(alpha: 0.13),
          Colors.white.withValues(alpha: 0.13),
          Colors.white.withValues(alpha: 0.0),
        ],
        stops: const [0.0, 0.08, 0.92, 1.0],
      ).createShader(Rect.fromLTWH(x, startY, 1, lineHeight));
    canvas.drawLine(Offset(x, startY), Offset(x, endY), paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
