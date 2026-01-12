plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.kreativekoala.summaryai"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kreativekoala.summaryai"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "1.0.3"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        // Build config fields
        buildConfigField("String", "SUPABASE_URL", "\"https://mlofjzlmncgnhxbiuemf.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sb2ZqemxtbmNnbmh4Yml1ZW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyOTU1NjAsImV4cCI6MjA4Mjg3MTU2MH0.fUxgMcu1BNrsYneN5vSMFWxsv-rWIygCx-xn-Vmr0Ec\"")
        buildConfigField("String", "API_BASE_URL", "\"https://summary-ai-backend-917362189743.us-central1.run.app\"")
        // Google OAuth Web Client ID (from Google Cloud Console)
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"753424767416-54viqmpd45g10oohm7vug13o8tdhb8qp.apps.googleusercontent.com\"")
    }

    buildTypes {
        debug {
            isDebuggable = true
            // Use production backend for debug builds (comment out and use local for dev)
            // buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8080\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // Disable lint checks that have issues with Twilio SDK
        disable += listOf("MissingClass", "Instantiatable")
        // Don't abort on warnings
        warningsAsErrors = false
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        // Enable 16 KB page size support for newer devices (required by Play Store)
        jniLibs {
            useLegacyPackaging = false
        }
    }

    // Experimental flags for 16 KB page alignment
    @Suppress("UnstableApiUsage")
    experimentalProperties["android.experimental.enableNative16KAlignment"] = true
}

dependencies {
    // Core Android
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.ui.tooling)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // DataStore
    implementation(libs.datastore.preferences)

    // Security
    implementation(libs.security.crypto)

    // Media3 / ExoPlayer
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)
    implementation(libs.media3.session)

    // Google Sign-In
    implementation(libs.play.services.auth)

    // Play Billing
    implementation(libs.billing.ktx)

    // Supabase
    implementation(libs.supabase.gotrue)
    implementation(libs.supabase.postgrest)
    implementation(libs.ktor.client.android)

    // Image Loading
    implementation(libs.coil.compose)

    // Accompanist
    implementation(libs.accompanist.permissions)
    implementation(libs.accompanist.systemuicontroller)

    // Twilio Voice SDK (VoIP calling)
    implementation(libs.twilio.voice)
}
