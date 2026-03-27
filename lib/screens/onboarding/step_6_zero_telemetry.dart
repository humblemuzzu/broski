import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import 'package:broski/theme/app_icons.dart';

// =============================================================================
// PAGE 6: ZERO TELEMETRY
// =============================================================================
class ZeroTelemetryPage extends StatefulWidget {
  const ZeroTelemetryPage({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });
  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;
  @override
  State<ZeroTelemetryPage> createState() => _ZeroTelemetryPageState();
}

class _ZeroTelemetryPageState extends State<ZeroTelemetryPage>
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
  void didUpdateWidget(ZeroTelemetryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentPage == 6 && oldWidget.currentPage != 6) {
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
    if (widget.currentPage == 6 && !_controller.isAnimating) {
      _controller.forward(from: 0);
    }
    return Container(
      color: Colors.black,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Crystal / shield illustration (top half)
            Expanded(
              flex: 5,
              child: FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
                ),
                child: ScaleTransition(
                  scale: Tween<double>(begin: 0.9, end: 1.0).animate(
                    CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(
                        0.0,
                        0.5,
                        curve: Curves.easeOutCubic,
                      ),
                    ),
                  ),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Shield image
                        Image.asset(
                          'docs/assets/Abstract dark minimalist 3d geometric shapes, black and white high contrast, shield and lock concept, futuristic technology abstract.png',
                          width: 280,
                          height: 280,
                          fit: BoxFit.contain,
                        ),
                        SizedBox(height: Spacing.md),
                        // "LOCALHOST:3000" pill
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.07),
                            borderRadius: Radii.brXl,
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.08),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 8,
                                height: 8,
                                decoration: const BoxDecoration(
                                  color: Color(0xFF50FA7B),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Text(
                                'LOCALHOST:3000',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontFamily: AppTypography.codeFontFamily,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white,
                                  letterSpacing: 1.5,
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
            // ── Bottom content
            Expanded(
              flex: 4,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Title
                    FadeTransition(
                      opacity: CurvedAnimation(
                        parent: _controller,
                        curve: const Interval(0.2, 0.6, curve: Curves.easeOut),
                      ),
                      child: SlideTransition(
                        position:
                            Tween<Offset>(
                              begin: const Offset(0, 0.12),
                              end: Offset.zero,
                            ).animate(
                              CurvedAnimation(
                                parent: _controller,
                                curve: const Interval(
                                  0.2,
                                  0.6,
                                  curve: Curves.easeOutCubic,
                                ),
                              ),
                            ),
                        child: const Text(
                          'Fully Private.',
                          style: TextStyle(
                            fontFamily: 'GeistPixel',
                            fontSize: 38,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            height: 1.1,
                            letterSpacing: -0.8,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),
                    // ── Feature row 1: Local Execution
                    FadeTransition(
                      opacity: CurvedAnimation(
                        parent: _controller,
                        curve: const Interval(0.3, 0.7, curve: Curves.easeOut),
                      ),
                      child: _FeatureRow(
                        icon: AppIcons.computer,
                        title: 'Runs Locally',
                        subtitle:
                            'Your code, files, and terminal never leave\nyour machine. We just connect your\nphone to it.',
                      ),
                    ),
                    SizedBox(height: Spacing.xxl),
                    // ── Feature row 2: No Training Data
                    FadeTransition(
                      opacity: CurvedAnimation(
                        parent: _controller,
                        curve: const Interval(0.4, 0.8, curve: Curves.easeOut),
                      ),
                      child: _FeatureRow(
                        icon: AppIcons.visibilityOff,
                        title: 'No Data Collection',
                        subtitle:
                            'We have zero access to your code or\nprojects. Never needed to.',
                      ),
                    ),
                    const Spacer(),
                    // ── "Let's Go" button
                    FadeTransition(
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
                              'Let\'s Go',
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
                    const SizedBox(height: 28),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Icon-circle + title + subtitle row used in the Zero Telemetry page.
class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Icon circle
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.08),
            shape: BoxShape.circle,
          ),
          child: Icon(
            icon,
            size: 22,
            color: Colors.white.withValues(alpha: 0.7),
          ),
        ),
        SizedBox(width: Spacing.lg),
        // Text
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontFamily: 'GeistSans',
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              SizedBox(height: Spacing.xs),
              Text(
                subtitle,
                style: TextStyle(
                  fontFamily: 'GeistSans',
                  fontSize: 15,
                  color: Colors.white.withValues(alpha: 0.5),
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
