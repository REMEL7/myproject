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
    defaultConfig {
        applicationId = "com.gmg.tablet.experience"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-experience"
        val endpoint=providers.gradleProperty("tabletServerUrl").orNull ?: ""
        require(endpoint.isEmpty() || runCatching{URI(endpoint).let{it.scheme in setOf("http","https")&&!it.host.isNullOrBlank()&&it.userInfo==null&&it.query==null&&it.fragment==null&&it.path.isNullOrEmpty()}}.getOrDefault(false))
        buildConfigField("String","DEFAULT_SERVER_URL","\"$endpoint\"")
        buildConfigField("boolean","TABLET_MODE","true")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("com.google.zxing:core:3.5.3")
}
