// BroskiCore for Android: the Kotlin bindings of the Rust core and its libbroski_core.so per ABI.
// Run scripts/build-android-core.sh first; it writes src/main/jniLibs, src/generated/kotlin and
// src/test/native.

plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.muzammil.broski.core"
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

    sourceSets.named("main") {
        kotlin.directories += "src/generated/kotlin"
    }
}

dependencies {
    api(variantOf(libs.jna) { artifactType("aar") })
    implementation(libs.androidx.annotation)
    implementation(libs.kotlinx.coroutines.core)

    // The jar, not the aar: it carries libjnidispatch for the JVM the unit tests run on.
    testImplementation(libs.jna)
    testImplementation(libs.junit)
}

tasks.withType<Test>().configureEach {
    // The host build of libbroski_core, which JNA loads in place of the Android one.
    systemProperty("jna.library.path", file("src/test/native").path)
    systemProperty("broski.fixtures", rootDir.resolve("../../packages/link/mobile/tests/fixtures").path)
    testLogging {
        events("passed", "skipped", "failed")
    }
}
