package com.muzammil.broski.feature.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore

/** Settings › Experimental: opt-in features that stay off on both phone and Mac until turned on. */
@Composable
fun ExperimentalSettingsScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettingsPage(stringResource(R.string.settings_experimental), onBack) {
        item(key = "remote-screen") {
            FormToggle(
                index = 0,
                count = 1,
                title = stringResource(R.string.settings_remote_screen_title),
                checked = state.settings.remoteScreen,
                onChange = viewModel::setRemoteScreen,
            )
            FormFooter(stringResource(R.string.settings_remote_screen_footer))
        }
    }
}
