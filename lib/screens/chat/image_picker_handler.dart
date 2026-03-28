import 'package:broski/models/file_attachment.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/services/image_picker_service.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Check if a model supports image inputs.
bool modelSupportsImages(SelectedModel? model) {
  if (model == null) return true;
  final id = model.modelID.toLowerCase();
  final provider = model.providerID.toLowerCase();
  if (provider.contains('anthropic')) {
    return id.contains('claude-3') ||
        id.contains('claude-4') ||
        id.contains('sonnet') ||
        id.contains('opus') ||
        id.contains('haiku');
  }
  if (provider.contains('openai')) {
    return id.contains('gpt-4o') ||
        id.contains('gpt-4-vision') ||
        id.contains('gpt-4-turbo') ||
        id.contains('o1') ||
        id.contains('o3');
  }
  if (provider.contains('google')) {
    return id.contains('gemini');
  }
  return true;
}

/// Shows a warning snackbar that the model may not support images.
void showImageNotSupportedWarning(BuildContext context, WidgetRef ref) {
  final model = ref.read(selectionProvider).model;
  if (!context.mounted) return;
  showInfo(
    context,
    'Warning: ${model?.modelID ?? 'This model'} may not support images',
  );
}

/// Pick an image from the gallery and add to attachments.
/// Extracted from `_ChatScreenState._pickImageFromGallery`.
Future<FileAttachment?> pickImageFromGallery(WidgetRef ref) async {
  final imagePicker = ref.read(imagePickerServiceProvider);
  return await imagePicker.pickFromGallery();
}

/// Pick an image from the camera and add to attachments.
/// Extracted from `_ChatScreenState._pickImageFromCamera`.
Future<FileAttachment?> pickImageFromCamera(WidgetRef ref) async {
  final imagePicker = ref.read(imagePickerServiceProvider);
  return await imagePicker.pickFromCamera();
}
