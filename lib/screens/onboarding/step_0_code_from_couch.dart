import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/responsive.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// =============================================================================
// PAGE 0: CODE FROM THE COUCH
// =============================================================================
class CodeFromCouchPage extends StatefulWidget {
  const CodeFromCouchPage({super.key, required this.onContinue});
  final VoidCallback onContinue;
  @override
  State<CodeFromCouchPage> createState() => _CodeFromCouchPageState();
}

class _CodeFromCouchPageState extends State<CodeFromCouchPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Concentric circles + B icon area
            Expanded(
              flex: 5,
              child: Center(
                child: FadeTransition(
                  opacity: CurvedAnimation(
                    parent: _controller,
                    curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
                  ),
                  child: ScaleTransition(
                    scale: Tween<double>(begin: 0.85, end: 1.0).animate(
                      CurvedAnimation(
                        parent: _controller,
                        curve: const Interval(
                          0.0,
                          0.6,
                          curve: Curves.easeOutCubic,
                        ),
                      ),
                    ),
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final dim = constraints.maxWidth < constraints.maxHeight
                            ? constraints.maxWidth
                            : constraints.maxHeight;
                        final circleSize = dim * 0.85;
                        return SizedBox(
                          width: circleSize,
                          height: circleSize,
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              // Concentric circles
                              CustomPaint(
                                size: Size(circleSize, circleSize),
                                painter: _ConcentricCirclesPainter(),
                              ),
                              // Broski B icon
                              ShaderMask(
                                shaderCallback: (Rect bounds) {
                                  return const RadialGradient(
                                    colors: [
                                      Colors.white,
                                      Colors.white,
                                      Colors.transparent,
                                    ],
                                    stops: [0.0, 0.35, 0.65],
                                  ).createShader(bounds);
                                },
                                blendMode: BlendMode.dstIn,
                                child: Image.asset(
                                  'docs/assets/broski-icon.png',
                                  width: 220,
                                  height: 220,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                ),
              ),
            ),
            // Headline text
            Padding(
              padding: EdgeInsets.symmetric(
                horizontal: Responsive.onboardingHPadding(context, 32),
              ),
              child: FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.3, 0.7, curve: Curves.easeOut),
                ),
                child: SlideTransition(
                  position:
                      Tween<Offset>(
                        begin: const Offset(0, 0.15),
                        end: Offset.zero,
                      ).animate(
                        CurvedAnimation(
                          parent: _controller,
                          curve: const Interval(
                            0.3,
                            0.7,
                            curve: Curves.easeOutCubic,
                          ),
                        ),
                      ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: 'CODE\nFROM THE\n',
                              style: TextStyle(
                                fontFamily: 'GeistPixel',
                                fontSize: 52,
                                fontWeight: FontWeight.w900,
                                color: Colors.white,
                                height: 1.05,
                                letterSpacing: -1,
                              ),
                            ),
                            TextSpan(
                              text: 'COUCH.',
                              style: TextStyle(
                                fontFamily: 'GeistPixel',
                                fontSize: 52,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF555555),
                                height: 1.05,
                                letterSpacing: -1,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: Spacing.xl),
                      Text(
                        'The first IDE designed for the\nhorizontal lifestyle.',
                        style: TextStyle(
                          fontFamily: 'GeistSans',
                          fontSize: 18,
                          color: Colors.white.withValues(alpha: 0.55),
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: Spacing.xxxl),
            // Get Started button
            Padding(
              padding: EdgeInsets.fromLTRB(
                Responsive.onboardingHPadding(context, 24),
                0,
                Responsive.onboardingHPadding(context, 24),
                24,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: Responsive.buttonMaxWidth(context),
                  ),
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
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              'Get Started',
                              style: TextStyle(
                                fontFamily: 'GeistSans',
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                                color: Colors.black,
                                letterSpacing: 0.2,
                              ),
                            ),
                            SizedBox(width: Spacing.sm),
                            Text(
                              '\u2192',
                              style: TextStyle(
                                fontFamily: 'GeistSans',
                                fontSize: 20,
                                fontWeight: FontWeight.w500,
                                color: Colors.black,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Draws subtle concentric circles for the background effect
class _ConcentricCirclesPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxRadius = size.width / 2;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    // 4 evenly spaced concentric circles, subtle gray
    final radii = [
      maxRadius * 0.3,
      maxRadius * 0.5,
      maxRadius * 0.7,
      maxRadius * 0.9,
    ];
    for (var i = 0; i < radii.length; i++) {
      paint.color = Color.fromRGBO(255, 255, 255, 0.10 - (i * 0.015));
      canvas.drawCircle(center, radii[i], paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
