import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../theme/design_tokens.dart';
import 'session_history_card.dart';

// =============================================================================
// PAGE 5: SAFETY NET (ROLLBACK / UNDO)
// =============================================================================
class SafetyNetPage extends StatefulWidget {
  const SafetyNetPage({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });
  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;
  @override
  State<SafetyNetPage> createState() => _SafetyNetPageState();
}

class _SafetyNetPageState extends State<SafetyNetPage>
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
  void didUpdateWidget(SafetyNetPage oldWidget) {
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
    if (widget.currentPage == 5 && !_controller.isAnimating) {
      _controller.forward(from: 0);
    }
    return Container(
      color: Colors.black,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(height: Spacing.xxxl),
              // ── Title
              FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
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
                            0.0,
                            0.5,
                            curve: Curves.easeOutCubic,
                          ),
                        ),
                      ),
                  child: const Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: 'Agent broke it?\n',
                          style: TextStyle(
                            fontFamily: 'GeistPixel',
                            fontSize: 42,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            height: 1.08,
                            letterSpacing: -1,
                          ),
                        ),
                        TextSpan(
                          text: 'One tap. Gone.',
                          style: TextStyle(
                            fontFamily: 'GeistPixel',
                            fontSize: 42,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFFF6B6B),
                            height: 1.08,
                            letterSpacing: -1,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              SizedBox(height: Spacing.xl),
              // ── Session History mockup card
              Expanded(
                child: FadeTransition(
                  opacity: CurvedAnimation(
                    parent: _controller,
                    curve: const Interval(0.15, 0.65, curve: Curves.easeOut),
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
                              0.15,
                              0.65,
                              curve: Curves.easeOutCubic,
                            ),
                          ),
                        ),
                    child: const OnboardingSessionHistoryCard(),
                  ),
                ),
              ),
              SizedBox(height: Spacing.xl),
              // ── Subtitle
              FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.35, 0.85, curve: Curves.easeOut),
                ),
                child: Text(
                  'See what changed, undo what shouldn\'t have. Full history of every agent session at your fingertips.',
                  style: TextStyle(
                    fontFamily: 'GeistSans',
                    fontSize: 16,
                    color: Colors.white.withValues(alpha: 0.55),
                    height: 1.45,
                  ),
                ),
              ),
              SizedBox(height: Spacing.xl),
              // ── "Continue" button
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
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}
