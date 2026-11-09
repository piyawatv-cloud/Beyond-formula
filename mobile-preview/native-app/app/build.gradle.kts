import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "th.co.beyondlab.formulastudio"
    compileSdk = 35

    defaultConfig {
        // Live-mode server is NOT in source control: set `formula.liveBase=https://...` in the git-ignored
        // local.properties (or -Pformula.liveBase=...). Empty = live mode disabled.
        val liveBase = (rootProject.file("local.properties").takeIf { it.exists() }
            ?.let { f -> Properties().apply { f.inputStream().use { load(it) } }.getProperty("formula.liveBase") }
            ?: (project.findProperty("formula.liveBase") as String?) ?: "").trim()
        buildConfigField("String", "LIVE_BASE", "\"$liveBase\"")
        applicationId = "th.co.beyondlab.formulastudio.dev"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-sim"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }

    // Release signing material is NEVER in the repo: put it in the git-ignored keystore.properties
    // (storeFile, storePassword, keyAlias, keyPassword). Without it the release APK is built unsigned.
    val ksFile = rootProject.file("keystore.properties")
    val ksProps = Properties().apply { if (ksFile.exists()) ksFile.inputStream().use { load(it) } }
    if (ksProps.getProperty("storeFile") != null) {
        signingConfigs.create("release") {
            storeFile = rootProject.file(ksProps.getProperty("storeFile"))
            storePassword = ksProps.getProperty("storePassword")
            keyAlias = ksProps.getProperty("keyAlias")
            keyPassword = ksProps.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // android.jar org.json is stubbed in unit tests
}
