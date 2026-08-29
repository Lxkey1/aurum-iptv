package com.aurum.tv.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aurum.tv.core.ServiceLocator
import com.aurum.tv.data.*
import com.aurum.tv.data.epg.EpgStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Which top-level screen is showing. Kept as a simple stack — no nav library. */
sealed interface Screen {
    data object Boot : Screen
    data object Login : Screen
    data object Home : Screen
    data object Live : Screen
    data object Guide : Screen
    data object Movies : Screen
    data object SeriesList : Screen
    data object Favourites : Screen
    data object Search : Screen
    data object Settings : Screen
    data class MovieDetail(val movie: Movie) : Screen
    data class SeriesDetail(val series: Series) : Screen
}

/** What the player is currently asked to show. */
data class PlaybackRequest(
    val type: String,                       // live | movie | episode
    val title: String,
    val subtitle: String,
    val url: String,
    val isLive: Boolean,
    val streamId: String,
    val seriesId: String? = null,
    val cover: String? = null,
    val resumeFrom: Long = 0,
    val progressKey: String? = null,
    val extension: String = "ts",
    val season: Int = 0,
    val episode: Int = 0,
    /** Live only: the list to zap through with up/down. */
    val playlist: List<Channel> = emptyList(),
    val playlistIndex: Int = -1,
    /** VOD only: what to roll on to when this finishes. */
    val upNext: (() -> PlaybackRequest?)? = null
)

data class UiState(
    val screen: Screen = Screen.Boot,
    val account: Account? = null,
    val loading: Boolean = false,
    val loadingText: String = "",
    val error: String? = null,
    val toast: String? = null,
    val catalogueReady: Boolean = false,
    val epgReady: Boolean = false,
    val epgLoading: Boolean = false,
    val epgProgress: Int = 0,
    val epgProgressText: String = "",
    val epgStats: EpgStore.Stats? = null,
    val epgMatched: Int = 0,
    val searchQuery: String = "",
    val revision: Int = 0
)

class AppState : ViewModel() {

    val repo: Repository get() = ServiceLocator.repository
    val prefs: Prefs get() = ServiceLocator.prefs

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private val _playback = MutableStateFlow<PlaybackRequest?>(null)
    val playback: StateFlow<PlaybackRequest?> = _playback.asStateFlow()

    private val backStack = ArrayDeque<Screen>()
    private var epgJob: Job? = null

    // ---------------------------------------------------------------- boot

    fun boot() {
        viewModelScope.launch {
            if (!repo.secure.hasProfile()) {
                _ui.update { it.copy(screen = Screen.Login) }
                return@launch
            }
            _ui.update { it.copy(loading = true, loadingText = "Signing in…") }
            try {
                val account = repo.restore()
                if (account == null) {
                    _ui.update { it.copy(screen = Screen.Login, loading = false) }
                } else {
                    _ui.update { it.copy(account = account, loading = false) }
                    afterLogin()
                }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(
                        screen = Screen.Login,
                        loading = false,
                        error = "Saved sign-in failed: ${e.message}"
                    )
                }
            }
        }
    }

    fun login(server: String, username: String, password: String, remember: Boolean) {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, loadingText = "Connecting…", error = null) }
            try {
                val account = repo.login(server, username, password, remember)
                _ui.update { it.copy(account = account, loading = false, error = null) }
                afterLogin()
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = e.message ?: "Could not sign in.") }
            }
        }
    }

    private fun afterLogin() {
        val start = when (prefs.settings.startScreen) {
            "live" -> Screen.Live
            "guide" -> Screen.Guide
            "movies" -> Screen.Movies
            "series" -> Screen.SeriesList
            else -> Screen.Home
        }
        _ui.update { it.copy(screen = start) }
        loadCatalogue()
    }

    fun loadCatalogue(force: Boolean = false) {
        viewModelScope.launch {
            try {
                repo.loadChannels(force)
                _ui.update { it.copy(catalogueReady = true, epgMatched = repo.epg.matchedCount, revision = it.revision + 1) }
            } catch (e: Exception) {
                _ui.update { it.copy(error = "Channels: ${e.message}") }
            }
            // Films and box sets are large; failing one must not block the other.
            runCatching { repo.loadMovies(force) }
            runCatching { repo.loadSeries(force) }
            _ui.update { it.copy(revision = it.revision + 1) }

            if (prefs.settings.epgAutoLoad && !repo.epg.isReady) refreshEpg()
        }
    }

    fun signOut() {
        repo.signOut()
        backStack.clear()
        _ui.value = UiState(screen = Screen.Login)
    }

    // ----------------------------------------------------------------- EPG

    fun refreshEpg(force: Boolean = false) {
        if (_ui.value.epgLoading) return
        if (repo.epg.isReady && !force) return
        val account = repo.account ?: return

        epgJob?.cancel()
        epgJob = viewModelScope.launch {
            _ui.update { it.copy(epgLoading = true, epgProgress = 0, epgProgressText = "Starting…") }
            val result = repo.epg.refresh(
                url = repo.client.xmltvUrl(),
                userAgent = prefs.settings.userAgent,
                hoursForward = prefs.settings.epgHoursForward
            ) { phase ->
                _ui.update { it.copy(epgProgress = phase.percent, epgProgressText = phase.text) }
            }
            result.fold(
                onSuccess = { stats ->
                    val matched = repo.epg.mapChannels(repo.channels)
                    _ui.update {
                        it.copy(
                            epgLoading = false,
                            epgReady = true,
                            epgStats = stats,
                            epgMatched = matched,
                            epgProgress = 100,
                            revision = it.revision + 1
                        )
                    }
                },
                onFailure = { error ->
                    _ui.update {
                        it.copy(
                            epgLoading = false,
                            epgProgressText = error.message ?: "Guide download failed",
                            error = "TV guide: ${error.message}"
                        )
                    }
                }
            )
        }
    }

    fun clearEpg() {
        repo.epg.clear()
        _ui.update { it.copy(epgReady = false, epgStats = null, epgMatched = 0, revision = it.revision + 1) }
    }

    // ------------------------------------------------------------ navigation

    fun navigate(screen: Screen) {
        val current = _ui.value.screen
        if (current == screen) return
        if (current !is Screen.Boot && current !is Screen.Login) backStack.addLast(current)
        if (backStack.size > 12) backStack.removeFirst()
        _ui.update { it.copy(screen = screen) }
    }

    /** @return false when there is nothing left to pop and the app should exit. */
    fun back(): Boolean {
        if (_playback.value != null) {
            stopPlayback()
            return true
        }
        val previous = backStack.removeLastOrNull() ?: return false
        _ui.update { it.copy(screen = previous) }
        return true
    }

    fun setSearchQuery(query: String) {
        _ui.update { it.copy(searchQuery = query) }
    }

    fun showToast(message: String?) {
        _ui.update { it.copy(toast = message) }
    }

    fun clearError() {
        _ui.update { it.copy(error = null) }
    }

    fun bumpRevision() {
        _ui.update { it.copy(revision = it.revision + 1) }
    }

    // ------------------------------------------------------------- playback

    fun playChannel(channel: Channel, playlist: List<Channel>) {
        prefs.pushRecentChannel(channel.streamId)
        val index = playlist.indexOfFirst { it.streamId == channel.streamId }
        val nowNext = repo.epg.nowNext(channel.streamId)
        _playback.value = PlaybackRequest(
            type = "live",
            title = com.aurum.tv.util.tidyChannelName(channel.name),
            subtitle = nowNext.now?.title.orEmpty(),
            url = repo.liveUrl(channel),
            isLive = true,
            streamId = channel.streamId,
            cover = channel.logo,
            extension = prefs.settings.liveFormat,
            playlist = playlist,
            playlistIndex = index
        )
        bumpRevision()
    }

    /** Live zapping from the player. */
    fun zap(delta: Int) {
        val current = _playback.value ?: return
        if (!current.isLive || current.playlist.size < 2) return
        val next = ((current.playlistIndex + delta) % current.playlist.size + current.playlist.size) % current.playlist.size
        playChannel(current.playlist[next], current.playlist)
    }

    fun playMovie(movie: Movie, detail: TitleDetail? = null) {
        val key = "movie:${movie.streamId}"
        val saved = prefs.progressFor(key)
        val extension = detail?.extension ?: movie.extension
        _playback.value = PlaybackRequest(
            type = "movie",
            title = movie.name,
            subtitle = listOfNotNull(movie.year, detail?.genre?.split(",")?.firstOrNull()?.trim())
                .joinToString(" · "),
            url = repo.movieUrl(movie, extension),
            isLive = false,
            streamId = movie.streamId,
            cover = detail?.cover ?: movie.cover,
            resumeFrom = saved?.position ?: 0,
            progressKey = key,
            extension = extension
        )
        bumpRevision()
    }

    fun playEpisode(series: Series, episodes: List<Episode>, index: Int) {
        val episode = episodes.getOrNull(index) ?: return
        val key = "episode:${episode.id}"
        val saved = prefs.progressFor(key)

        _playback.value = PlaybackRequest(
            type = "episode",
            title = series.name,
            subtitle = "S%02dE%02d · %s".format(episode.season, episode.episodeNumber, episode.title),
            url = repo.episodeUrl(episode),
            isLive = false,
            streamId = episode.id,
            seriesId = series.seriesId,
            cover = episode.still ?: series.cover,
            resumeFrom = saved?.position ?: 0,
            progressKey = key,
            extension = episode.extension,
            season = episode.season,
            episode = episode.episodeNumber,
            upNext = if (index + 1 < episodes.size) {
                {
                    val nextEpisode = episodes[index + 1]
                    PlaybackRequest(
                        type = "episode",
                        title = series.name,
                        subtitle = "S%02dE%02d · %s".format(nextEpisode.season, nextEpisode.episodeNumber, nextEpisode.title),
                        url = repo.episodeUrl(nextEpisode),
                        isLive = false,
                        streamId = nextEpisode.id,
                        seriesId = series.seriesId,
                        cover = nextEpisode.still ?: series.cover,
                        progressKey = "episode:${nextEpisode.id}",
                        extension = nextEpisode.extension,
                        season = nextEpisode.season,
                        episode = nextEpisode.episodeNumber
                    )
                }
            } else null
        )
        bumpRevision()
    }

    fun resume(entry: Progress) {
        when (entry.type) {
            "movie" -> {
                val movie = repo.movies.firstOrNull { it.streamId == entry.id }
                    ?: Movie(entry.id, entry.name, entry.cover, 0.0, null, "", entry.extension, 0)
                playMovie(movie)
            }
            "episode" -> {
                _playback.value = PlaybackRequest(
                    type = "episode",
                    title = entry.name,
                    subtitle = entry.subtitle,
                    url = repo.client.episodeUrl(entry.id, entry.extension),
                    isLive = false,
                    streamId = entry.id,
                    seriesId = entry.seriesId,
                    cover = entry.cover,
                    resumeFrom = entry.position,
                    progressKey = entry.key,
                    extension = entry.extension,
                    season = entry.season,
                    episode = entry.episode
                )
                bumpRevision()
            }
        }
    }

    fun advanceToNext(): Boolean {
        val next = _playback.value?.upNext?.invoke() ?: return false
        _playback.value = next
        return true
    }

    fun stopPlayback() {
        _playback.value = null
        bumpRevision()
    }

    /** Called by the player when the user flips MPEG-TS <-> HLS after a failure. */
    fun switchLiveFormat(): String {
        val next = if (prefs.settings.liveFormat == "ts") "m3u8" else "ts"
        prefs.updateSettings { it.copy(liveFormat = next) }
        val current = _playback.value
        if (current != null && current.isLive) {
            val channel = repo.channel(current.streamId)
            if (channel != null) {
                _playback.value = current.copy(url = repo.liveUrl(channel), extension = next)
            }
        }
        return next
    }

    fun saveProgress(positionMs: Long, durationMs: Long) {
        val request = _playback.value ?: return
        val key = request.progressKey ?: return
        if (request.isLive || durationMs <= 0) return

        prefs.saveProgress(
            Progress(
                key = key,
                type = request.type,
                id = request.streamId,
                seriesId = request.seriesId,
                name = request.title,
                subtitle = request.subtitle,
                cover = request.cover,
                position = positionMs,
                duration = durationMs,
                extension = request.extension,
                season = request.season,
                episode = request.episode
            )
        )
    }

    fun clearProgressForCurrent() {
        _playback.value?.progressKey?.let { prefs.removeProgress(it) }
    }

    fun toggleFavourite(kind: String, id: String): Boolean {
        val added = prefs.toggleFavourite(kind, id)
        bumpRevision()
        return added
    }
}
