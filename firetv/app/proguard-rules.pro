# ---------------------------------------------------------------- Aurum TV
# R8 rules for the release build. Most libraries ship their own consumer rules;
# these cover the reflection-driven bits that R8 cannot see.

# ------------------------------------------------------- kotlinx.serialization
# The compiler plugin generates a $$serializer for every @Serializable class and
# looks it up reflectively, so both the class and its serializer must survive.
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisible*Annotations

-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-dontnote kotlinx.serialization.**
-dontwarn kotlinx.serialization.**

# Our own serialised preference models.
-keep class com.aurum.tv.data.Settings { *; }
-keep class com.aurum.tv.data.Progress { *; }
-keep,includedescriptorclasses class com.aurum.tv.data.**$$serializer { *; }

# ----------------------------------------------------------------- Media3
# Renderers and extractors are instantiated by name.
-keep class androidx.media3.exoplayer.** { *; }
-keep class androidx.media3.extractor.** { *; }
-keep class androidx.media3.decoder.** { *; }
-dontwarn androidx.media3.**

# ----------------------------------------------------------------- OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ------------------------------------------------------------------- Coil
-dontwarn coil.**

# -------------------------------------------------------------- XmlPullParser
-keep class org.xmlpull.v1.** { *; }
-dontwarn org.xmlpull.v1.**

# --------------------------------------------------------------- Kotlin misc
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings { <fields>; }

# Keep the entry points named in the manifest.
-keep class com.aurum.tv.AurumApp
-keep class com.aurum.tv.MainActivity
