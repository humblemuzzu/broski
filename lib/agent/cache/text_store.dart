import 'package:broski/services/storage/broski_secure_storage.dart'
    show broskiSecureStorage;

/// Where the offline cache keeps its entries: text under a key.
abstract interface class TextStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

/// The app's secure storage, the same store the old screens cache in.
final class SecureTextStore implements TextStore {
  const SecureTextStore();

  @override
  Future<String?> read(String key) => broskiSecureStorage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      broskiSecureStorage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => broskiSecureStorage.delete(key: key);
}
