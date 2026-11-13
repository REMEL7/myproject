import java.net.URI
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.pleosstarter"
    compileSdk = 36
    useLibrary("android.car")
    buildFeatures { buildConfig = true }
    val productionUrl=providers.environmentVariable("MOAGIL_SERVER_URL").orNull ?: ""
    defaultConfig {
        buildConfigField("String","DEFAULT_SERVER_URL","\"${productionUrl.replace("\\","\\\\").replace("\"","\\\"")}\"")
        buildConfigField("boolean","SUBMISSION_BUILD","false")
    }
    flavorDimensions += "distribution"
    productFlavors {
        create("production") { dimension="distribution"; isDefault=true }
        create("submission") {
            dimension="distribution"
            applicationIdSuffix=".submission"
            versionNameSuffix="-submission"
            buildConfigField("boolean","SUBMISSION_BUILD","true")
            buildConfigField("String","DEFAULT_SERVER_URL","\"http://10.0.2.2:8787\"")
        }
    }
    signingConfigs {
        create("production") {
            providers.environmentVariable("MOAGIL_KEYSTORE").orNull?.let { storeFile=file(it) }
            storePassword=providers.environmentVariable("MOAGIL_STORE_PASSWORD").orNull
            keyAlias=providers.environmentVariable("MOAGIL_KEY_ALIAS").orNull
            keyPassword=providers.environmentVariable("MOAGIL_KEY_PASSWORD").orNull
        }
    }
    buildTypes {
        getByName("release") { signingConfig=signingConfigs.getByName("production") }
        getByName("debug") { buildConfigField("String","DEFAULT_SERVER_URL","\"http://10.0.2.2:8787\"") }
    }
    defaultConfig {
        applicationId = "com.example.pleosstarter"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Version from the official Importing Vehicle SDK page.
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("com.google.zxing:core:3.5.3")
}

// Both release variants require private signing. Only the isolated emulator submission
// variant permits the PC relay; production continues to require an HTTPS origin.
tasks.matching { it.name=="preProductionReleaseBuild" || it.name=="preSubmissionReleaseBuild" }.configureEach {
    doFirst {
        if(name=="preProductionReleaseBuild") {
            val endpoint=System.getenv("MOAGIL_SERVER_URL") ?: ""
            require(runCatching { URI(endpoint).let { it.scheme=="https" && !it.host.isNullOrBlank() && it.userInfo==null && it.query==null && it.fragment==null && it.path.isNullOrEmpty() } }.getOrDefault(false)) { "Production release requires MOAGIL_SERVER_URL as an HTTPS origin." }
        }
        listOf("MOAGIL_KEYSTORE","MOAGIL_STORE_PASSWORD","MOAGIL_KEY_ALIAS","MOAGIL_KEY_PASSWORD").forEach { require(!System.getenv(it).isNullOrBlank()) { "Release signing environment is incomplete: $it" } }
    }
}
