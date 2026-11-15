// The terminal engine: libghostty-vt behind a small JNI shim, as libbroski_terminal.so per ABI. Run
// scripts/build-android-terminal.sh first; it writes src/main/jniLibs and src/test/native.

plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.muzammil.broski.terminal"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    ndkVersion = libs.versions.android.ndk.get()

    defaultConfig {
        minSdk = libs.versions.android.minSdk.get().toInt()
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    testImplementation(libs.junit)
}

tasks.withType<Test>().configureEach {
    // The host build of libbroski_terminal, which System.loadLibrary finds in place of the Android one.
    systemProperty("java.library.path", file("src/test/native").path)
    inputs.dir("src/test/native")
    testLogging {
        events("passed", "skipped", "failed")
    }
}
