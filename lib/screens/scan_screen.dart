import 'dart:io';

import 'package:broski/models/connection.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;
import 'package:broski/screens/scan/link_pairing_dialog.dart';
import 'package:broski/screens/scan/paste_pairing_link.dart';
import 'package:broski/screens/scan/scan_overlay.dart';
import 'package:broski/services/websocket_service.dart' show ConnectionStatus;
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/onboarding_widgets.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});
  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen>
    with TickerProviderStateMixin {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _handledScan = false;
  bool _flashOn = false;
  bool _processingImage = false;
  late AnimationController _scanLineController;
  late AnimationController _cornerPulseController;
  @override
  void initState() {
    super.initState();
    // Scan line animation - bounces up and down
    _scanLineController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2500),
    )..repeat(reverse: true);
    // Corner bracket pulse
    _cornerPulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);

    // Listen for connection failures and reset the scan flag so the user
    // can re-scan without having to close and reopen the app.
    // We use addPostFrameCallback to defer the listen call — ref.listen
    // must not be called during initState (before the first build).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.listenManual(connectionProvider, (previous, next) {
        final justFailed =
            next.status == ConnectionStatus.disconnected &&
            previous?.status == ConnectionStatus.connecting &&
            next.lastEvent == ConnectionEvent.failed;

        if (_handledScan && justFailed) {
          setState(() => _handledScan = false);
        }

        if (justFailed && next.error != null && next.error!.isNotEmpty) {
          showError(context, next.error!);
        }
      });
    });
  }

  @override
  void dispose() {
    _scannerController.dispose();
    _scanLineController.dispose();
    _cornerPulseController.dispose();
    super.dispose();
  }

  void _handleScan(String raw) {
    if (_handledScan) return;
    if (startLinkPairing(context, raw, onDismiss: _onLinkPairingDismissed)) {
      _handledScan = true;
      HapticFeedback.mediumImpact();
      return;
    }
    final info = ConnectionInfo.parseQrPayload(raw);
    if (info == null) return;
    _handledScan = true;
    HapticFeedback.mediumImpact();
    // Clear any in-flight reconnect so connect() is not skipped due to
    // _isConnecting being true from an auto-reconnect cycle.
    final notifier = ref.read(connectionProvider.notifier);
    notifier.cancelPendingReconnect();
    notifier.connect(info);
  }

  /// A finished Link pairing closes a scanner that was only opened for it, and
  /// leaves the onboarding scanner ready for the next QR.
  void _onLinkPairingDismissed() {
    if (!mounted) return;
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _handledScan = false);
  }

  void _toggleFlash() {
    _scannerController.toggleTorch();
    HapticFeedback.lightImpact();
    setState(() => _flashOn = !_flashOn);
  }

  Future<void> _pickFromGallery() async {
    if (_processingImage) return;
    setState(() => _processingImage = true);
    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
      );
      if (image == null) {
        if (mounted) setState(() => _processingImage = false);
        return;
      }
      final file = File(image.path);
      if (!file.existsSync()) {
        if (mounted) setState(() => _processingImage = false);
        return;
      }
      // Use MobileScanner to analyze the image
      final barcodeCapture = await _scannerController.analyzeImage(image.path);
      if (barcodeCapture != null && barcodeCapture.barcodes.isNotEmpty) {
        final raw = barcodeCapture.barcodes.first.rawValue;
        if (raw != null) {
          _handleScan(raw);
          if (mounted) setState(() => _processingImage = false);
          return;
        }
      }
      // No QR code found in image
      if (mounted) {
        setState(() => _processingImage = false);
        showInfo(context, 'No QR code found in the selected image.');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _processingImage = false);
        showError(context, 'Failed to process image: ${humanizeError(e)}');
      }
    }
  }

  void _dismiss() {
    // If in onboarding flow, go back to bridge setup
    final onboarding = ref.read(onboardingProvider);
    if (!onboarding.hasCompletedOnboarding) {
      // Cancel any in-flight connection attempt and clear saved connection
      // state so we start fresh when the user comes back to scan again.
      // Without this, an orphaned connection/reconnect state could cause the
      // scanner to immediately show the connecting overlay on re-entry.
      ref.read(connectionProvider.notifier).clearConnection();
      _handledScan = false;
      ref.read(onboardingProvider.notifier).goBack();
    } else {
      // After onboarding complete, just pop the screen
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Full-screen camera
          Positioned.fill(
            child: MobileScanner(
              controller: _scannerController,
              onDetect: (capture) {
                final barcode = capture.barcodes.first;
                final raw = barcode.rawValue;
                if (raw == null) return;
                _handleScan(raw);
              },
            ),
          ),
          // Dark overlay with cutout for scan area
          Positioned.fill(
            child: ScanOverlay(
              scanLineAnimation: _scanLineController,
              cornerPulseAnimation: _cornerPulseController,
            ),
          ),
          // Top header
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 16,
                ),
                child: Column(
                  children: [
                    const Text(
                      'Scan QR Code',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Align the QR code from your terminal',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.6),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Bottom controls
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Control bar
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Flash toggle
                        _ControlButton(
                          icon: _flashOn ? AppIcons.flashOn : AppIcons.flashOff,
                          onTap: _toggleFlash,
                          isActive: _flashOn,
                        ),
                        const SizedBox(width: Spacing.lg),
                        // Camera active indicator
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.1),
                            borderRadius: Radii.brXl,
                          ),
                          child: Text(
                            'CAMERA ACTIVE',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.5),
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 1.2,
                            ),
                          ),
                        ),
                        const SizedBox(width: Spacing.lg),
                        // Close / back button
                        _ControlButton(icon: AppIcons.close, onTap: _dismiss),
                      ],
                    ),
                    const SizedBox(height: Spacing.xl),
                    // Gallery upload row
                    Row(
                      children: [
                        Expanded(
                          child: GestureDetector(
                            onTap: _processingImage ? null : _pickFromGallery,
                            child: Container(
                              height: 50,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.08),
                                borderRadius: Radii.brLg,
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.1),
                                ),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  if (_processingImage)
                                    SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white.withValues(
                                          alpha: 0.6,
                                        ),
                                      ),
                                    )
                                  else
                                    Icon(
                                      AppIcons.photoLibrary,
                                      color: Colors.white.withValues(
                                        alpha: 0.6,
                                      ),
                                      size: 20,
                                    ),
                                  const SizedBox(width: 10),
                                  Text(
                                    _processingImage
                                        ? 'Scanning...'
                                        : 'Upload from Gallery',
                                    style: TextStyle(
                                      color: Colors.white.withValues(
                                        alpha: 0.6,
                                      ),
                                      fontSize: 14,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: Spacing.md),
                        // Manual entry
                        GestureDetector(
                          onTap: () => _showManualEntry(context),
                          child: Container(
                            height: 50,
                            width: 50,
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.08),
                              borderRadius: Radii.brLg,
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.1),
                              ),
                            ),
                            child: Icon(
                              AppIcons.keyboard,
                              color: Colors.white.withValues(alpha: 0.5),
                              size: 22,
                            ),
                          ),
                        ),
                        const SizedBox(width: Spacing.md),
                        PastePairingLinkButton(
                          onDismiss: _onLinkPairingDismissed,
                        ),
                      ],
                    ),
                    // DEV BYPASS: skip scan step (only in debug builds)
                    if (kDebugMode && kDevBypassOnboarding) ...[
                      const SizedBox(height: 14),
                      GestureDetector(
                        onTap: () {
                          HapticFeedback.lightImpact();
                          ref
                              .read(onboardingProvider.notifier)
                              .completeOnboarding();
                        },
                        child: Text(
                          'Skip scan (dev) \u2192',
                          style: TextStyle(
                            color: Colors.red.withValues(alpha: 0.7),
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showManualEntry(BuildContext context) async {
    final hostController = TextEditingController();
    final portController = TextEditingController(text: '18274');
    final tokenController = TextEditingController();
    bool useTls = false;
    String? parseError;
    // Try to parse QR JSON data from clipboard or pasted text
    void tryParseQrJson(String text, void Function(void Function()) setState) {
      final info = ConnectionInfo.parseQrPayload(text);
      if (info != null) {
        hostController.text =
            info.localIP ??
            info.tailscaleIP ??
            info.magicDNSHostname ??
            info.hotspotIP ??
            '';
        portController.text = info.port.toString();
        tokenController.text = info.authToken ?? '';
        setState(() {
          useTls = info.tlsEnabled;
          parseError = null;
        });
        HapticFeedback.mediumImpact();
      } else {
        setState(() => parseError = 'Could not parse QR data');
      }
    }

    final result = await DetailSheet.show<ConnectionInfo>(
      context: context,
      title: 'Manual Connection',
      initialSize: 0.72,
      child: StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Paste QR JSON button
              GestureDetector(
                onTap: () async {
                  final data = await Clipboard.getData(Clipboard.kTextPlain);
                  if (data?.text != null && data!.text!.isNotEmpty) {
                    tryParseQrJson(data.text!, setSheetState);
                  } else {
                    setSheetState(() => parseError = 'Clipboard is empty');
                  }
                },
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2ECB71).withValues(alpha: 0.15),
                    borderRadius: Radii.brMd,
                    border: Border.all(
                      color: const Color(0xFF2ECB71).withValues(alpha: 0.3),
                    ),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(AppIcons.paste, color: Color(0xFF2ECB71), size: 18),
                      SizedBox(width: Spacing.sm),
                      Text(
                        'Paste QR Code Data from Clipboard',
                        style: TextStyle(
                          color: Color(0xFF2ECB71),
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (parseError != null) ...[
                const SizedBox(height: Spacing.sm),
                Text(
                  parseError!,
                  style: TextStyle(
                    color: Colors.red.withValues(alpha: 0.8),
                    fontSize: 12,
                  ),
                ),
              ],
              const SizedBox(height: Spacing.lg),
              // Divider with "or enter manually"
              Row(
                children: [
                  Expanded(
                    child: Container(
                      height: 1,
                      color: Colors.white.withValues(alpha: 0.1),
                    ),
                  ),
                  Padding(
                    padding: Insets.cardH,
                    child: Text(
                      'or enter manually',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.4),
                        fontSize: 12,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Container(
                      height: 1,
                      color: Colors.white.withValues(alpha: 0.1),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Spacing.lg),
              _buildTextField(
                controller: hostController,
                label: 'Host (IP or hostname)',
                hint: '192.168.1.100 or hostname.ts.net',
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: Spacing.md),
              _buildTextField(
                controller: portController,
                label: 'Port',
                hint: '18274',
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: Spacing.md),
              _buildTextField(
                controller: tokenController,
                label: 'Auth Token',
                hint: 'Required for connection',
                keyboardType: TextInputType.visiblePassword,
              ),
              const SizedBox(height: Spacing.md),
              // TLS toggle
              GestureDetector(
                onTap: () => setSheetState(() => useTls = !useTls),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.06),
                    borderRadius: Radii.brMd,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.1),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        useTls ? AppIcons.lock : AppIcons.lockOpen,
                        color: useTls
                            ? const Color(0xFF2ECB71)
                            : Colors.white.withValues(alpha: 0.5),
                        size: 20,
                      ),
                      const SizedBox(width: Spacing.md),
                      Expanded(
                        child: Text(
                          'Use TLS (wss://)',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.7),
                            fontSize: 14,
                          ),
                        ),
                      ),
                      Container(
                        width: 44,
                        height: 26,
                        decoration: BoxDecoration(
                          color: useTls
                              ? const Color(0xFF2ECB71)
                              : Colors.white.withValues(alpha: 0.1),
                          borderRadius: Radii.brMd,
                        ),
                        child: AnimatedAlign(
                          duration: const Duration(milliseconds: 150),
                          alignment: useTls
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            width: 22,
                            height: 22,
                            margin: const EdgeInsets.symmetric(horizontal: 2),
                            decoration: const BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: Spacing.lg),
              OnboardingButton(
                label: 'Connect',
                onPressed: () {
                  final host = hostController.text.trim();
                  final port =
                      int.tryParse(portController.text.trim()) ?? 18274;
                  final token = tokenController.text.trim();
                  if (host.isEmpty) return;
                  Navigator.pop(
                    context,
                    ConnectionInfo(
                      localIP: host,
                      port: port,
                      authToken: token.isNotEmpty ? token : null,
                      tlsEnabled: useTls,
                    ),
                  );
                },
              ),
              const SizedBox(height: Spacing.sm),
              Center(
                child: Text(
                  'Run "broski show-token" in terminal to get the auth token',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.35),
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (result != null) {
      final notifier = ref.read(connectionProvider.notifier);
      notifier.cancelPendingReconnect();
      notifier.connect(result);
    }
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required String hint,
    TextInputType? keyboardType,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.7),
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: Spacing.sm),
        Container(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.06),
            borderRadius: Radii.brMd,
            border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
          ),
          child: TextField(
            controller: controller,
            keyboardType: keyboardType,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.3)),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 14,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    required this.icon,
    required this.onTap,
    this.isActive = false,
  });
  final IconData icon;
  final VoidCallback onTap;
  final bool isActive;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: isActive
              ? Colors.white.withValues(alpha: 0.2)
              : Colors.white.withValues(alpha: 0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(
          icon,
          color: isActive
              ? const Color(0xFFFFBD2E)
              : Colors.white.withValues(alpha: 0.6),
          size: 22,
        ),
      ),
    );
  }
}
