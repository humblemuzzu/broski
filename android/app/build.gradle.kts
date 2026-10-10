plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.muzammil.broski"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "com.muzammil.broski"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            // ⚠️  BEFORE PUBLISHING TO GOOGLE PLAY:
            // 1. Generate a keystore:
            //    keytool -genkey -v -keystore ~/broski-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias broski
            // 2. Create android/key.properties with:
            //    storePassword=<password>
            //    keyPassword=<password>
            //    keyAlias=broski
            //    storeFile=/path/to/broski-release.jks
            // 3. Uncomment the lines below and remove the debug fallback.
            //
            // val keystoreProperties = java.util.Properties()
            // keystoreProperties.load(java.io.FileInputStream(rootProject.file("key.properties")))
            // keyAlias = keystoreProperties["keyAlias"] as String
            // keyPassword = keystoreProperties["keyPassword"] as String
            // storeFile = file(keystoreProperties["storeFile"] as String)
            // storePassword = keystoreProperties["storePassword"] as String
        }
    }

    buildTypes {
        release {
            // TODO: Switch to signingConfigs.getByName("release") before Play Store submission.
            // Google Play REJECTS debug-signed builds.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
