package com.aurum.tv.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aurum.tv.data.CategoryCount
import com.aurum.tv.data.Movie
import com.aurum.tv.data.Repository
import com.aurum.tv.data.Series
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.formatCount

private enum class Sort(val label: String, val key: String) {
    ADDED("Recently added", "added"),
    NAME("A – Z", "name"),
    RATING("Top rated", "rating"),
    YEAR("Newest first", "year")
}

@Composable
fun MoviesScreen(state: AppState, revision: Int) {
    val repo = state.repo
    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var sort by rememberSaveable { mutableStateOf(Sort.ADDED) }

    if (repo.stats.movies == 0) {
        LoadingState("Loading films…")
        return
    }

    val favourites = remember(revision) { state.prefs.favouriteIds("movie") }
    val isFav = category == Repository.FAVOURITES

    val paged = rememberPagedList<Movie>(
        category, sort, revision,
        pageSize = 60,
        count = {
            if (isFav) favourites.size
            else repo.titleCount("movie", category.takeIf { it != Repository.ALL })
        },
        fetch = { offset, limit ->
            if (isFav) repo.moviesByIds(favourites.drop(offset).take(limit))
            else repo.movies(
                category = category.takeIf { it != Repository.ALL },
                sort = sort.key, limit = limit, offset = offset
            )
        }
    )

    CatalogueScaffold(
        title = "Films",
        countLabel = "${formatCount(paged.total)} films",
        total = repo.stats.movies,
        favouriteCount = favourites.size,
        categories = repo.movieCategories,
        selectedCategory = category,
        onCategory = { category = it },
        sort = sort,
        onSort = { sort = it },
        isEmpty = paged.items.isEmpty() && !paged.loading,
        emptyIcon = AurumIcons.Film,
        emptyIsFavourites = isFav,
        paged = paged
    ) {
        items(paged.items, key = { it.streamId }) { movie -> MoviePoster(state, movie) }
    }
}

@Composable
fun SeriesScreen(state: AppState, revision: Int) {
    val repo = state.repo
    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var sort by rememberSaveable { mutableStateOf(Sort.ADDED) }

    if (repo.stats.series == 0) {
        LoadingState("Loading box sets…")
        return
    }

    val favourites = remember(revision) { state.prefs.favouriteIds("series") }
    val isFav = category == Repository.FAVOURITES

    val paged = rememberPagedList<Series>(
        category, sort, revision,
        pageSize = 60,
        count = {
            if (isFav) favourites.size
            else repo.titleCount("series", category.takeIf { it != Repository.ALL })
        },
        fetch = { offset, limit ->
            if (isFav) repo.seriesByIds(favourites.drop(offset).take(limit))
            else repo.seriesPage(
                category = category.takeIf { it != Repository.ALL },
                sort = sort.key, limit = limit, offset = offset
            )
        }
    )

    CatalogueScaffold(
        title = "Box sets",
        countLabel = "${formatCount(paged.total)} titles",
        total = repo.stats.series,
        favouriteCount = favourites.size,
        categories = repo.seriesCategories,
        selectedCategory = category,
        onCategory = { category = it },
        sort = sort,
        onSort = { sort = it },
        isEmpty = paged.items.isEmpty() && !paged.loading,
        emptyIcon = AurumIcons.SeriesIcon,
        emptyIsFavourites = isFav,
        paged = paged
    ) {
        items(paged.items, key = { it.seriesId }) { series -> SeriesPoster(state, series) }
    }
}

@Composable
private fun CatalogueScaffold(
    title: String,
    countLabel: String,
    total: Int,
    favouriteCount: Int,
    categories: List<CategoryCount>,
    selectedCategory: String,
    onCategory: (String) -> Unit,
    sort: Sort,
    onSort: (Sort) -> Unit,
    isEmpty: Boolean,
    emptyIcon: androidx.compose.ui.graphics.vector.ImageVector,
    emptyIsFavourites: Boolean,
    paged: PagedList<*>,
    gridContent: androidx.compose.foundation.lazy.grid.LazyGridScope.() -> Unit
) {
    val gridState = rememberLazyGridState()
    gridState.PageWhenNearEnd(paged)

    Column(Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = Aurum.OverscanH, end = Aurum.OverscanH, top = 10.dp, bottom = 14.dp)
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
            TvChip("Favourites", selectedCategory == Repository.FAVOURITES, trailing = formatCount(favouriteCount)) {
                onCategory(Repository.FAVOURITES)
            }
            categories.forEach { cat ->
                TvChip(cat.name, selectedCategory == cat.id, trailing = formatCount(cat.count)) { onCategory(cat.id) }
            }
        }

        if (isEmpty) {
            EmptyState(
                emptyIcon, "Nothing here",
                if (emptyIsFavourites) "Open any title and choose Favourite to keep it here."
                else "This category is empty."
            )
        } else {
            LazyVerticalGrid(
                state = gridState,
                columns = GridCells.Adaptive(minSize = 182.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
                contentPadding = PaddingValues(
                    start = Aurum.OverscanH, end = Aurum.OverscanH, bottom = Aurum.OverscanV + 30.dp
                ),
                modifier = Modifier.fillMaxSize(),
                content = gridContent
            )
        }
    }
}
