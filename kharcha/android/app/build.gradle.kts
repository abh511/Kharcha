plugins {
    id("com.android.application")
}

android {
    namespace = "app.kharcha"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.kharcha"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"${providers.gradleProperty("kharchaServer").getOrElse("")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Shared directly as an APK for now. Use your own release key before publishing on Google Play.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.work:work-runtime:2.12.0")
    testImplementation("junit:junit:4.13.2")
}
