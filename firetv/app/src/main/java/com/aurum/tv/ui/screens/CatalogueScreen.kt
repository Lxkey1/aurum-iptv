package com.aurum.tv.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aurum.tv.data.Category
import com.aurum.tv.data.Movie
import com.aurum.tv.data.Repository
import com.aurum.tv.data.Series
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.formatCount

private enum class Sort(val label: String) {
    ADDED("Recently added"),
    NAME("A – Z"),
    RATING("Top rated"),
    YEAR("Newest first")
}

@Composable
fun MoviesScreen(state: AppState, revision: Int) {
    val repo = state.repo
    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var sort by rememberSaveable { mutableStateOf(Sort.ADDED) }

    if (repo.movies.isEmpty()) {
        LoadingState("Loading films…")
        return
    }

    val visible = remember(category, sort, revision) {
        val list = repo.moviesIn(category)
        when (sort) {
            Sort.NAME -> list.sortedBy { it.name.lowercase() }
            Sort.RATING -> list.sortedByDescending { it.rating }
            Sort.YEAR -> list.sortedByDescending { it.year?.toIntOrNull() ?: 0 }
            Sort.ADDED -> list.sortedByDescending { it.addedAt }
        }
    }

    CatalogueScaffold(
        title = "Films",
        countLabel = "${formatCount(visible.size)} films",
        total = repo.movies.size,
        categories = repo.movieCategories,
        selectedCategory = category,
        onCategory = { category = it },
        sort = sort,
        onSort = { sort = it },
        isEmpty = visible.isEmpty(),
        emptyIcon = AurumIcons.Film,
        emptyIsFavourites = category == Repository.FAVOURITES
    ) {
        items(visible, key = { it.streamId }) { movie: Movie ->
            MoviePoster(state, movie)
        }
    }
}

@Composable
fun SeriesScreen(state: AppState, revision: Int) {
    val repo = state.repo
    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var sort by rememberSaveable { mutableStateOf(Sort.ADDED) }

    if (repo.series.isEmpty()) {
        LoadingState("Loading box sets…")
        return
    }

    val visible = remember(category, sort, revision) {
        val list = repo.seriesIn(category)
        when (sort) {
            Sort.NAME -> list.sortedBy { it.name.lowercase() }
            Sort.RATING -> list.sortedByDescending { it.rating }
            Sort.YEAR -> list.sortedByDescending { it.year?.toIntOrNull() ?: 0 }
            Sort.ADDED -> list.sortedByDescending { it.modifiedAt }
        }
    }

    CatalogueScaffold(
        title = "Box sets",
        countLabel = "${formatCount(visible.size)} titles",
        total = repo.series.size,
        categories = repo.seriesCategories,
        selectedCategory = category,
        onCategory = { category = it },
        sort = sort,
        onSort = { sort = it },
        isEmpty = visible.isEmpty(),
        emptyIcon = AurumIcons.SeriesIcon,
        emptyIsFavourites = category == Repository.FAVOURITES
    ) {
        items(visible, key = { it.seriesId }) { series: Series ->
            SeriesPoster(state, series)
        }
    }
}

/** Shared chrome: title, sort chips, category chips and the poster grid. */
@Composable
private fun CatalogueScaffold(
    title: String,
    countLabel: String,
    total: Int,
    categories: List<Category>,
    selectedCategory: String,
    onCategory: (String) -> Unit,
    sort: Sort,
    onSort: (Sort) -> Unit,
    isEmpty: Boolean,
    emptyIcon: androidx.compose.ui.graphics.vector.ImageVector,
    emptyIsFavourites: Boolean,
    gridContent: androidx.compose.foundation.lazy.grid.LazyGridScope.() -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(
                start = Aurum.OverscanH, end = Aurum.OverscanH, top = 10.dp, bottom = 14.dp
            )
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, color = Aurum.Text, style = MaterialTheme.typography.headlineLarge)
                Text(countLabel, color = Aurum.Text3, style = MaterialTheme.typography.bodyMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Sort.entries.forEach { option ->
                    TvChip(option.label, sort == option) { onSort(option) }
                }
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(9.dp),
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(start = Aurum.OverscanH, end = Aurum.OverscanH, bottom = 16.dp)
        ) {
            TvChip("All", selectedCategory == Repository.ALL, trailing = formatCount(total)) {
                onCategory(Repository.ALL)
            }
            TvChip("Favourites", selectedCategory == Repository.FAVOURITES) {
                onCategory(Repository.FAVOURITES)
            }
            categories.forEach { cat ->
                TvChip(cat.name, selectedCategory == cat.id) { onCategory(cat.id) }
            }
        }

        if (isEmpty) {
            EmptyState(
                emptyIcon,
                "Nothing here",
                if (emptyIsFavourites) "Open any title and choose Favourite to keep it here."
                else "This category is empty."
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 182.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
                contentPadding = PaddingValues(
                    start = Aurum.OverscanH,
                    end = Aurum.OverscanH,
                    bottom = Aurum.OverscanV + 30.dp
                ),
                modifier = Modifier.fillMaxSize(),
                content = gridContent
            )
        }
    }
}
