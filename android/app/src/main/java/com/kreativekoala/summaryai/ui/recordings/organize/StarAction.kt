package com.kreativekoala.summaryai.ui.recordings.organize

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class StarViewModel @Inject constructor(
    private val recordings: RecordingsRepository,
) : ViewModel() {
    /** Calls the API; [onResult] gets the confirmed value, or null on failure. */
    fun set(recordingId: String, favorite: Boolean, onResult: (Boolean?) -> Unit) {
        viewModelScope.launch {
            onResult(recordings.toggleFavorite(recordingId, favorite).getOrNull()?.isFavorite)
        }
    }
}

/**
 * Star / unstar button for a top app bar. Self-contained: needs only the recording id and its
 * current value. Flips optimistically and reverts on failure.
 */
@Composable
fun StarAction(
    recordingId: String,
    isFavorite: Boolean,
    enabled: Boolean = true,
    viewModel: StarViewModel = hiltViewModel(),
) {
    // Local override until the parent's value catches up (the parent does not observe this change).
    var override by remember(recordingId, isFavorite) { mutableStateOf<Boolean?>(null) }
    val starred = override ?: isFavorite
    IconButton(
        enabled = enabled,
        onClick = {
            val target = !starred
            override = target
            viewModel.set(recordingId, target) { confirmed -> override = confirmed ?: !target }
        },
    ) {
        Icon(
            imageVector = if (starred) Icons.Default.Star else Icons.Default.StarBorder,
            contentDescription = stringResource(if (starred) R.string.remove_from_favorites else R.string.add_to_favorites),
            tint = if (starred) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
