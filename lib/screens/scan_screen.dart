import 'dart:io';

import 'package:broski/providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;
import 'package:broski/screens/scan/link_pairing_dialog.dart';
import 'package:broski/screens/scan/paste_pairing_link.dart';
import 'package:broski/screens/scan/scan_overlay.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
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
    }
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
    final onboarding = ref.read(onboardingProvider);
    if (!onboarding.hasCompletedOnboarding) {
      _handledScan = false;
      ref.read(onboardingProvider.notifier).goBack();
    } else {
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
