package com.kreativekoala.summaryai.data.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Credentials must never leave the device. Guards both backup configs (Android 11- fullBackupContent and
 * Android 12+ dataExtractionRules) and the manifest wiring, so a later edit cannot quietly re-include them.
 */
class BackupRulesTest {
    private val credentialFiles = listOf(
        "${SecurePrefs.FILE_NAME}.xml", // encrypted store: token mirror + Supabase session
        "com.kreativekoala.meetingmind_preferences.xml", // default prefs: supabase-kt's old clear-text session
    )

    // Gradle runs unit tests with the module directory (app/) as the working directory.
    private fun res(name: String): File = listOf("src/main/$name", "app/src/main/$name").map(::File).first { it.exists() }

    private fun parse(f: File): Element =
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement

    private fun excludedSharedPrefs(section: Element): Set<String> {
        val nodes = section.getElementsByTagName("exclude")
        return (0 until nodes.length).map { nodes.item(it) as Element }
            .filter { it.getAttribute("domain") == "sharedpref" }
            .map { it.getAttribute("path") }.toSet()
    }

    private fun section(root: Element, tag: String): Element {
        val n = root.getElementsByTagName(tag)
        assertEquals("<$tag> must exist exactly once", 1, n.length)
        return n.item(0) as Element
    }

    @Test fun fullBackupContentExcludesCredentials() {
        val root = parse(res("res/xml/backup_rules.xml"))
        assertEquals("full-backup-content", root.tagName)
        assertTrue(excludedSharedPrefs(root).containsAll(credentialFiles))
    }

    @Test fun dataExtractionRulesExcludeCredentialsFromCloudBackupAndDeviceTransfer() {
        val root = parse(res("res/xml/data_extraction_rules.xml"))
        assertEquals("data-extraction-rules", root.tagName)
        assertTrue(excludedSharedPrefs(section(root, "cloud-backup")).containsAll(credentialFiles))
        assertTrue(excludedSharedPrefs(section(root, "device-transfer")).containsAll(credentialFiles))
    }

    @Test fun manifestPointsAtBothRuleFiles() {
        val manifest = res("AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:fullBackupContent=\"@xml/backup_rules\""))
        assertTrue(manifest.contains("android:dataExtractionRules=\"@xml/data_extraction_rules\""))
        assertNotNull(res("res/xml/backup_rules.xml"))
    }
}
