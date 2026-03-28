import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// =============================================================================
// PAGE 3: SUPERPOWERS (Instant Alerts + Voice to Code)
// =============================================================================
class SuperpowersPage extends StatefulWidget {
  const SuperpowersPage({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });
  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;
  @override
  State<SuperpowersPage> createState() => _SuperpowersPageState();
}

class _SuperpowersPageState extends State<SuperpowersPage>
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
  void didUpdateWidget(SuperpowersPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentPage == 3 && oldWidget.currentPage != 3) {
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
    if (widget.currentPage == 3 && !_controller.isAnimating) {
      _controller.forward(from: 0);
    }
    return Container(
      color: Colors.black,
      child: SafeArea(
        child: FadeTransition(
          opacity: CurvedAnimation(
            parent: _controller,
            curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
          ),
          child: Column(
            children: [
              // ---- TOP HALF: Instant Alerts ----
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Spacer(flex: 2),
                      // Floating notification toast — slight tilt like Figma
                      Transform.translate(
                        offset: const Offset(-14, 0),
                        child: Transform.rotate(
                          angle: -0.035, // ~2 degrees counter-clockwise
                          child: SizedBox(
                            width: MediaQuery.of(context).size.width - 28,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 16,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.08),
                                borderRadius: Radii.brXl,
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.06),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Broski logo
                                  ClipRRect(
                                    borderRadius: Radii.brSm,
                                    child: SizedBox(
                                      width: 32,
                                      height: 32,
                                      child: Transform.scale(
                                        scale: 1.6,
                                        child: Image.asset(
                                          'docs/assets/broski-icon.png',
                                          width: 32,
                                          height: 32,
                                          fit: BoxFit.cover,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            const Text(
                                              'BROSKI',
                                              style: TextStyle(
                                                fontFamily: 'GeistSans',
                                                fontSize: 11,
                                                fontWeight: FontWeight.w700,
                                                color: Colors.white,
                                                letterSpacing: 0.8,
                                              ),
                                            ),
                                            const SizedBox(width: 6),
                                            Text(
                                              '\u2022 NOW',
                                              style: TextStyle(
                                                fontFamily: 'GeistSans',
                                                fontSize: 11,
                                                fontWeight: FontWeight.w500,
                                                color: Colors.white.withValues(
                                                  alpha: 0.35,
                                                ),
                                                letterSpacing: 0.5,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 5),
                                        const Text(
                                          'Build Successful',
                                          style: TextStyle(
                                            fontFamily: 'GeistSans',
                                            fontSize: 15,
                                            fontWeight: FontWeight.w600,
                                            color: Colors.white,
                                          ),
                                        ),
                                        const SizedBox(height: 3),
                                        Text(
                                          'Agent corrected 3 errors in auth.ts. Ready to deploy.',
                                          style: TextStyle(
                                            fontFamily: 'GeistSans',
                                            fontSize: 14,
                                            color: Colors.white.withValues(
                                              alpha: 0.50,
                                            ),
                                            height: 1.35,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 22),
                      // Title + subtitle
                      const Text(
                        'Instant Alerts.',
                        style: TextStyle(
                          fontFamily: 'GeistPixel',
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: Spacing.sm),
                      Text(
                        "Step away. We'll ping you when the\nagent fixes the bug.",
                        style: TextStyle(
                          fontFamily: 'GeistSans',
                          fontSize: 18,
                          color: Colors.white.withValues(alpha: 0.55),
                          height: 1.45,
                        ),
                      ),
                      const Spacer(flex: 2),
                    ],
                  ),
                ),
              ),
              // ---- Divider ----
              Padding(
                padding: Insets.screenH,
                child: Container(
                  width: double.infinity,
                  height: 0.5,
                  color: Colors.white.withValues(alpha: 0.08),
                ),
              ),
              // ---- BOTTOM HALF: Voice to Code ----
              Expanded(child: _VoiceSection(onContinue: widget.onContinue)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bottom half — waveform centered + title/subtitle + Next button
class _VoiceSection extends StatefulWidget {
  const _VoiceSection({required this.onContinue});
  final VoidCallback onContinue;
  @override
  State<_VoiceSection> createState() => _VoiceSectionState();
}

class _VoiceSectionState extends State<_VoiceSection>
    with SingleTickerProviderStateMixin {
  late AnimationController _waveController;
  @override
  void initState() {
    super.initState();
    _waveController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _waveController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Spacer(flex: 2),
          // Compact centered waveform
          Transform.translate(
            offset: const Offset(0, -5),
            child: Center(
              child: SizedBox(
                width: 110,
                height: 40,
                child: AnimatedBuilder(
                  animation: _waveController,
                  builder: (context, _) {
                    return CustomPaint(
                      size: const Size(110, 40),
                      painter: _WaveformPainter(
                        progress: _waveController.value,
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
          const Spacer(flex: 1),
          // Title + subtitle
          const Text(
            'Voice to Code.',
            style: TextStyle(
              fontFamily: 'GeistPixel',
              fontSize: 30,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          Text(
            "Skip the keyboard. Just speak and let\nyour agent turn words into code.",
            style: TextStyle(
              fontFamily: 'GeistSans',
              fontSize: 18,
              color: Colors.white.withValues(alpha: 0.55),
              height: 1.45,
            ),
          ),
          const SizedBox(height: Spacing.xxl),
          // Next button
          GestureDetector(
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
                  'Next',
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
          const SizedBox(height: Spacing.xxxl),
        ],
      ),
    );
  }
}

/// Waveform: ~11 bars, wave starts from outside edges and moves inward.
class _WaveformPainter extends CustomPainter {
  _WaveformPainter({required this.progress});
  final double progress;
  static const _barCount = 11;
  static const _pi = 3.14159265;
  @override
  void paint(Canvas canvas, Size size) {
    final totalWidth = size.width;
    final barSpacing = totalWidth / (_barCount + 1);
    final maxH = size.height * 0.92;
    final minH = size.height * 0.12;
    final paint = Paint()
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 4.0;
    for (var i = 0; i < _barCount; i++) {
      const center = (_barCount - 1) / 2.0;
      final distFromEdge =
          (center - (i - center).abs()) / center; // 0 at edge, 1 at center
      final phase = distFromEdge * _pi * 1.2; // inner bars are delayed
      final t = progress * _pi * 2 + phase;
      final wave = ((_sin(t) + 1) / 2); // 0..1
      final barHeight = minH + (maxH - minH) * wave;
      final x = barSpacing * (i + 1);
      final y1 = (size.height - barHeight) / 2;
      final y2 = y1 + barHeight;
      final alpha = 0.55 + 0.45 * wave;
      paint.color = const Color(0xFFD4D8E0).withValues(alpha: alpha);
      canvas.drawLine(Offset(x, y1), Offset(x, y2), paint);
    }
  }

  double _sin(double x) {
    final xMod = x % (2 * _pi);
    final norm = xMod < _pi ? xMod : (2 * _pi - xMod);
    final t = norm / _pi;
    return 4 * t * (1 - t) * (xMod < _pi ? 1 : -1);
  }

  @override
  bool shouldRepaint(covariant _WaveformPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
