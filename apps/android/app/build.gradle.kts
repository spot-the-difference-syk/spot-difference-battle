plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val packageWeb by tasks.registering(Exec::class) {
    group = "build"
    description = "Build and copy the existing React/Vite game into Android assets"
    workingDir = rootProject.file("../..")
    commandLine("pnpm", "package:android:web")
}

tasks.named("preBuild") {
    dependsOn(packageWeb)
}

android {
    namespace = "com.ninebarcode.spotdifference"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ninebarcode.spotdifference"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.13.0")
}
