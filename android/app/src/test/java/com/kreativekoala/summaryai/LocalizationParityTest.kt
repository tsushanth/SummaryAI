package com.kreativekoala.summaryai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * Keeps the translated resources honest: every language folder must have the same keys, format placeholders and
 * plural forms as the default (English) resources, and the Android 13+ per-app language picker
 * (xml/locales_config.xml) must list exactly the languages the app ships.
 *
 * Reads the XML straight from src/main/res (Gradle runs unit tests with the module directory as the working directory).
 */
class LocalizationParityTest {
    private val res = File("src/main/res")

    /**
     * Languages whose translations of the newest strings are still being written. They are exempt only from
     * [everyDefaultStringIsTranslated]; every other test applies to them. Remove an entry when its language is complete.
     */
    private val pendingTranslation: Set<String> = emptySet()

    private class Entry(val plural: Boolean, val items: Map<String, String>)

    private fun parse(dir: File): Map<String, Entry> {
        val out = HashMap<String, Entry>()
        val files = dir.listFiles { f -> f.extension == "xml" } ?: return out
        val builder = DocumentBuilderFactory.newInstance().newDocumentBuilder()
        for (f in files.sortedBy { it.name }) {
            val root = builder.parse(f).documentElement
            val nodes = root.childNodes
            for (i in 0 until nodes.length) {
                val el = nodes.item(i) as? Element ?: continue
                val name = el.getAttribute("name")
                if (el.getAttribute("translatable") == "false") continue
                when (el.tagName) {
                    "string" -> out[name] = Entry(false, mapOf("" to el.textContent))
                    "plurals" -> {
                        val items = HashMap<String, String>()
                        val kids = el.getElementsByTagName("item")
                        for (j in 0 until kids.length) {
                            val item = kids.item(j) as Element
                            items[item.getAttribute("quantity")] = item.textContent
                        }
                        out[name] = Entry(true, items)
                    }
                }
            }
        }
        return out
    }

    private fun localeDirs(): List<File> =
        (res.listFiles { f -> f.isDirectory && f.name.matches(Regex("values-([a-z]{2,3}(-r[A-Z]{2})?|b\\+[a-z]{2,3}\\+[A-Z][a-z]{3})")) } ?: emptyArray())
            .sortedBy { it.name }

    private fun tag(dirName: String): String {
        val q = dirName.removePrefix("values-")
        // "b+zh+Hant" is the BCP-47 qualifier form: tag zh-Hant
        val t = if (q.startsWith("b+")) q.removePrefix("b+").replace('+', '-') else q.replace("-r", "-")
        return if (t == "in") "id" else t
    }

    private val specifier = Regex("%(?:(\\d+)\\$)?[-#+ 0,(]*\\d*(?:\\.\\d+)?([a-zA-Z%])")

    /** Placeholders as (position, conversion) pairs; %% is not a placeholder. */
    private fun placeholders(s: String): List<String> {
        var n = 0
        return specifier.findAll(s.replace("%%", ""))
            .map { m ->
                n++
                val pos = m.groupValues[1].ifEmpty { n.toString() }
                val conv = if (m.groupValues[2] == "i") "d" else m.groupValues[2]
                "$pos$conv"
            }
            .sorted()
            .toList()
    }

    private val pluralForms = mapOf(
        "ar" to setOf("zero", "one", "two", "few", "many", "other"),
        "ru" to setOf("one", "few", "many", "other"),
        "pl" to setOf("one", "few", "many", "other"),
        "uk" to setOf("one", "few", "many", "other"),
        "ro" to setOf("one", "few", "other"),
        "fr" to setOf("one", "many", "other"),
        "es" to setOf("one", "many", "other"),
        "it" to setOf("one", "many", "other"),
        "pt-BR" to setOf("one", "many", "other"), "pt" to setOf("one", "many", "other"), "cs" to setOf("one", "few", "many", "other"),
        "ja" to setOf("other"), "ko" to setOf("other"), "zh-CN" to setOf("other"),
        "zh-TW" to setOf("other"), "zh-HK" to setOf("other"), "zh-Hant" to setOf("other"),
        "th" to setOf("other"), "vi" to setOf("other"), "id" to setOf("other"), "ms" to setOf("other")
    )

    @Test fun localesConfigListsExactlyTheShippedLanguages() {
        // zh-Hant (values-b+zh+Hant) is only the script fallback for Macau and other Traditional regions, so it is not a picker entry.
        val shipped = localeDirs().map { tag(it.name) }.filter { it != "zh-Hant" }.toMutableSet().apply { add("en") }
        val text = File(res, "xml/locales_config.xml").readText()
        val listed = Regex("android:name=\"([^\"]+)\"").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals("languages in values-* but not in locales_config.xml", emptySet<String>(), shipped - listed)
        assertEquals("languages in locales_config.xml without a values-* folder", emptySet<String>(), listed - shipped)
    }

    @Test fun noLanguageDefinesAKeyTheDefaultLacks() {
        val default = parse(File(res, "values"))
        val problems = ArrayList<String>()
        for (dir in localeDirs()) for (key in parse(dir).keys) if (key !in default) problems += "${dir.name}: $key"
        assertTrue("keys that do not exist in values/: $problems", problems.isEmpty())
    }

    @Test fun formatPlaceholdersMatchTheDefault() {
        val default = parse(File(res, "values"))
        val problems = ArrayList<String>()
        for (dir in localeDirs()) {
            for ((key, entry) in parse(dir)) {
                val d = default[key] ?: continue
                for ((q, text) in entry.items) {
                    val reference = d.items[q] ?: d.items["other"] ?: d.items[""] ?: continue
                    if (placeholders(text) != placeholders(reference) && placeholders(text).isNotEmpty())
                        problems += "${dir.name}: $key[$q] ${placeholders(text)} != ${placeholders(reference)}"
                }
            }
        }
        assertTrue("placeholder mismatches: $problems", problems.isEmpty())
    }

    @Test fun pluralsHaveTheFormsEachLanguageNeeds() {
        val problems = ArrayList<String>()
        for (dir in localeDirs()) {
            val tag = tag(dir.name)
            val need = pluralForms[tag] ?: setOf("one", "other")
            for ((key, entry) in parse(dir)) {
                if (entry.plural && !entry.items.keys.containsAll(need)) problems += "${dir.name}: $key lacks ${need - entry.items.keys}"
            }
        }
        assertTrue("plural forms missing: $problems", problems.isEmpty())
    }

    @Test fun everyDefaultStringIsTranslated() {
        val default = parse(File(res, "values"))
        val problems = ArrayList<String>()
        for (dir in localeDirs()) {
            if (tag(dir.name) in pendingTranslation) continue
            val have = parse(dir).keys
            val missing = default.keys.filter { it !in have }
            if (missing.isNotEmpty()) problems += "${dir.name}: ${missing.size} missing, first: ${missing.take(5)}"
        }
        assertTrue("untranslated strings (add the language to pendingTranslation only while it is being written): $problems", problems.isEmpty())
    }

    @Test fun traditionalChineseIsShippedForTaiwanHongKongAndTheHantFallback() {
        val tags = localeDirs().map { tag(it.name) }
        for (t in listOf("zh-CN", "zh-TW", "zh-HK", "zh-Hant")) assertTrue("$t folder missing", t in tags)
    }
}
