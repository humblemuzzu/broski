## Flutter
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.**  { *; }
-keep class io.flutter.util.**  { *; }
-keep class io.flutter.view.**  { *; }
-keep class io.flutter.**  { *; }
-keep class io.flutter.plugins.**  { *; }

## Prevent R8 from removing metadata for JSON/serialization
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
