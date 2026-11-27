package com.kreativekoala.summaryai.util

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.kreativekoala.summaryai.BuildConfig

/**
 * Installs that are not a person to count: our own debug builds, Firebase Test Lab (Play pre-launch reports),
 * emulators, and copies put on a device over adb. The Play track (internal testing or production) cannot be read
 * on the device; the server holds that rule (backend migration 039). No permission is needed for any of this.
 */
object TestInstall {

    /** What is known about this install. [installer] means something only when [installerKnown]. */
    data class Facts(
        val debugBuild: Boolean,
        val testLab: Boolean,
        val hardware: String,
        val installerKnown: Boolean,
        val installer: String?,
    )

    private val EMULATOR_HARDWARE = setOf("ranchu", "goldfish")

    /** adb records no installer, or the shell. Any other installer (a store, a file manager) is left as a person. */
    private const val ADB_SHELL = "com.android.shell"

    fun isTest(facts: Facts): Boolean =
        facts.debugBuild ||
            facts.testLab ||
            facts.hardware in EMULATOR_HARDWARE ||
            (facts.installerKnown && (facts.installer == null || facts.installer == ADB_SHELL))

    fun isTest(context: Context): Boolean {
        // Asking for our own package's installer; a failure leaves it unknown, which counts as a person.
        val installer = runCatching { installerOf(context) }
        return isTest(
            Facts(
                debugBuild = BuildConfig.DEBUG,
                testLab = runCatching { Settings.System.getString(context.contentResolver, "firebase.test.lab") == "true" }
                    .getOrDefault(false),
                hardware = Build.HARDWARE.orEmpty(),
                installerKnown = installer.isSuccess,
                installer = installer.getOrNull(),
            )
        )
    }

    private fun installerOf(context: Context): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getInstallerPackageName(context.packageName)
        }
}
