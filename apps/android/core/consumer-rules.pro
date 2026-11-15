# Applied to every app that depends on :core, when it minifies with R8.

# JNA, as its FAQ ("JNA on Android") prescribes: it binds native methods and structure fields by
# reflection, and its AAR ships no rules of its own.
-dontwarn java.awt.*
-keep class com.sun.jna.* { *; }
-keep class * extends com.sun.jna.* { *; }
-keepclassmembers class * extends com.sun.jna.* { public *; }

# The UniFFI bindings: JNA registers their native functions by name and reads the field order of
# their structures from annotations at run time.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keep class uniffi.broski_contract.** { *; }
-keep class uniffi.broski_core.** { *; }
