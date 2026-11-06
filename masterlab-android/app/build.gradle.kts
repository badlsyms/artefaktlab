plugins { id("com.android.application") }
android {
  namespace = "cz.artefaktlab.masterlab"
  compileSdk = 35
  defaultConfig {
    applicationId = "cz.artefaktlab.masterlab"
    minSdk = 26
    targetSdk = 35
    versionCode = 230
    versionName = "2.3.0"
  }
  buildTypes { getByName("release") { isMinifyEnabled = false } }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}
