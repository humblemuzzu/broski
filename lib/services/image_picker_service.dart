import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';

import '../models/file_attachment.dart';

final imagePickerServiceProvider = Provider((ref) => ImagePickerService());

class ImagePickerService {
  final ImagePicker _picker = ImagePicker();

  Future<FileAttachment?> pickFromGallery() async {
    final XFile? image = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 85,
    );
    return _processImage(image);
  }

  Future<FileAttachment?> pickFromCamera() async {
    final XFile? image = await _picker.pickImage(
      source: ImageSource.camera,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 85,
    );
    return _processImage(image);
  }

  Future<List<FileAttachment>> pickMultipleImages() async {
    final List<XFile> images = await _picker.pickMultiImage(
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 85,
    );
    final attachments = <FileAttachment>[];
    for (final image in images) {
      final attachment = await _processImage(image);
      if (attachment != null) {
        attachments.add(attachment);
      }
    }
    return attachments;
  }

  Future<FileAttachment?> _processImage(XFile? image) async {
    if (image == null) return null;

    final bytes = await image.readAsBytes();
    final base64Data = base64Encode(bytes);

    final mimeType = lookupMimeType(image.path) ?? 'image/jpeg';
    final filename = image.name;

    final thumbnail = await _generateThumbnail(bytes);

    return FileAttachment.fromImage(
      filename: filename,
      mimeType: mimeType,
      base64Data: base64Data,
      thumbnailBytes: thumbnail,
    );
  }

  Future<Uint8List?> _generateThumbnail(Uint8List bytes) async {
    if (bytes.length < 100 * 1024) {
      return bytes;
    }
    return bytes;
  }
}
