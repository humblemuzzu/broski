package com.muzammil.broski.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSerializable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.serialization.NavBackStackSerializer

/**
 * One back stack per navigation bar destination. Inbox is the start destination: back from the root
 * of another tab returns to it, and the display shows Inbox's stack under the selected tab's.
 */
@Stable
class Navigator internal constructor(
    private val stacks: Map<TopLevel, NavBackStack<Route>>,
    tabState: MutableState<TopLevel>,
) {
    var tab: TopLevel by tabState
        private set

    val entries: List<Route>
        get() = stacks.getValue(TopLevel.Inbox) + if (tab == TopLevel.Inbox) emptyList() else stacks.getValue(tab)

    /** The chosen tab's own stack, its root first. */
    val shown: List<Route>
        get() = stacks.getValue(tab)

    /** Selecting the tab already shown goes back to its root. */
    fun select(target: TopLevel) {
        if (target == tab) {
            val stack = stacks.getValue(target)
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
        } else {
            tab = target
        }
    }

    fun open(route: Route) {
        stacks.getValue(tab).add(route)
    }

    fun back() {
        val stack = stacks.getValue(tab)
        when {
            stack.size > 1 -> stack.removeAt(stack.lastIndex)
            tab != TopLevel.Inbox -> tab = TopLevel.Inbox
        }
    }
}

@Composable
fun rememberNavigator(): Navigator {
    val stacks = TopLevel.entries.map { top ->
        rememberSerializable(top, serializer = NavBackStackSerializer(Route.serializer())) { NavBackStack(top.root) }
    }
    val tab = rememberSaveable { mutableStateOf(TopLevel.Inbox) }
    return remember(*stacks.toTypedArray(), tab) { Navigator(TopLevel.entries.zip(stacks).toMap(), tab) }
}
