package com.muzammil.broski.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Badge
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.orb.OrbState

/** The bar's height, and the round New Session button's side beside it. */
val TabBarHeight = 56.dp

/** What the tab bar takes from the bottom of the screen, the working capsule's row included. */
fun tabBarClearance(working: Boolean) = TabBarHeight + 16.dp + if (working) 56.dp else 0.dp

/**
 * The floating tab bar iOS draws: a glass capsule of the tabs' symbols, the chosen one on a soft pill,
 * with New Session as the round glass button beside it, and above both, while agents work, a capsule
 * that opens the inbox narrowed to them.
 */
@Composable
fun FloatingTabBar(
    selected: TopLevel,
    onSelect: (TopLevel) -> Unit,
    needsYou: Int,
    working: Int,
    onWorking: () -> Unit,
    onNewSession: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AnimatedVisibility(
            visible = working > 0,
            enter = fadeIn() + slideInVertically { it / 2 },
            exit = fadeOut() + slideOutVertically { it / 2 },
        ) {
            WorkingCapsule(working, onWorking)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            GlassSurface(shape = CircleShape, modifier = Modifier.weight(1f).height(TabBarHeight)) {
                Row(Modifier.fillMaxSize().padding(4.dp)) {
                    TopLevel.entries.forEach { tab ->
                        TabItem(tab, tab == selected, if (tab == TopLevel.Inbox) needsYou else 0, { onSelect(tab) }, Modifier.weight(1f))
                    }
                }
            }
            onNewSession?.let { GlassCircleButton(R.drawable.ic_edit_square, stringResource(R.string.new_session), it, side = TabBarHeight) }
        }
    }
}

@Composable
private fun TabItem(tab: TopLevel, chosen: Boolean, badge: Int, onClick: () -> Unit, modifier: Modifier) {
    val label = stringResource(tab.label)
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clip(CircleShape)
            .background(if (chosen) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f) else Color.Transparent)
            .clickable(role = Role.Tab, onClickLabel = label, onClick = onClick)
            .semantics { selected = chosen },
        contentAlignment = Alignment.Center,
    ) {
        Box {
            Icon(painterResource(tab.selectedIcon), contentDescription = label, modifier = Modifier.size(24.dp))
            if (badge > 0) {
                Badge(Modifier.align(Alignment.TopEnd).offset(x = 8.dp, y = (-6).dp)) { Text("$badge") }
            }
        }
    }
}

/** "n agents working": opens the inbox narrowed to them. */
@Composable
private fun WorkingCapsule(count: Int, onClick: () -> Unit) {
    GlassSurface(shape = CircleShape, modifier = Modifier.fillMaxWidth().height(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Orb(OrbState.WORKING, size = 18.dp)
            Text(
                pluralStringResource(R.plurals.inbox_working_count, count, count),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Spacer(Modifier.weight(1f))
            Icon(
                painterResource(R.drawable.ic_chevron_right),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}
