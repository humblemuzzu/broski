# The JNI shim binds Native's methods by name and calls Frame.cluster(int, int[]) back.
-keepclasseswithmembernames class com.muzammil.broski.terminal.Native { native <methods>; }
-keep class com.muzammil.broski.terminal.Frame { void cluster(int, int[]); }
