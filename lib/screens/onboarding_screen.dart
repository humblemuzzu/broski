import 'dart:async';

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

  // Total pages: Splash(0), Intro(1), Feature1(2), Feature2(3), Feature3(4), GetStarted(5)
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
          // Page 0: Logo Splash
          _LogoSplashPage(onComplete: _nextPage),

          // Page 1: Hero Intro with floating tiles
          _HeroIntroPage(
            onContinue: _nextPage,
            currentPage: _currentPage,
            totalPages: _totalPages,
          ),

          // Page 2: Feature - Chat from Anywhere
          _FeaturePage(
            pageIndex: 2,
            currentPage: _currentPage,
            totalPages: _totalPages,
            icon: Icons.chat_bubble_rounded,
            iconGradient: const [Color(0xFF6366F1), Color(0xFF8B5CF6)],
            title: 'Chat from Anywhere',
            subtitle:
                'Talk to your AI coding agents from your phone. Review context, ask questions, and guide the work in real-time.',
            mockupChild: const _ChatMockup(),
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
// PAGE 0: LOGO SPLASH
// =============================================================================

class _LogoSplashPage extends StatefulWidget {
  const _LogoSplashPage({required this.onComplete});

  final VoidCallback onComplete;

  @override
  State<_LogoSplashPage> createState() => _LogoSplashPageState();
}

class _LogoSplashPageState extends State<_LogoSplashPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _opacityAnimation;
  late Animation<double> _glowAnimation;
  Timer? _autoAdvanceTimer;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );

    _scaleAnimation = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.6, curve: Curves.elasticOut),
      ),
    );

    _opacityAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.4, curve: Curves.easeOut),
      ),
    );

    _glowAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.3, 1.0, curve: Curves.easeOut),
      ),
    );

    _controller.forward();

    // Auto-advance after 2.5 seconds
    _autoAdvanceTimer = Timer(const Duration(milliseconds: 2500), () {
      widget.onComplete();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _autoAdvanceTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        _autoAdvanceTimer?.cancel();
        widget.onComplete();
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        color: Colors.black,
        child: Center(
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              return Transform.scale(
                scale: _scaleAnimation.value,
                child: Opacity(
                  opacity: _opacityAnimation.value,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Logo with glow
                      Container(
                        width: 120,
                        height: 120,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [Color(0xFF3B82F6), Color(0xFF8B5CF6)],
                          ),
                          borderRadius: BorderRadius.circular(32),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(
                                0xFF6366F1,
                              ).withValues(alpha: 0.5 * _glowAnimation.value),
                              blurRadius: 60 * _glowAnimation.value,
                              spreadRadius: 10 * _glowAnimation.value,
                            ),
                          ],
                        ),
                        child: const Center(
                          child: Text(
                            'B',
                            style: TextStyle(
                              fontSize: 64,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                              letterSpacing: -2,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 32),
                      // App name
                      ShaderMask(
                        shaderCallback: (bounds) => const LinearGradient(
                          colors: [Colors.white, Color(0xFFB4B4B4)],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ).createShader(bounds),
                        child: const Text(
                          'Broski',
                          style: TextStyle(
                            fontSize: 42,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                            letterSpacing: -1,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// PAGE 1: HERO INTRO WITH FLOATING TILES
// =============================================================================

class _HeroIntroPage extends StatefulWidget {
  const _HeroIntroPage({
    required this.onContinue,
    required this.currentPage,
    required this.totalPages,
  });

  final VoidCallback onContinue;
  final int currentPage;
  final int totalPages;

  @override
  State<_HeroIntroPage> createState() => _HeroIntroPageState();
}

class _HeroIntroPageState extends State<_HeroIntroPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..forward();
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
          // Floating tiles area
          Expanded(
            flex: 3,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                // Animated floating tiles
                ..._buildFloatingTiles(screenSize, isTablet),
                // Center content
                Center(
                  child: FadeTransition(
                    opacity: CurvedAnimation(
                      parent: _controller,
                      curve: const Interval(0.3, 0.8, curve: Curves.easeOut),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        RichText(
                          textAlign: TextAlign.center,
                          text: TextSpan(
                            style: TextStyle(
                              fontSize: isTablet ? 42 : 34,
                              fontWeight: FontWeight.w700,
                              height: 1.2,
                            ),
                            children: const [
                              TextSpan(
                                text: 'Your AI agents,\n',
                                style: TextStyle(color: Colors.white),
                              ),
                              TextSpan(
                                text: 'in your pocket',
                                style: TextStyle(
                                  foreground: null, // Will use gradient
                                  color: Color(0xFF60A5FA),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'Control AI coding agents from anywhere',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: isTablet ? 18 : 16,
                            color: Colors.white.withValues(alpha: 0.6),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Bottom section with button
          Padding(
            padding: EdgeInsets.fromLTRB(24, 0, 24, isTablet ? 48 : 32),
            child: FadeTransition(
              opacity: CurvedAnimation(
                parent: _controller,
                curve: const Interval(0.5, 1.0, curve: Curves.easeOut),
              ),
              child: _PrimaryButton(
                label: 'Get started',
                onPressed: widget.onContinue,
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildFloatingTiles(Size screenSize, bool isTablet) {
    final tileSize = isTablet ? 90.0 : 70.0;
    final tiles = <_FloatingTileData>[
      // Top left - Terminal icon
      _FloatingTileData(
        offset: Offset(-screenSize.width * 0.32, -screenSize.height * 0.12),
        icon: Icons.terminal_rounded,
        gradient: const [Color(0xFF10B981), Color(0xFF059669)],
        delay: 0.0,
      ),
      // Top right - Code icon
      _FloatingTileData(
        offset: Offset(screenSize.width * 0.32, -screenSize.height * 0.12),
        icon: Icons.code_rounded,
        gradient: const [Color(0xFF6366F1), Color(0xFF8B5CF6)],
        delay: 0.1,
      ),
      // Left - Chat icon
      _FloatingTileData(
        offset: Offset(-screenSize.width * 0.38, screenSize.height * 0.02),
        icon: Icons.chat_bubble_rounded,
        gradient: const [Color(0xFF3B82F6), Color(0xFF2563EB)],
        delay: 0.2,
      ),
      // Right - File diff icon
      _FloatingTileData(
        offset: Offset(screenSize.width * 0.38, screenSize.height * 0.02),
        icon: Icons.difference_rounded,
        gradient: const [Color(0xFFF59E0B), Color(0xFFD97706)],
        delay: 0.15,
      ),
      // Bottom left - Folder icon
      _FloatingTileData(
        offset: Offset(-screenSize.width * 0.32, screenSize.height * 0.14),
        icon: Icons.folder_rounded,
        gradient: const [Color(0xFFEC4899), Color(0xFFDB2777)],
        delay: 0.25,
      ),
      // Bottom right - Settings/gear icon
      _FloatingTileData(
        offset: Offset(screenSize.width * 0.32, screenSize.height * 0.14),
        icon: Icons.settings_rounded,
        gradient: const [Color(0xFF8B5CF6), Color(0xFF7C3AED)],
        delay: 0.3,
      ),
    ];

    return tiles.map((tile) {
      return AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          final delay = tile.delay;
          final progress = ((_controller.value - delay) / (1 - delay)).clamp(
            0.0,
            1.0,
          );
          final curvedProgress = Curves.easeOutBack.transform(progress);

          return Positioned(
            left: screenSize.width / 2 + tile.offset.dx - tileSize / 2,
            top: screenSize.height / 2 + tile.offset.dy - tileSize / 2,
            child: Transform.scale(
              scale: curvedProgress,
              child: Opacity(
                opacity: curvedProgress,
                child: _FloatingTile(
                  size: tileSize,
                  icon: tile.icon,
                  gradient: tile.gradient,
                ),
              ),
            ),
          );
        },
      );
    }).toList();
  }
}

class _FloatingTileData {
  const _FloatingTileData({
    required this.offset,
    required this.icon,
    required this.gradient,
    required this.delay,
  });

  final Offset offset;
  final IconData icon;
  final List<Color> gradient;
  final double delay;
}

class _FloatingTile extends StatelessWidget {
  const _FloatingTile({
    required this.size,
    required this.icon,
    required this.gradient,
  });

  final double size;
  final IconData icon;
  final List<Color> gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: gradient,
        ),
        borderRadius: BorderRadius.circular(size * 0.28),
        boxShadow: [
          BoxShadow(
            color: gradient.first.withValues(alpha: 0.4),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Icon(icon, color: Colors.white, size: size * 0.45),
    );
  }
}

// =============================================================================
// FEATURE PAGES (2, 3, 4)
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
    if (widget.currentPage == 5 && oldWidget.currentPage != 5) {
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

    if (widget.currentPage == 5 && !_controller.isAnimating) {
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
