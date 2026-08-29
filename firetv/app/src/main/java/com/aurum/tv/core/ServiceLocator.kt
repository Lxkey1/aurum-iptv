package com.aurum.tv.core

import android.content.Context
import com.aurum.tv.data.Prefs
import com.aurum.tv.data.Repository
import com.aurum.tv.data.SecureStore
import com.aurum.tv.data.XtreamClient
import com.aurum.tv.data.epg.EpgStore
import java.io.File

/**
 * Manual dependency wiring. The graph is small enough that a DI framework would
 * cost more in build time and APK size than it saves.
 */
object ServiceLocator {

    lateinit var repository: Repository
        private set

    lateinit var prefs: Prefs
        private set

    fun init(context: Context) {
        if (::repository.isInitialized) return

        val app = context.applicationContext
        prefs = Prefs(app)

        val secure = SecureStore(app)
        val cacheDir = File(app.cacheDir, "catalogue").apply { mkdirs() }
        val epgDir = File(app.filesDir, "epg").apply { mkdirs() }

        val client = XtreamClient(
            host = "",
            username = "",
            password = "",
            userAgent = prefs.settings.userAgent
        )

        repository = Repository(
            client = client,
            prefs = prefs,
            secure = secure,
            epg = EpgStore(epgDir),
            cacheDir = cacheDir
        )
    }
}
