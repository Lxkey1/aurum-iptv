package com.aurum.tv.ui.components

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

/**
 * Incremental paging for a list backed by the catalogue database.
 *
 * The whole point of moving the catalogue to SQLite is that the cost of a
 * screen should be the size of the screen, not the size of the line. This
 * holds only what has actually been scrolled to.
 */
@Stable
class PagedList<T>(
    private val pageSize: Int,
    private val fetch: suspend (offset: Int, limit: Int) -> List<T>,
    private val count: suspend () -> Int
) {
    var items by mutableStateOf<List<T>>(emptyList())
        private set
    var total by mutableIntStateOf(0)
        private set
    var loading by mutableStateOf(false)
        private set
    var exhausted by mutableStateOf(false)
        private set

    private var offset = 0

    suspend fun reset() {
        offset = 0
        exhausted = false
        items = emptyList()
        total = runCatching { count() }.getOrDefault(0)
        loadMore()
    }

    suspend fun loadMore() {
        if (loading || exhausted) return
        loading = true
        try {
            val page = runCatching { fetch(offset, pageSize) }.getOrDefault(emptyList())
            if (page.size < pageSize) exhausted = true
            if (page.isNotEmpty()) {
                items = items + page
                offset += page.size
            }
        } finally {
            loading = false
        }
    }
}

@Composable
fun <T> rememberPagedList(
    vararg keys: Any?,
    pageSize: Int = 60,
    count: suspend () -> Int,
    fetch: suspend (offset: Int, limit: Int) -> List<T>
): PagedList<T> {
    val paged = remember(*keys) { PagedList(pageSize, fetch, count) }
    LaunchedEffect(paged) { paged.reset() }
    return paged
}

/** Loads the next page when the user scrolls within [threshold] of the end. */
@Composable
fun LazyListState.PageWhenNearEnd(paged: PagedList<*>, threshold: Int = 12) {
    LaunchedEffect(this, paged) {
        snapshotFlow { layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { it >= paged.items.size - threshold }
            .collect { paged.loadMore() }
    }
}

@Composable
fun LazyGridState.PageWhenNearEnd(paged: PagedList<*>, threshold: Int = 18) {
    LaunchedEffect(this, paged) {
        snapshotFlow { layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { it >= paged.items.size - threshold }
            .collect { paged.loadMore() }
    }
}
