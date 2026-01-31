import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';

/// Premium onboarding experience for Broski.
/// Inspired by modern mobile app onboarding patterns with developer-focused content.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  int _currentPage = 0;
  final PageController _pageController = PageController();

  // Total pages: Splash(0), Architecture(1), Feature1(2), Feature2(3), Feature3(4), GetStarted(5)
  static const int _totalPages = 6;

  void _goToPage(int page) {
    if (page < 0 || page >= _totalPages) return;
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOutCubic,
    );
  }

  void _nextPage() {
    if (_currentPage < _totalPages - 1) {
      _goToPage(_currentPage + 1);
    }
  }

  void _completeOnboarding({required bool hasBridge}) {
    if (hasBridge) {
      ref.read(onboardingProvider.notifier).setHasMacSetup(true);
    } else {
      ref.read(onboardingProvider.notifier).setHasMacSetup(false);
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: PageView(
        controller: _pageController,
        physics: const NeverScrollableScrollPhysics(),
        onPageChanged: (page) => setState(() => _currentPage = page),
        children: [
          // Page 0: Code From The Couch
          _CodeFromCouchPage(onContinue: _nextPage),

          // Page 1: Architecture Diagram
          _ArchitecturePage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
          ),

          // Page 2: Unified Intelligence
          _UnifiedIntelligencePage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
          ),

          // Page 3: Feature - Approve Commands
          _FeaturePage(
            pageIndex: 3,
            currentPage: _currentPage,
            totalPages: _totalPages,
            icon: Icons.terminal_rounded,
            iconGradient: const [Color(0xFF10B981), Color(0xFF059669)],
            title: 'Approve Commands',
            subtitle:
                'Get notified when your agent needs permission. Review shell commands and approve with a tap.',
            mockupChild: const _TerminalMockup(),
            onContinue: _nextPage,
          ),

          // Page 4: Feature - Track Changes
          _FeaturePage(
            pageIndex: 4,
            currentPage: _currentPage,
            totalPages: _totalPages,
            icon: Icons.difference_rounded,
            iconGradient: const [Color(0xFFF59E0B), Color(0xFFD97706)],
            title: 'Track Changes',
            subtitle:
                'See every file your agent touches. Review diffs, browse the filesystem, and monitor progress live.',
            mockupChild: const _DiffMockup(),
            onContinue: _nextPage,
          ),

          // Page 5: Get Started
          _GetStartedPage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onSetupNeeded: () => _completeOnboarding(hasBridge: false),
            onAlreadySetup: () => _completeOnboarding(hasBridge: true),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// STEP DOTS INDICATOR
// =============================================================================

class _StepDots extends StatelessWidget {
  const _StepDots({required this.currentPage, required this.totalPages});

  final int currentPage;
  final int totalPages;

  @override
  Widget build(BuildContext context) {
    // Don't show on splash page
    if (currentPage == 0) return const SizedBox.shrink();

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(totalPages - 1, (index) {
        // Skip splash in count (index 0 maps to page 1, etc.)
        final pageIndex = index + 1;
        final isActive = pageIndex == currentPage;
        final isCompleted = pageIndex < currentPage;

        return AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutCubic,
          margin: const EdgeInsets.symmetric(horizontal: 4),
          width: isActive ? 28 : 8,
          height: 8,
          decoration: BoxDecoration(
            color: isActive || isCompleted
                ? Colors.white
                : Colors.white.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(4),
          ),
        );
      }),
    );
  }
}

// =============================================================================
// PAGE 0: CODE FROM THE COUCH
// =============================================================================

class _CodeFromCouchPage extends StatefulWidget {
  const _CodeFromCouchPage({required this.onContinue});

  final VoidCallback onContinue;

  @override
  State<_CodeFromCouchPage> createState() => _CodeFromCouchPageState();
}

class _CodeFromCouchPageState extends State<_CodeFromCouchPage>
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
              padding: const EdgeInsets.symmetric(horizontal: 32),
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
                      const SizedBox(height: 20),
                      Text(
                        'The first IDE designed for the\nhorizontal lifestyle.',
                        style: TextStyle(
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
            const SizedBox(height: 32),
            // Get Started button
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
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
                      borderRadius: BorderRadius.circular(29),
                    ),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          'Get Started',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                            color: Colors.black,
                            letterSpacing: 0.2,
                          ),
                        ),
                        SizedBox(width: 8),
                        Text(
                          '\u2192',
                          style: TextStyle(
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

// =============================================================================
// PAGE 1: ARCHITECTURE DIAGRAM
// =============================================================================

class _ArchitecturePage extends StatefulWidget {
  const _ArchitecturePage({
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });

  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;

  @override
  State<_ArchitecturePage> createState() => _ArchitecturePageState();
}

class _ArchitecturePageState extends State<_ArchitecturePage>
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
  void didUpdateWidget(_ArchitecturePage oldWidget) {
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
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Minimal top spacing - diagram starts near back button
                SizedBox(height: isTablet ? 24 : 16),
                // Architecture diagram area - fills vertical space
                Expanded(
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
                      child: Padding(
                        padding: EdgeInsets.only(top: isTablet ? 12.0 : 6.0),
                        child: _ArchitectureDiagram(isTablet: isTablet),
                      ),
                    ),
                  ),
                ),
                // Breathing room between diagram and text
                SizedBox(height: isTablet ? 40 : 35),
                // Text content - LEFT aligned
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: isTablet ? 48 : 28),
                  child: FadeTransition(
                    opacity: CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(0.3, 0.8, curve: Curves.easeOut),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Your Mac is the Engine.',
                          style: TextStyle(
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
                            fontSize: isTablet ? 20 : 18,
                            color: Colors.white.withValues(alpha: 0.55),
                            height: 1.55,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                SizedBox(height: isTablet ? 80 : 110),
              ],
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
                  onTap: () {
                    final pageController = context
                        .findAncestorStateOfType<_OnboardingScreenState>()
                        ?._pageController;
                    pageController?.previousPage(
                      duration: const Duration(milliseconds: 400),
                      curve: Curves.easeOutCubic,
                    );
                  },
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
                      Icons.arrow_back_rounded,
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
                      Icons.arrow_forward_rounded,
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
    final cardWidth = isTablet ? 220.0 : 195.0;
    final cardHeight = isTablet ? 140.0 : 120.0;

    return Column(
      children: [
        // Top Card: Localhost (laptop)
        _SystemCard(
          width: cardWidth,
          height: cardHeight,
          icon: Icons.laptop_mac_outlined,
          label: 'LOCALHOST',
          isTablet: isTablet,
        ),
        // Flexible dashed line - fills available space
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) => CustomPaint(
              size: Size(2, constraints.maxHeight),
              painter: _DashedLinePainter(),
            ),
          ),
        ),
        // Bridge pill
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
          ),
          child: const Text(
            'BROSKI BRIDGE',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: Colors.black,
              letterSpacing: 1.0,
              fontFamily: 'monospace',
            ),
          ),
        ),
        // Flexible dashed line - fills available space
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) => CustomPaint(
              size: Size(2, constraints.maxHeight),
              painter: _DashedLinePainter(),
            ),
          ),
        ),
        // Bottom Card: Remote (phone)
        _SystemCard(
          width: cardWidth,
          height: cardHeight,
          icon: Icons.phone_iphone_outlined,
          label: 'REMOTE',
          isTablet: isTablet,
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
  });

  final double width;
  final double height;
  final IconData icon;
  final String label;
  final bool isTablet;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.07),
          width: 1,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            icon,
            color: Colors.white.withValues(alpha: 0.6),
            size: isTablet ? 44 : 36,
          ),
          const SizedBox(height: 12),
          Text(
            label,
            style: TextStyle(
              fontSize: isTablet ? 14 : 12,
              fontWeight: FontWeight.w600,
              color: Colors.white.withValues(alpha: 0.4),
              letterSpacing: 2.5,
            ),
          ),
        ],
      ),
    );
  }
}

// Dashed line painter
class _DashedLinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.16)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    const dashHeight = 7.0;
    const dashSpace = 6.0;
    double startY = 0;

    while (startY < size.height) {
      canvas.drawLine(
        Offset(size.width / 2, startY),
        Offset(size.width / 2, startY + dashHeight),
        paint,
      );
      startY += dashHeight + dashSpace;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// =============================================================================
// PAGE 2: UNIFIED INTELLIGENCE
// =============================================================================

class _UnifiedIntelligencePage extends StatefulWidget {
  const _UnifiedIntelligencePage({
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });

  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;

  @override
  State<_UnifiedIntelligencePage> createState() =>
      _UnifiedIntelligencePageState();
}

class _UnifiedIntelligencePageState extends State<_UnifiedIntelligencePage>
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
  void didUpdateWidget(_UnifiedIntelligencePage oldWidget) {
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
                              fontSize: 32,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                              letterSpacing: -0.5,
                              height: 1.1,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'Connect your preferred engines. We\norchestrate the rest.',
                            style: TextStyle(
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
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Padding(
                                    padding: const EdgeInsets.all(8),
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
                                  borderRadius: BorderRadius.circular(12),
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
                                  borderRadius: BorderRadius.circular(12),
                                  child: Image.asset(
                                    'docs/assets/claude-code.png',
                                    width: 44,
                                    height: 44,
                                    fit: BoxFit.cover,
                                  ),
                                ),
                                name: 'Claude Code',
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
                          borderRadius: BorderRadius.circular(29),
                        ),
                        child: const Center(
                          child: Text(
                            'Continue',
                            style: TextStyle(
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
        borderRadius: BorderRadius.circular(20),
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
              borderRadius: BorderRadius.circular(14),
            ),
            child: Center(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(width: 44, height: 44, child: iconWidget),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              name,
              style: const TextStyle(
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
/// Inspired by the Figma: lines connect through the card region at different heights.
class _GridLinesPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final h = size.height;
    final w = size.width;

    // Line 1 (left ~30% x): starts near subtitle text, ends just before Continue button
    _drawFadedLine(canvas, size, x: w * 0.30, startY: h * 0.18, endY: h * 0.88);

    // Line 2 (center ~50% x): starts a bit below line 1, ends at roughly the same bottom
    _drawFadedLine(canvas, size, x: w * 0.50, startY: h * 0.24, endY: h * 0.90);

    // Line 3 (right ~70% x): starts highest (around "We" in subtitle), goes to bottom
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

// =============================================================================
// FEATURE PAGES (3, 4)
// =============================================================================

class _FeaturePage extends StatefulWidget {
  const _FeaturePage({
    required this.pageIndex,
    required this.currentPage,
    required this.totalPages,
    required this.icon,
    required this.iconGradient,
    required this.title,
    required this.subtitle,
    required this.mockupChild,
    required this.onContinue,
  });

  final int pageIndex;
  final int currentPage;
  final int totalPages;
  final IconData icon;
  final List<Color> iconGradient;
  final String title;
  final String subtitle;
  final Widget mockupChild;
  final VoidCallback onContinue;

  @override
  State<_FeaturePage> createState() => _FeaturePageState();
}

class _FeaturePageState extends State<_FeaturePage>
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
  void didUpdateWidget(_FeaturePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Animate when this page becomes active
    if (widget.currentPage == widget.pageIndex &&
        oldWidget.currentPage != widget.pageIndex) {
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
    final screenSize = MediaQuery.of(context).size;
    final isTablet = screenSize.width > 600;

    // Start animation if this is the current page
    if (widget.currentPage == widget.pageIndex && !_controller.isAnimating) {
      _controller.forward(from: 0);
    }

    return SafeArea(
      child: Column(
        children: [
          // Step dots
          Padding(
            padding: const EdgeInsets.only(top: 20),
            child: _StepDots(
              currentPage: widget.currentPage,
              totalPages: widget.totalPages,
            ),
          ),
          const SizedBox(height: 24),
          // Mockup area
          Expanded(
            flex: 5,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: isTablet ? 48 : 24),
              child: FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
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
                            0.6,
                            curve: Curves.easeOutCubic,
                          ),
                        ),
                      ),
                  child: _PhoneMockup(child: widget.mockupChild),
                ),
              ),
            ),
          ),
          // Text content
          Expanded(
            flex: 2,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: isTablet ? 64 : 32),
              child: FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.3, 0.8, curve: Curves.easeOut),
                ),
                child: Column(
                  children: [
                    // Icon badge
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: widget.iconGradient),
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: widget.iconGradient.first.withValues(
                              alpha: 0.4,
                            ),
                            blurRadius: 16,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: Icon(widget.icon, color: Colors.white, size: 26),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      widget.title,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: isTablet ? 28 : 24,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      widget.subtitle,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: isTablet ? 16 : 15,
                        color: Colors.white.withValues(alpha: 0.6),
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Continue button
          Padding(
            padding: EdgeInsets.fromLTRB(24, 0, 24, isTablet ? 48 : 32),
            child: FadeTransition(
              opacity: CurvedAnimation(
                parent: _controller,
                curve: const Interval(0.5, 1.0, curve: Curves.easeOut),
              ),
              child: _PrimaryButton(
                label: 'Continue',
                onPressed: widget.onContinue,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// PAGE 5: GET STARTED
// =============================================================================

class _GetStartedPage extends StatefulWidget {
  const _GetStartedPage({
    required this.currentPage,
    required this.totalPages,
    required this.onSetupNeeded,
    required this.onAlreadySetup,
  });

  final int currentPage;
  final int totalPages;
  final VoidCallback onSetupNeeded;
  final VoidCallback onAlreadySetup;

  @override
  State<_GetStartedPage> createState() => _GetStartedPageState();
}

class _GetStartedPageState extends State<_GetStartedPage>
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
  void didUpdateWidget(_GetStartedPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentPage == widget.totalPages - 1 &&
        oldWidget.currentPage != widget.totalPages - 1) {
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
    final screenSize = MediaQuery.of(context).size;
    final isTablet = screenSize.width > 600;

    if (widget.currentPage == widget.totalPages - 1 &&
        !_controller.isAnimating) {
      _controller.forward(from: 0);
    }

    return SafeArea(
      child: Column(
        children: [
          // Step dots
          Padding(
            padding: const EdgeInsets.only(top: 20),
            child: _StepDots(
              currentPage: widget.currentPage,
              totalPages: widget.totalPages,
            ),
          ),
          const Spacer(flex: 1),
          // Illustration
          FadeTransition(
            opacity: CurvedAnimation(
              parent: _controller,
              curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
            ),
            child: _ConnectionIllustration(isTablet: isTablet),
          ),
          const SizedBox(height: 40),
          // Text
          FadeTransition(
            opacity: CurvedAnimation(
              parent: _controller,
              curve: const Interval(0.2, 0.7, curve: Curves.easeOut),
            ),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: isTablet ? 64 : 32),
              child: Column(
                children: [
                  Text(
                    'Connect to your Mac',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: isTablet ? 32 : 28,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Broski connects to a lightweight bridge running on your development machine.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: isTablet ? 17 : 16,
                      color: Colors.white.withValues(alpha: 0.6),
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const Spacer(flex: 1),
          // Buttons
          FadeTransition(
            opacity: CurvedAnimation(
              parent: _controller,
              curve: const Interval(0.4, 1.0, curve: Curves.easeOut),
            ),
            child: Padding(
              padding: EdgeInsets.fromLTRB(24, 0, 24, isTablet ? 48 : 32),
              child: Column(
                children: [
                  _PrimaryButton(
                    label: 'Set up my Mac',
                    onPressed: widget.onSetupNeeded,
                  ),
                  const SizedBox(height: 12),
                  _SecondaryButton(
                    label: 'I already have the bridge running',
                    onPressed: widget.onAlreadySetup,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// MOCKUPS & ILLUSTRATIONS
// =============================================================================

class _PhoneMockup extends StatelessWidget {
  const _PhoneMockup({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 320),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(36),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.1),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
            blurRadius: 40,
            offset: const Offset(0, 20),
          ),
        ],
      ),
      child: ClipRRect(borderRadius: BorderRadius.circular(35), child: child),
    );
  }
}

class _ChatMockup extends StatelessWidget {
  const _ChatMockup();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0D0D0D),
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          // Status bar area
          const SizedBox(height: 20),
          // Header
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: const Color(0xFF6366F1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.code, color: Colors.white, size: 18),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Claude Code',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    'broski-app',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),
          // Chat messages
          _MockChatBubble(
            text: 'Add dark mode support to the settings screen',
            isUser: true,
          ),
          const SizedBox(height: 16),
          _MockChatBubble(
            text:
                "I'll add dark mode toggle to settings. First, let me check the current theme implementation...",
            isUser: false,
          ),
          const SizedBox(height: 12),
          // Thinking indicator
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E1E),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFF6366F1).withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: const Color(0xFF6366F1).withValues(alpha: 0.7),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  'Reading theme_provider.dart...',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          const Spacer(),
          // Input area
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A1A),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.add_rounded,
                  color: Colors.white.withValues(alpha: 0.4),
                  size: 22,
                ),
                const SizedBox(width: 12),
                Text(
                  'Message...',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.3),
                    fontSize: 15,
                  ),
                ),
                const Spacer(),
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.arrow_upward_rounded,
                    color: Colors.white,
                    size: 18,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _MockChatBubble extends StatelessWidget {
  const _MockChatBubble({required this.text, required this.isUser});

  final String text;
  final bool isUser;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 260),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFF6366F1) : const Color(0xFF1E1E1E),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: isUser ? Colors.white : Colors.white.withValues(alpha: 0.9),
            fontSize: 14,
            height: 1.4,
          ),
        ),
      ),
    );
  }
}

class _TerminalMockup extends StatelessWidget {
  const _TerminalMockup();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0D0D0D),
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          const SizedBox(height: 20),
          // Header
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFF59E0B).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: const Color(0xFFF59E0B).withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.warning_amber_rounded,
                      color: Color(0xFFF59E0B),
                      size: 16,
                    ),
                    const SizedBox(width: 6),
                    const Text(
                      'Permission Required',
                      style: TextStyle(
                        color: Color(0xFFF59E0B),
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          // Command box
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A1A),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.terminal_rounded,
                      color: Colors.white.withValues(alpha: 0.5),
                      size: 16,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'bash',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.5),
                        fontSize: 12,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text(
                  'rm -rf node_modules && npm install',
                  style: TextStyle(
                    color: Color(0xFF10B981),
                    fontSize: 14,
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Claude Code wants to run this command',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 14,
            ),
          ),
          const Spacer(),
          // Action buttons
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E1E1E),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.1),
                    ),
                  ),
                  child: const Center(
                    child: Text(
                      'Deny',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF10B981), Color(0xFF059669)],
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Center(
                    child: Text(
                      'Approve',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _DiffMockup extends StatelessWidget {
  const _DiffMockup();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0D0D0D),
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          const SizedBox(height: 20),
          // File header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A1A),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.description_outlined,
                  color: Color(0xFFF59E0B),
                  size: 18,
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    'lib/screens/settings_screen.dart',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontFamily: 'monospace',
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF10B981).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    '+24 -8',
                    style: TextStyle(
                      color: Color(0xFF10B981),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          // Diff lines
          Expanded(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A1A),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _DiffLine(
                    lineNum: '42',
                    text: '  bool isDarkMode = false;',
                    type: _DiffType.removed,
                  ),
                  _DiffLine(
                    lineNum: '42',
                    text: '  bool isDarkMode = true;',
                    type: _DiffType.added,
                  ),
                  _DiffLine(lineNum: '43', text: '', type: _DiffType.context),
                  _DiffLine(
                    lineNum: '44',
                    text: '  // Theme toggle handler',
                    type: _DiffType.added,
                  ),
                  _DiffLine(
                    lineNum: '45',
                    text: '  void toggleTheme() {',
                    type: _DiffType.added,
                  ),
                  _DiffLine(
                    lineNum: '46',
                    text: '    setState(() {',
                    type: _DiffType.added,
                  ),
                  _DiffLine(
                    lineNum: '47',
                    text: '      isDarkMode = !isDarkMode;',
                    type: _DiffType.added,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

enum _DiffType { added, removed, context }

class _DiffLine extends StatelessWidget {
  const _DiffLine({
    required this.lineNum,
    required this.text,
    required this.type,
  });

  final String lineNum;
  final String text;
  final _DiffType type;

  @override
  Widget build(BuildContext context) {
    final (bgColor, textColor, prefix) = switch (type) {
      _DiffType.added => (
        const Color(0xFF10B981).withValues(alpha: 0.15),
        const Color(0xFF6EE7B7),
        '+',
      ),
      _DiffType.removed => (
        const Color(0xFFEF4444).withValues(alpha: 0.15),
        const Color(0xFFFCA5A5),
        '-',
      ),
      _DiffType.context => (
        Colors.transparent,
        Colors.white.withValues(alpha: 0.4),
        ' ',
      ),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            child: Text(
              lineNum,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.3),
                fontSize: 11,
                fontFamily: 'monospace',
              ),
            ),
          ),
          Text(
            prefix,
            style: TextStyle(
              color: textColor,
              fontSize: 12,
              fontFamily: 'monospace',
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: textColor,
                fontSize: 12,
                fontFamily: 'monospace',
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _ConnectionIllustration extends StatelessWidget {
  const _ConnectionIllustration({required this.isTablet});

  final bool isTablet;

  @override
  Widget build(BuildContext context) {
    final size = isTablet ? 180.0 : 140.0;

    return SizedBox(
      height: size * 1.2,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Connection line
          Positioned(
            child: Container(
              width: size * 1.6,
              height: 3,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    const Color(0xFF6366F1).withValues(alpha: 0.6),
                    const Color(0xFF10B981).withValues(alpha: 0.6),
                  ],
                ),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          // Animated dots on line
          ...List.generate(3, (index) {
            return Positioned(
              left: size * 0.3 + (index * size * 0.5),
              child: TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: 1),
                duration: Duration(milliseconds: 1500 + (index * 200)),
                builder: (context, value, child) {
                  return Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: Color.lerp(
                        const Color(0xFF6366F1),
                        const Color(0xFF10B981),
                        (index / 2),
                      ),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF6366F1).withValues(alpha: 0.5),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                  );
                },
              ),
            );
          }),
          // Phone
          Positioned(
            left: 0,
            child: Container(
              width: size * 0.55,
              height: size,
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A1A),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.1),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF6366F1).withValues(alpha: 0.3),
                    blurRadius: 30,
                    offset: const Offset(-10, 10),
                  ),
                ],
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Center(
                      child: Text(
                        'B',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 20,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'iPhone',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.6),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Mac
          Positioned(
            right: 0,
            child: Container(
              width: size * 0.85,
              height: size * 0.7,
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A1A),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.1),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF10B981).withValues(alpha: 0.3),
                    blurRadius: 30,
                    offset: const Offset(10, 10),
                  ),
                ],
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.laptop_mac_rounded,
                    color: Color(0xFF10B981),
                    size: 36,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Your Mac',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.6),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// BUTTONS
// =============================================================================

class _PrimaryButton extends StatefulWidget {
  const _PrimaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  State<_PrimaryButton> createState() => _PrimaryButtonState();
}

class _PrimaryButtonState extends State<_PrimaryButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 0.97,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => _controller.forward(),
      onTapUp: (_) {
        _controller.reverse();
        HapticFeedback.lightImpact();
        widget.onPressed();
      },
      onTapCancel: () => _controller.reverse(),
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) {
          return Transform.scale(scale: _scaleAnimation.value, child: child);
        },
        child: Container(
          width: double.infinity,
          height: 56,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.25),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Center(
            child: Text(
              widget.label,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 17,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.2,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  const _SecondaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
        onPressed();
      },
      child: Container(
        width: double.infinity,
        height: 56,
        decoration: BoxDecoration(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}
