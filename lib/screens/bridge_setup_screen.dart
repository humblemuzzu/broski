import 'dart:async';
import 'dart:io';

import 'package:broski/providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;
import 'package:broski/screens/onboarding/bridge_setup_widgets.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/responsive.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// "Run the Bridge" screen shown during onboarding.
/// Pixel-perfect terminal mockup matching Figma design.
class BridgeSetupScreen extends ConsumerStatefulWidget {
  const BridgeSetupScreen({super.key});
  @override
  ConsumerState<BridgeSetupScreen> createState() => _BridgeSetupScreenState();
}

class _BridgeSetupScreenState extends ConsumerState<BridgeSetupScreen>
    with TickerProviderStateMixin {
  late AnimationController _cursorController;
  late AnimationController _entryController;
  int _copiedIndex = -1;
  static const _installCmd = 'curl -fsSL https://broskiapp.com/install | sh';
  static const _daemonCmd = 'broski install';
  static const _pairCmd = 'broski-link pair';
  @override
  void initState() {
    super.initState();
    _cursorController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);
    _entryController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..forward();

    // Pre-prompt iOS Local Network permission by making a dummy request.
    // iOS shows the "Allow app to find devices on local network?" dialog on
    // the first local network access after a fresh install. By triggering it
    // here (while the user is reading setup instructions), the permission is
    // already granted by the time they scan the QR code and we attempt the
    // real WebSocket connection. The request silently fails — we don't care
    // about the result, only about triggering the OS dialog.
    if (!kIsWeb) {
      _prePromptLocalNetworkPermission();
    }
  }

  /// Trigger iOS Local Network permission dialog early.
  /// Makes a throwaway HTTP request to a non-routable local IP.
  /// The connection will fail (expected), but iOS will show the
  /// permission dialog if it hasn't been granted yet.
  void _prePromptLocalNetworkPermission() {
    Future.microtask(() async {
      try {
        final client = HttpClient();
        client.connectionTimeout = const Duration(milliseconds: 500);
        // 192.0.0.8 is an IANA dummy/documentation IP — guaranteed not to
        // route, but the outbound attempt is enough to trigger the iOS
        // Local Network permission prompt.
        final request = await client.getUrl(
          Uri.parse('http://192.0.0.8:18274/ping'),
        );
        await request.close().timeout(
          const Duration(milliseconds: 500),
          onTimeout: () => throw TimeoutException('expected'),
        );
      } catch (_) {
        // Expected to fail — we only care about triggering the OS dialog.
      }
    });
  }

  @override
  void dispose() {
    _cursorController.dispose();
    _entryController.dispose();
    super.dispose();
  }

  void _copyCommand(int index, String command) {
    Clipboard.setData(ClipboardData(text: command));
    HapticFeedback.lightImpact();
    setState(() => _copiedIndex = index);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copiedIndex = -1);
    });
  }

  @override
  Widget build(BuildContext context) {
    final entry = CurvedAnimation(
      parent: _entryController,
      curve: Curves.easeOutCubic,
    );
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: SafeArea(
        child: Padding(
          padding: Responsive.isTablet(context)
              ? const EdgeInsets.symmetric(horizontal: 80, vertical: 24)
              : Insets.section,
          child: Column(
            children: [
              // ── Main dark card
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFF111111),
                    borderRadius: Radii.brXxl,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.06),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // ── Step 1: Install
                          FadeTransition(
                            opacity: entry,
                            child: const BridgeStepHeader(
                              number: '1',
                              title: 'Install Broski',
                            ),
                          ),
                          const SizedBox(height: 14),
                          FadeTransition(
                            opacity: entry,
                            child: Text(
                              'Open your terminal on your Mac and run\nthis command to install the bridge.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.45),
                                fontSize: 15,
                                height: 1.5,
                              ),
                            ),
                          ),
                          const SizedBox(height: Spacing.xl),
                          FadeTransition(
                            opacity: entry,
                            child: TerminalCommandCard(
                              copied: _copiedIndex == 0,
                              cursor: _cursorController,
                              prefix: 'curl',
                              rest: ' -fsSL https://broskiapp.com/install | sh',
                              command: _installCmd,
                              onCopy: () => _copyCommand(0, _installCmd),
                            ),
                          ),
                          const SizedBox(height: Spacing.xxxl),
                          // ── Step 2: Run
                          FadeTransition(
                            opacity: entry,
                            child: const BridgeStepHeader(
                              number: '2',
                              title: 'Keep it running',
                            ),
                          ),
                          const SizedBox(height: 14),
                          FadeTransition(
                            opacity: entry,
                            child: Text(
                              'Start Broski in the background, then show the pairing code.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.45),
                                fontSize: 15,
                                height: 1.5,
                              ),
                            ),
                          ),
                          const SizedBox(height: Spacing.xl),
                          FadeTransition(
                            opacity: entry,
                            child: BridgeOptionCard(
                              copied: _copiedIndex == 1,
                              label: 'Always on',
                              description:
                                  'Starts with your Mac and restarts itself',
                              prefix: 'broski',
                              rest: ' install',
                              command: _daemonCmd,
                              onCopy: () => _copyCommand(1, _daemonCmd),
                            ),
                          ),
                          const SizedBox(height: Spacing.md),
                          FadeTransition(
                            opacity: entry,
                            child: BridgeOptionCard(
                              copied: _copiedIndex == 2,
                              label: 'Pair this phone',
                              description: 'Shows a QR code to scan next',
                              prefix: 'broski-link',
                              rest: ' pair',
                              command: _pairCmd,
                              onCopy: () => _copyCommand(2, _pairCmd),
                            ),
                          ),
                          const SizedBox(height: Spacing.xxl),
                          // ── Info hint
                          FadeTransition(
                            opacity: entry,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.04),
                                borderRadius: Radii.brLg,
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.06),
                                ),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    AppIcons.info,
                                    color: Colors.white.withValues(alpha: 0.3),
                                    size: 20,
                                  ),
                                  const SizedBox(width: Spacing.md),
                                  Expanded(
                                    child: Text(
                                      'Pair once. Your phone remembers this machine and reconnects on its own.',
                                      style: TextStyle(
                                        color: Colors.white.withValues(
                                          alpha: 0.4,
                                        ),
                                        fontSize: 13,
                                        height: 1.45,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xl),
              // ── CTA button
              FadeTransition(
                opacity: entry,
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    ref.read(onboardingProvider.notifier).goToScanner();
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
                        'I have the QR Code',
                        style: TextStyle(
                          color: Colors.black,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              // DEV BYPASS (only in debug builds)
              if (kDebugMode && kDevBypassOnboarding) ...[
                const SizedBox(height: 14),
                Center(
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      ref.read(onboardingProvider.notifier).skipForward();
                    },
                    child: Text(
                      'Skip (dev) \u2192',
                      style: TextStyle(
                        color: Colors.red.withValues(alpha: 0.6),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: Spacing.md),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Widgets
  // ---------------------------------------------------------------------------
}
