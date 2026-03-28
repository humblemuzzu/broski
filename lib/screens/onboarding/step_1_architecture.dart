import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// =============================================================================
// PAGE 1: ARCHITECTURE DIAGRAM
// =============================================================================
class ArchitecturePage extends StatefulWidget {
  const ArchitecturePage({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
    required this.onBack,
  });
  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;
  final VoidCallback onBack;
  @override
  State<ArchitecturePage> createState() => _ArchitecturePageState();
}

class _ArchitecturePageState extends State<ArchitecturePage>
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
  void didUpdateWidget(ArchitecturePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentPage == 1 && oldWidget.currentPage != 1) {
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
    final isTablet = MediaQuery.of(context).size.width > 600;
    if (widget.currentPage == 1 && !_controller.isAnimating) {
      _controller.forward(from: 0);
    }
    return Container(
      color: Colors.black,
      child: SafeArea(
        child: Stack(
          children: [
            Padding(
              padding: EdgeInsets.only(top: isTablet ? 16 : 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Architecture diagram - takes up top portion
                  Expanded(
                    flex: 55,
                    child: FadeTransition(
                      opacity: CurvedAnimation(
                        parent: _controller,
                        curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
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
                                  0.0,
                                  0.6,
                                  curve: Curves.easeOutCubic,
                                ),
                              ),
                            ),
                        child: _ArchitectureDiagram(isTablet: isTablet),
                      ),
                    ),
                  ),
                  // Flexible gap pushes text toward bottom
                  const Spacer(flex: 15),
                  // Text content pinned in lower area
                  FadeTransition(
                    opacity: CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(0.3, 0.8, curve: Curves.easeOut),
                    ),
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: isTablet ? 48 : 28,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your Mac is the Engine.',
                            style: TextStyle(
                              fontFamily: 'GeistPixel',
                              fontSize: isTablet ? 34 : 28,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                              letterSpacing: -0.5,
                              height: 1.15,
                            ),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            'The app acts as a remote interface. Your code, terminal, and git history stay secure on your local machine.',
                            style: TextStyle(
                              fontFamily: 'GeistSans',
                              fontSize: isTablet ? 20 : 18,
                              color: Colors.white.withValues(alpha: 0.55),
                              height: 1.55,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // Bottom space for forward button
                  SizedBox(height: isTablet ? 80 : 100),
                ],
              ),
            ),
            // Back button (top-left)
            Positioned(
              top: 16,
              left: 20,
              child: FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
                ),
                child: GestureDetector(
                  onTap: widget.onBack,
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.20),
                        width: 1,
                      ),
                    ),
                    child: Icon(
                      AppIcons.back,
                      color: Colors.white.withValues(alpha: 0.75),
                      size: 22,
                    ),
                  ),
                ),
              ),
            ),
            // Forward button (bottom-right)
            Positioned(
              bottom: isTablet ? 48 : 32,
              right: 24,
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
                    width: 60,
                    height: 60,
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      AppIcons.forward,
                      color: Colors.black,
                      size: 26,
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

// Architecture diagram visualization
class _ArchitectureDiagram extends StatelessWidget {
  const _ArchitectureDiagram({required this.isTablet});
  final bool isTablet;
  @override
  Widget build(BuildContext context) {
    final cardWidth = isTablet ? 190.0 : 160.0;
    final cardHeight = isTablet ? 115.0 : 100.0;
    return Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        // Top Card: Localhost (laptop) - dull
        _SystemCard(
          width: cardWidth,
          height: cardHeight,
          icon: AppIcons.computer,
          label: 'LOCALHOST',
          isTablet: isTablet,
          isBright: false,
        ),
        // 5-dash line (top)
        _FixedDashLine(dashCount: 5, isTablet: isTablet),
        // Bridge pill
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: Radii.brXxl,
          ),
          child: Text(
            'BROSKI BRIDGE',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: Colors.black,
              letterSpacing: 1.0,
              fontFamily: AppTypography.codeFontFamily,
            ),
          ),
        ),
        // 5-dash line (bottom)
        _FixedDashLine(dashCount: 5, isTablet: isTablet),
        // Bottom Card: Remote (phone) - bright
        _SystemCard(
          width: cardWidth,
          height: cardHeight,
          icon: AppIcons.smartphone,
          label: 'REMOTE',
          isTablet: isTablet,
          isBright: true,
        ),
      ],
    );
  }
}

// System card component
class _SystemCard extends StatelessWidget {
  const _SystemCard({
    required this.width,
    required this.height,
    required this.icon,
    required this.label,
    required this.isTablet,
    this.isBright = false,
  });
  final double width;
  final double height;
  final IconData icon;
  final String label;
  final bool isTablet;
  final bool isBright;
  @override
  Widget build(BuildContext context) {
    final iconAlpha = isBright ? 0.95 : 0.35;
    final labelAlpha = isBright ? 0.85 : 0.3;
    final bgAlpha = isBright ? 0.06 : 0.03;
    final borderAlpha = isBright ? 0.12 : 0.06;
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: bgAlpha),
        borderRadius: Radii.brLg,
        border: Border.all(
          color: Colors.white.withValues(alpha: borderAlpha),
          width: 1,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            icon,
            color: Colors.white.withValues(alpha: iconAlpha),
            size: isTablet ? 38 : 30,
          ),
          const SizedBox(height: 10),
          Text(
            label,
            style: TextStyle(
              fontFamily: 'GeistMono',
              fontSize: isTablet ? 13 : 11,
              fontWeight: FontWeight.w600,
              color: Colors.white.withValues(alpha: labelAlpha),
              letterSpacing: 2.5,
            ),
          ),
        ],
      ),
    );
  }
}

// Fixed-count dashed line (exactly N dashes, evenly spaced vertically)
class _FixedDashLine extends StatelessWidget {
  const _FixedDashLine({required this.dashCount, required this.isTablet});
  final int dashCount;
  final bool isTablet;
  @override
  Widget build(BuildContext context) {
    final dashHeight = isTablet ? 8.0 : 7.0;
    final dashSpace = isTablet ? 7.0 : 6.0;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(dashCount * 2 - 1, (index) {
        if (index.isEven) {
          // Dash
          return Container(
            width: 1.5,
            height: dashHeight,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: Radii.brXs,
            ),
          );
        } else {
          // Space
          return SizedBox(height: dashSpace);
        }
      }),
    );
  }
}
