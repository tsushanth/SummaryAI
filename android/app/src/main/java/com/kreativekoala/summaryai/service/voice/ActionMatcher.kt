package com.kreativekoala.summaryai.service.voice

/** Picks the action the user means from a few spoken words. Never guesses between two: it asks. */
object ActionMatcher {

    sealed interface Match {
        data object None : Match
        data class One(val action: VoiceAction) : Match
        /** More than one plausible item (at most [MAX_CHOICES]); the assistant asks which. */
        data class Many(val actions: List<VoiceAction>) : Match
    }

    const val MAX_CHOICES = 3

    private val STOPWORDS = setOf("the", "a", "an", "to", "for", "of", "my", "that", "this", "item", "task", "action", "one", "it", "and", "with", "on", "in")

    /** Only items that can be completed here (todos) and are not done yet are candidates. */
    fun match(query: String, actions: List<VoiceAction>): Match {
        val q = tokens(query)
        if (q.isEmpty()) return Match.None
        val open = actions.filter { it.isTodo && !it.isCompleted }

        val exact = open.filter { tokens(it.title) == q }
        if (exact.size == 1) return Match.One(exact.single())

        val hits = open.filter { a ->
            val t = tokens(a.title)
            // Every spoken word must start some word of the title ("budg" is not enough; "budget" is).
            q.all { w -> t.any { it == w || (w.length >= 4 && it.startsWith(w)) || (it.length >= 4 && w.startsWith(it)) } }
        }
        return when {
            hits.isEmpty() -> Match.None
            hits.size == 1 -> Match.One(hits.single())
            else -> Match.Many(hits.take(MAX_CHOICES))
        }
    }

    internal fun tokens(s: String): List<String> =
        s.lowercase().replace(Regex("[^\\p{L}\\p{N}\\s]"), " ").split(Regex("\\s+")).filter { it.isNotBlank() && it !in STOPWORDS }
}
