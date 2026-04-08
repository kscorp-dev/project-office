package com.kscorp.projectoffice.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    var selectedTab by remember { mutableIntStateOf(0) }

    val tabs = listOf(
        "결재" to Icons.Default.Description,
        "메신저" to Icons.Default.Message,
        "CCTV" to Icons.Default.Videocam,
        "설정" to Icons.Default.Settings
    )

    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEachIndexed { index, (title, icon) ->
                    NavigationBarItem(
                        icon = { Icon(icon, contentDescription = title) },
                        label = { Text(title) },
                        selected = selectedTab == index,
                        onClick = { selectedTab = index }
                    )
                }
            }
        }
    ) { innerPadding ->
        // TODO: 각 탭별 화면 구현
        when (selectedTab) {
            0 -> Text("전자결재", modifier = Modifier.padding(innerPadding))
            1 -> Text("메신저", modifier = Modifier.padding(innerPadding))
            2 -> Text("CCTV", modifier = Modifier.padding(innerPadding))
            3 -> Text("설정", modifier = Modifier.padding(innerPadding))
        }
    }
}
