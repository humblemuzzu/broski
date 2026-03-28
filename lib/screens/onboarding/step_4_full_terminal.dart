import 'package:broski/screens/onboarding/terminal_window_card.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// =============================================================================
// PAGE 4: FULL TERMINAL
// =============================================================================
class FullTerminalPage extends StatefulWidget {
  const FullTerminalPage({
    super.key,
    required this.currentPage,
    required this.totalPages,
    required this.onContinue,
  });
  final int currentPage;
  final int totalPages;
  final VoidCallback onContinue;
  @override
  State<FullTerminalPage> createState() => _FullTerminalPageState();
}

class _FullTerminalPageState extends State<FullTerminalPage>
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
  void didUpdateWidget(FullTerminalPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentPage == 4 && oldWidget.currentPage != 4) {
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
    if (widget.currentPage == 4 && !_controller.isAnimating) {
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
              const SizedBox(height: Spacing.xxxl),
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
                          text: 'Full Terminal.\n',
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
                          text: 'No Laptop\nRequired.',
                          style: TextStyle(
                            fontFamily: 'GeistPixel',
                            fontSize: 42,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF555555),
                            height: 1.08,
                            letterSpacing: -1,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xxl),
              // ── Terminal mockup card
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
                    child: const OnboardingTerminalCard(),
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xl),
              // ── Subtitle
              FadeTransition(
                opacity: CurvedAnimation(
                  parent: _controller,
                  curve: const Interval(0.35, 0.85, curve: Curves.easeOut),
                ),
                child: Text(
                  "SSH, PTY, full shell access. It's not a simulation.\nIt's your actual machine, in your pocket.",
                  style: TextStyle(
                    fontFamily: 'GeistSans',
                    fontSize: 16,
                    color: Colors.white.withValues(alpha: 0.55),
                    height: 1.45,
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xl),
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
