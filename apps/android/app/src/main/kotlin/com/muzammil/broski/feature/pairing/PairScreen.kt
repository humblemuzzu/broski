package com.muzammil.broski.feature.pairing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.CommandBlock

/** Pair another Mac, reached from Machines. */
@Composable
fun PairScreen(phone: PhoneSession, onBack: () -> Unit, onPaired: () -> Unit) {
    val pairing = viewModel { PairingViewModel(phone) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.pairing_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            PairingFlow(
                viewModel = pairing,
                onPaired = { onPaired() },
                modifier = Modifier
                    .widthIn(max = 560.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(stringResource(R.string.pairing_intro), style = MaterialTheme.typography.bodyLarge)
                    CommandBlock(stringResource(R.string.welcome_pair_command))
                }
            }
        }
    }
}
