package com.muzammil.broski.feature.welcome

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.CommandBlock
import com.muzammil.broski.feature.pairing.PairingFlow
import com.muzammil.broski.feature.pairing.PairingViewModel

/** The first run: what Broski is, what to run on the Mac, and the two ways to pair. */
@Composable
fun WelcomeScreen(phone: PhoneSession, onPaired: () -> Unit) {
    val pairing = viewModel { PairingViewModel(phone) }
    Surface(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
            PairingFlow(
                viewModel = pairing,
                onPaired = { onPaired() },
                modifier = Modifier
                    .widthIn(max = 560.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp),
            ) {
                WelcomeIntro()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun WelcomeIntro() {
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Image(
            painterResource(R.drawable.broski_icon),
            contentDescription = null,
            modifier = Modifier.size(72.dp).clip(RoundedCornerShape(16.dp)),
        )
        Text(
            stringResource(R.string.welcome_line),
            style = MaterialTheme.typography.displaySmallEmphasized,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            stringResource(R.string.welcome_on_your_mac),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CommandBlock(stringResource(R.string.welcome_install_command))
            CommandBlock(stringResource(R.string.welcome_pair_command))
        }
    }
}
