// The Broski Android app. It needs :core's generated bindings and libraries: run
// scripts/build-android-core.sh first.

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.muzammil.broski"
    compileSdk = libs.versions.android.appCompileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.muzammil.broski"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // The Firebase project push needs, from the gradle properties broski.firebase.* (apps/android/README.md,
        // "Push"); empty without them, and the app then runs without push.
        listOf("APP_ID" to "appId", "API_KEY" to "apiKey", "PROJECT_ID" to "projectId", "SENDER_ID" to "senderId").forEach { (field, property) ->
            buildConfigField("String", "FIREBASE_$field", "\"${providers.gradleProperty("broski.firebase.$property").getOrElse("")}\"")
        }
    }

    val releaseStoreFile = providers.gradleProperty("broski.signing.storeFile")
        .orElse(providers.environmentVariable("BROSKI_ANDROID_KEYSTORE"))
        .orNull
    val releaseStorePassword = providers.gradleProperty("broski.signing.storePassword")
        .orElse(providers.environmentVariable("BROSKI_ANDROID_KEYSTORE_PASSWORD"))
        .orNull
    val releaseKeyAlias = providers.gradleProperty("broski.signing.keyAlias")
        .orElse(providers.environmentVariable("BROSKI_ANDROID_KEY_ALIAS"))
        .orNull
    val releaseKeyPassword = providers.gradleProperty("broski.signing.keyPassword")
        .orElse(providers.environmentVariable("BROSKI_ANDROID_KEY_PASSWORD"))
        .orNull
    val hasReleaseSigning = !releaseStoreFile.isNullOrBlank() &&
        !releaseStorePassword.isNullOrBlank() &&
        !releaseKeyAlias.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()

    if (hasReleaseSigning) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        }
        release {
            ndk { abiFilters += listOf("arm64-v8a") }
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The facade's push fixtures, read by the notification tests on the device.
    sourceSets.named("androidTest") {
        assets.directories += rootDir.resolve("../../packages/link/mobile/tests/fixtures").path
    }

    testOptions {
        unitTests.all { test ->
            // The host build of libbroski_core and the facade's fixtures, as :core's JVM tests use them.
            test.systemProperty("jna.library.path", rootDir.resolve("core/src/test/native").path)
            test.systemProperty("broski.fixtures", rootDir.resolve("../../packages/link/mobile/tests/fixtures").path)
            test.testLogging { events("passed", "skipped", "failed") }
        }
    }
}

composeCompiler {
    stabilityConfigurationFiles.add(layout.projectDirectory.file("compose_compiler_config.conf"))
}

dependencies {
    implementation(project(":core"))
    implementation(project(":terminal"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.navigation.suite)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.work.runtime)
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.play.services.code.scanner)

    // The jar, not the aar: it carries libjnidispatch for the JVM the unit tests run on.
    testImplementation(libs.jna)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.work.testing)
    androidTestImplementation(libs.mockwebserver)
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
