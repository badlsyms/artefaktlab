plugins { id("com.android.application") }
dependencies { implementation("androidx.webkit:webkit:1.12.1") }
android {
  namespace = "cz.artefaktlab.masterlab"
  compileSdk = 35
  defaultConfig {
    applicationId = "cz.artefaktlab.masterlab"
    minSdk = 26
    targetSdk = 35
    versionCode = 250
    versionName = "2.5.0"
  }
  buildTypes { getByName("release") { isMinifyEnabled = false } }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}
