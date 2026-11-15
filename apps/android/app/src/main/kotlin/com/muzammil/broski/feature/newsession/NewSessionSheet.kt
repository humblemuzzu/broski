package com.muzammil.broski.feature.newsession

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import kotlinx.coroutines.launch

/**
 * New session as a prompt, not a form: a sheet the whole height, its own view model for as long as it
 * is open. Sending creates the session and opens its chat, which sends the first prompt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSessionSheet(context: FeatureContext, dismiss: () -> Unit) {
    val owner = remember { SheetScope() }
    DisposableEffect(owner) { onDispose { owner.viewModelStore.clear() } }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = { scope.launch { sheet.hide() }.invokeOnCompletion { dismiss() } }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = sheet) {
        CompositionLocalProvider(LocalViewModelStoreOwner provides owner) {
            val resolver = LocalContext.current.applicationContext.contentResolver
            val model = viewModel { NewSessionViewModel(context.phone, ImageAttachments(resolver)) }
            NewSessionContent(model, context, close)
        }
    }
}

private class SheetScope : ViewModelStoreOwner {
    override val viewModelStore = ViewModelStore()
}

@Composable
private fun NewSessionContent(model: NewSessionViewModel, context: FeatureContext, close: () -> Unit) {
    val resources = LocalResources.current
    var error by remember { mutableStateOf<String?>(null) }
    val listing by model.folders.listing.collectAsStateWithLifecycle()
    LaunchedEffect(model) {
        model.outcomes.collect { outcome ->
            when (outcome) {
                is NewSessionEvent.Created -> {
                    context.navigate(SessionRoute.of(outcome.machineId, outcome.session))
                    close()
                }
                is NewSessionEvent.Refused -> error = resources.getString(R.string.new_session_refused, outcome.rejection.message)
                is NewSessionEvent.Failed -> error = resources.getString(R.string.chat_failed_offline)
                NewSessionEvent.ImageTooLarge -> error = resources.getString(R.string.composer_image_too_large)
                NewSessionEvent.NoImageToPaste -> error = resources.getString(R.string.composer_no_image_to_paste)
            }
        }
    }
    AnimatedContent(listing, contentKey = { it == null }, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "page") { browsing ->
        Column(Modifier.fillMaxSize().imePadding()) {
            if (browsing == null) {
                Prompt(model, error, close)
            } else {
                FolderPicker(browsing, model)
            }
        }
    }
}
