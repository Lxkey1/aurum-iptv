package com.aurum.tv

import android.app.Application
import com.aurum.tv.core.ServiceLocator

class AurumApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }
}
